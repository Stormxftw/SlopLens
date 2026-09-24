import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { basename } from 'node:path';
import type { Provider, TokenUsage } from '../src/types.ts';
import { addUsage, emptyUsage } from './pricing.ts';

export interface Observation {
  provider: Provider;
  sessionId: string;
  cwd: string;
  firstAt: number | null;
  lastAt: number | null;
  activeMs: number;
  activePartial: boolean;
  usageMissing: boolean;
  byModel: Map<string, TokenUsage>;
  toolCategories: Record<string, number>;
  delegationCount: number;
  toolPartial: boolean;
}

export function toolCategory(name: string): string {
  const value = name.toLowerCase();
  if (/spawn_agent|delegate|subagent|^task$/.test(value)) return 'delegation';
  if (/apply_patch|(^|[._])edit|(^|[._])write/.test(value)) return 'edit';
  if (/browser|playwright|web|search/.test(value)) return 'browser';
  if (/read|grep|(^|[._])rg$|(^|[._])find/.test(value)) return 'read';
  if (/exec|shell|bash|terminal|powershell/.test(value)) return 'command';
  return 'other';
}

function countTool(row: Observation, name: string): void {
  const category = toolCategory(name);
  row.toolCategories[category] = (row.toolCategories[category] ?? 0) + 1;
  if (category === 'delegation') row.delegationCount += 1;
}

const finite = (value: unknown): number => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;
const time = (value: unknown): number | null => {
  const n = typeof value === 'string' ? Date.parse(value) : NaN;
  return Number.isFinite(n) ? n : null;
};
const obj = (value: unknown): Record<string, unknown> => value !== null && typeof value === 'object' ? value as Record<string, unknown> : {};
const str = (value: unknown): string | null => typeof value === 'string' && value.trim() ? value : null;

function observation(map: Map<string, Observation>, provider: Provider, sessionId: string, cwd: string): Observation {
  let row = map.get(cwd);
  if (!row) {
    row = { provider, sessionId, cwd, firstAt: null, lastAt: null, activeMs: 0, activePartial: false, usageMissing: false, byModel: new Map(),
      toolCategories: {}, delegationCount: 0, toolPartial: false };
    map.set(cwd, row);
  }
  return row;
}

function touch(row: Observation, at: number | null): void {
  if (at === null) return;
  row.firstAt = row.firstAt === null ? at : Math.min(row.firstAt, at);
  row.lastAt = row.lastAt === null ? at : Math.max(row.lastAt, at);
}

function addModelUsage(row: Observation, model: string, usage: TokenUsage): void {
  if (usage.input + usage.cachedInput + usage.cacheWrite5m + usage.cacheWrite1h + usage.output === 0) return;
  row.byModel.set(model, addUsage(row.byModel.get(model) ?? emptyUsage(), usage));
}

function codexCounter(value: unknown): TokenUsage {
  const v = obj(value);
  const totalInput = finite(v.input_tokens);
  const cached = finite(v.cached_input_tokens);
  const write = finite(v.cache_write_input_tokens);
  return {
    input: Math.max(0, totalInput - cached - write),
    cachedInput: cached,
    cacheWrite5m: write,
    cacheWrite1h: 0,
    output: finite(v.output_tokens),
  };
}

function counterDelta(current: TokenUsage, previous: TokenUsage): TokenUsage {
  // A full counter reset can occur after reconnect. Repeated snapshots add zero.
  const reset = current.input < previous.input || current.cachedInput < previous.cachedInput
    || current.cacheWrite5m < previous.cacheWrite5m || current.output < previous.output;
  if (reset) return current;
  return {
    input: current.input - previous.input,
    cachedInput: current.cachedInput - previous.cachedInput,
    cacheWrite5m: current.cacheWrite5m - previous.cacheWrite5m,
    cacheWrite1h: 0,
    output: current.output - previous.output,
  };
}

export async function parseCodex(file: string): Promise<Observation[]> {
  const rows = new Map<string, Observation>();
  let sessionId = basename(file, '.jsonl');
  let cwd: string | null = null;
  let model = 'Unknown model';
  let previous = emptyUsage();
  let taskStart: number | null = null;
  let sawUsage = false;
  const seenTools = new Set<string>();
  const input = createInterface({ input: createReadStream(file, { encoding: 'utf8' }), crlfDelay: Infinity });
  for await (const line of input) {
    if (!line.includes('"type":"session_meta"') && !line.includes('"type":"turn_context"')
      && !line.includes('"type":"token_count"') && !line.includes('"type":"task_started"')
      && !line.includes('"type":"task_complete"') && !line.includes('"type":"response_item"')) continue;
    let record: Record<string, unknown>;
    try { record = obj(JSON.parse(line)); } catch { continue; }
    const payload = obj(record.payload);
    const at = time(record.timestamp);
    if (record.type === 'session_meta') {
      sessionId = str(payload.id) ?? str(payload.session_id) ?? sessionId;
      cwd = str(payload.cwd) ?? cwd;
      if (cwd) touch(observation(rows, 'Codex', sessionId, cwd), at);
      continue;
    }
    if (record.type === 'turn_context') {
      cwd = str(payload.cwd) ?? cwd;
      model = str(payload.model) ?? model;
      if (cwd) touch(observation(rows, 'Codex', sessionId, cwd), at);
      continue;
    }
    if (record.type === 'response_item' && cwd && payload.type === 'function_call') {
      const callId = str(payload.call_id) ?? str(payload.id);
      const key = callId ?? String(record.timestamp) + ':' + str(payload.name);
      if (!seenTools.has(key)) {
        seenTools.add(key);
        const name = str(payload.name);
        if (name) countTool(observation(rows, 'Codex', sessionId, cwd), name);
        else observation(rows, 'Codex', sessionId, cwd).toolPartial = true;
      }
      continue;
    }
    if (record.type !== 'event_msg' || !cwd) continue;
    const row = observation(rows, 'Codex', sessionId, cwd);
    touch(row, at);
    if (payload.type === 'task_started') taskStart = at;
    if (payload.type === 'task_complete' && taskStart !== null) {
      if (at !== null && at >= taskStart) row.activeMs += at - taskStart;
      else row.activePartial = true;
      taskStart = null;
    }
    if (payload.type === 'token_count') {
      const info = obj(payload.info);
      if (info.total_token_usage && typeof info.total_token_usage === 'object') {
        const current = codexCounter(info.total_token_usage);
        addModelUsage(row, model, counterDelta(current, previous));
        previous = current;
        sawUsage = true;
      }
    }
  }
  if (taskStart !== null && cwd) observation(rows, 'Codex', sessionId, cwd).activePartial = true;
  if (!sawUsage) for (const row of rows.values()) row.usageMissing = true;
  for (const row of rows.values()) if (row.byModel.size === 0) row.usageMissing = true;
  return [...rows.values()];
}

