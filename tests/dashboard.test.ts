import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { parseClaude, parseCodex } from '../server/parse.ts';
import { estimateUsd, tokenTotal } from '../server/pricing.ts';
import { buildDashboard, scanCode } from '../server/projects.ts';

const temp: string[] = [];
async function fixture(): Promise<string> { const dir = await mkdtemp(join(tmpdir(), 'agent-dash-test-')); temp.push(dir); return dir; }
afterEach(async () => { for (const dir of temp.splice(0)) await rm(dir, { recursive: true, force: true }); });
const record = (type: string, payload: unknown, timestamp: string) => JSON.stringify({ timestamp, type, payload });

describe('agent history readers', () => {
  it('uses Codex cumulative deltas, ignores repeated totals, and splits work across directories and models', async () => {
    const root = await fixture(); const a = join(root, 'a'); const b = join(root, 'b'); await mkdir(a); await mkdir(b);
    const file = join(root, 'codex.jsonl');
    const count = (input: number, cached: number, output: number) => record('event_msg', { type: 'token_count', info: { total_token_usage: { input_tokens: input, cached_input_tokens: cached, output_tokens: output } } }, '2026-09-23T12:00:01Z');
    await writeFile(file, [
      record('session_meta', { id: 'codex-one', cwd: a }, '2026-09-23T12:00:00Z'),
      record('event_msg', { type: 'task_started' }, '2026-09-23T12:00:00Z'),
      record('turn_context', { cwd: a, model: 'gpt-6-sol' }, '2026-09-23T12:00:00Z'),
      count(100, 20, 10), count(100, 20, 10),
      record('event_msg', { type: 'task_complete' }, '2026-09-23T12:00:10Z'),
      record('event_msg', { type: 'task_started' }, '2026-09-23T12:01:00Z'),
      record('turn_context', { cwd: b, model: 'mystery-model' }, '2026-09-23T12:01:00Z'),
      count(160, 40, 15),
      record('event_msg', { type: 'task_complete' }, '2026-09-23T12:01:20Z'),
      '{not-json',
    ].join('\n'));
    const rows = await parseCodex(file);
    expect(rows).toHaveLength(2);
    const first = rows.find((row) => row.cwd === a)!;
    const second = rows.find((row) => row.cwd === b)!;
    expect(first.byModel.get('gpt-6-sol')).toEqual({ input: 80, cachedInput: 20, cacheWrite5m: 0, cacheWrite1h: 0, output: 10 });
    expect(first.activeMs).toBe(10_000);
    expect(second.byModel.get('mystery-model')).toEqual({ input: 40, cachedInput: 20, cacheWrite5m: 0, cacheWrite1h: 0, output: 5 });
    expect(second.activeMs).toBe(20_000);
    expect(second.sessionId).toBe('codex-one');
  });

  it('deduplicates Claude message snapshots and marks an unfinished request partial', async () => {
    const root = await fixture(); const a = join(root, 'a'); const b = join(root, 'b'); await mkdir(a); await mkdir(b);
    const file = join(root, 'claude.jsonl');
    const user = (cwd: string, timestamp: string) => JSON.stringify({ type: 'user', cwd, timestamp, sessionId: 'claude-one', message: { content: [{ type: 'text', text: 'not retained by parser' }] } });
    const assistant = (cwd: string, timestamp: string, output: number, stop: string | null) => JSON.stringify({ type: 'assistant', cwd, timestamp, sessionId: 'claude-one', message: { id: 'msg-1', model: 'claude-sonnet-4-6', stop_reason: stop, usage: { input_tokens: 3, cache_creation_input_tokens: 10, cache_read_input_tokens: 20, output_tokens: output, cache_creation: { ephemeral_1h_input_tokens: 10 } } } });
    await writeFile(file, [user(a, '2026-09-23T12:00:00Z'), assistant(a, '2026-09-23T12:00:05Z', 5, null), assistant(a, '2026-09-23T12:00:10Z', 8, 'end_turn'), user(b, '2026-09-23T12:01:00Z'), 'malformed'].join('\n'));
    const rows = await parseClaude(file);
    expect(rows).toHaveLength(2);
    const first = rows.find((row) => row.cwd === a)!;
    const second = rows.find((row) => row.cwd === b)!;
    expect(first.byModel.get('claude-sonnet-4-6')).toEqual({ input: 3, cachedInput: 20, cacheWrite5m: 0, cacheWrite1h: 10, output: 8 });
    expect(first.activeMs).toBe(10_000);
    expect(second.activePartial).toBe(true);
    expect(second.usageMissing).toBe(true);
  });
});