interface ClaudeMessage {
  id: string;
  cwd: string;
  model: string;
  at: number | null;
  usage: TokenUsage | null;
  endTurn: boolean;
}

function claudeUsage(value: unknown): TokenUsage | null {
  if (!value || typeof value !== 'object') return null;
  const u = obj(value);
  const writes = finite(u.cache_creation_input_tokens);
  const detail = obj(u.cache_creation);
  const write1h = Math.min(writes, finite(detail.ephemeral_1h_input_tokens));
  return { input: finite(u.input_tokens), cachedInput: finite(u.cache_read_input_tokens),
    cacheWrite5m: Math.max(0, writes - write1h), cacheWrite1h: write1h, output: finite(u.output_tokens) };
}

function maxUsage(a: TokenUsage | null, b: TokenUsage | null): TokenUsage | null {
  if (!a) return b;
  if (!b) return a;
  return {
    input: Math.max(a.input, b.input), cachedInput: Math.max(a.cachedInput, b.cachedInput),
    cacheWrite5m: Math.max(a.cacheWrite5m, b.cacheWrite5m),
    cacheWrite1h: Math.max(a.cacheWrite1h, b.cacheWrite1h), output: Math.max(a.output, b.output),
  };
}

function isToolResultOnly(value: unknown): boolean {
  if (!Array.isArray(value) || value.length === 0) return false;
  return value.every((part) => obj(part).type === 'tool_result');
}

export async function parseClaude(file: string): Promise<Observation[]> {
  const rows = new Map<string, Observation>();
  const messages = new Map<string, ClaudeMessage>();
  let sessionId = basename(file, '.jsonl');
  let currentCwd: string | null = null;
  let turnStart: number | null = null;
  let turnCwd: string | null = null;
  const seenTools = new Set<string>();
  const input = createInterface({ input: createReadStream(file, { encoding: 'utf8' }), crlfDelay: Infinity });
  for await (const line of input) {
    if (!line.includes('"type":"user"') && !line.includes('"type":"assistant"')) continue;
    let record: Record<string, unknown>;
    try { record = obj(JSON.parse(line)); } catch { continue; }
    if (record.type !== 'user' && record.type !== 'assistant') continue;
    sessionId = str(record.sessionId) ?? sessionId;
    currentCwd = str(record.cwd) ?? currentCwd;
    if (!currentCwd) continue;
    const at = time(record.timestamp);
    const row = observation(rows, 'Claude Code', sessionId, currentCwd);
    touch(row, at);
    const message = obj(record.message);
    if (record.type === 'assistant' && Array.isArray(message.content)) {
      for (const part of message.content) {
        const item = obj(part);
        if (item.type !== 'tool_use') continue;
        const id = str(item.id);
        const key = id ?? str(record.uuid) + ':' + str(item.name);
        if (seenTools.has(key)) continue;
        seenTools.add(key);
        const name = str(item.name);
        if (name) countTool(row, name);
        else row.toolPartial = true;
      }
    }
    if (record.type === 'user') {
      if (!isToolResultOnly(message.content)) {
        if (turnStart !== null && turnCwd) observation(rows, 'Claude Code', sessionId, turnCwd).activePartial = true;
        turnStart = at;
        turnCwd = currentCwd;
      }
      continue;
    }
    const id = str(message.id) ?? str(record.uuid) ?? `line-${messages.size}`;
    const prior = messages.get(id);
    const usage = claudeUsage(message.usage);
    messages.set(id, {
      id, cwd: currentCwd, model: str(message.model) ?? prior?.model ?? 'Unknown model',
      at: at ?? prior?.at ?? null, usage: maxUsage(prior?.usage ?? null, usage),
      endTurn: message.stop_reason === 'end_turn' || prior?.endTurn === true,
    });
    if (message.stop_reason === 'end_turn' && turnStart !== null && turnCwd) {
      const active = observation(rows, 'Claude Code', sessionId, turnCwd);
      if (at !== null && at >= turnStart) active.activeMs += at - turnStart;
      else active.activePartial = true;
      turnStart = null;
      turnCwd = null;
    }
  }
  if (turnStart !== null && turnCwd) observation(rows, 'Claude Code', sessionId, turnCwd).activePartial = true;
  for (const message of messages.values()) {
    const row = observation(rows, 'Claude Code', sessionId, message.cwd);
    if (message.usage) addModelUsage(row, message.model, message.usage);
    else row.usageMissing = true;
  }
  if (messages.size === 0) for (const row of rows.values()) row.usageMissing = true;
  for (const row of rows.values()) if (row.byModel.size === 0) row.usageMissing = true;
  return [...rows.values()];
}