describe('project metrics and estimates', () => {
  it('marks unsupported prices unknown and counts source lines in nonignored files', async () => {
    const root = await fixture();
    await writeFile(join(root, '.gitignore'), 'secret.ts\n');
    await writeFile(join(root, 'app.ts'), 'const one = 1;\n\n// comment\nconst two = 2;\n');
    await writeFile(join(root, 'secret.ts'), 'const hidden = 1;\n');
    await mkdir(join(root, 'nested'));
    await writeFile(join(root, 'nested', '.gitignore'), 'hidden.py\n');
    await writeFile(join(root, 'nested', 'hidden.py'), 'print("hidden")\n');
    const code = await scanCode(root, false, true);
    expect(code).toMatchObject({ status: 'ready', lines: 3, files: 1 });
    expect(code.languages[0].name).toBe('TypeScript');
    const usage = { input: 100, cachedInput: 20, cacheWrite5m: 0, cacheWrite1h: 0, output: 10 };
    expect(tokenTotal(usage)).toBe(130);
    expect(estimateUsd('Codex', 'gpt-6-sol', usage)).toBeGreaterThan(0);
    expect(estimateUsd('Codex', 'unknown-model', usage)).toBeNull();
  });

  it('counts tracked and untracked nonignored files in a small Git repository', async () => {
    const root = await fixture();
    execFileSync('git', ['init', '-q', root]);
    await writeFile(join(root, '.gitignore'), 'generated.ts\n');
    await writeFile(join(root, 'tracked.ts'), 'const a = 1;\n\nconst b = 2;\n');
    await writeFile(join(root, 'untracked.py'), 'print(1)\n');
    await writeFile(join(root, 'generated.ts'), 'const hidden = 1;\n');
    execFileSync('git', ['-c', 'core.autocrlf=false', '-C', root, 'add', '.gitignore', 'tracked.ts']);
    const code = await scanCode(root, true, true);
    expect(code).toMatchObject({ status: 'ready', lines: 3, files: 2 });
    expect(code.languages.map((language) => language.name)).toEqual(['TypeScript', 'Python']);
  });

  it('keeps unpriced tokens and missing usage visible in the project total', async () => {
    const root = await fixture(); const project = join(root, 'project'); const codex = join(root, 'codex'); const claude = join(root, 'claude');
    await mkdir(project); await mkdir(codex); await mkdir(claude);
    await writeFile(join(project, 'main.py'), 'print(1)\n');
    await writeFile(join(codex, 'a.jsonl'), [
      record('session_meta', { id: 'a', cwd: project }, '2026-09-23T12:00:00Z'),
      record('turn_context', { cwd: project, model: 'unknown-model' }, '2026-09-23T12:00:00Z'),
      record('event_msg', { type: 'token_count', info: { total_token_usage: { input_tokens: 100, output_tokens: 10 } } }, '2026-09-23T12:00:01Z'),
    ].join('\n'));
    await writeFile(join(claude, 'b.jsonl'), JSON.stringify({ type: 'user', cwd: project, timestamp: '2026-09-23T12:01:00Z', sessionId: 'b', message: { content: 'hello' } }));
    process.env.AGENT_DASH_CODEX_DIR = codex; process.env.AGENT_DASH_CLAUDE_DIR = claude;
    try {
      const data = await buildDashboard(); const row = data.projects[0];
      expect(row.sessionCount).toBe(2);
      expect(row.unpricedTokens).toBe(110);
      expect(row.usageMissing).toBe(true);
      expect(row.estimatedUsd).toBe(0);
      expect(row.code.lines).toBe(1);
    } finally { delete process.env.AGENT_DASH_CODEX_DIR; delete process.env.AGENT_DASH_CLAUDE_DIR; }
  });
});
