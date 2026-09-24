import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync } from 'node:fs';
import { lstat, opendir, readFile, realpath, stat } from 'node:fs/promises';
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import os from 'node:os';
import ignore from 'ignore';
import type { CodeMetrics, DashboardData, LanguageSummary, ModelUsage, ProjectSummary, Provider, SessionSummary, TokenUsage } from '../src/types.ts';
import { parseClaude, parseCodex, type Observation } from './parse.ts';
import { addUsage, emptyUsage, estimateUsd, PRICING_AS_OF, tokenTotal } from './pricing.ts';

const exec = promisify(execFile);
const SOURCE_DIRS = new Set(['node_modules', '.git', '.next', '.nuxt', '.venv', 'venv', 'dist', 'build', 'coverage', 'target', 'vendor', 'Library', 'Temp', 'Logs', 'obj', 'bin', '.cache', '.gradle', '.idea', '.codex', '.claude', 'AppData', '.npm', '.cargo', '.rustup', '.local', '.config'].map((name) => name.toLowerCase()));
const GENERATED_FILES = new Set(['package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', 'Cargo.lock', 'poetry.lock', 'uv.lock', 'bun.lock', 'bun.lockb', 'composer.lock']);
const EXTENSIONS: Record<string, string> = {
  '.ts': 'TypeScript', '.tsx': 'TypeScript', '.mts': 'TypeScript', '.cts': 'TypeScript',
  '.js': 'JavaScript', '.jsx': 'JavaScript', '.mjs': 'JavaScript', '.cjs': 'JavaScript',
  '.py': 'Python', '.rs': 'Rust', '.go': 'Go', '.cs': 'C#', '.java': 'Java',
  '.kt': 'Kotlin', '.kts': 'Kotlin', '.swift': 'Swift', '.rb': 'Ruby', '.php': 'PHP',
  '.c': 'C', '.h': 'C/C++', '.cc': 'C++', '.cpp': 'C++', '.hpp': 'C/C++',
  '.html': 'HTML', '.htm': 'HTML', '.css': 'CSS', '.scss': 'SCSS', '.sass': 'Sass',
  '.json': 'JSON', '.yaml': 'YAML', '.yml': 'YAML', '.toml': 'TOML',
  '.sh': 'Shell', '.bash': 'Shell', '.ps1': 'PowerShell', '.sql': 'SQL',
  '.gd': 'GDScript', '.shader': 'Shader', '.hlsl': 'Shader', '.wgsl': 'Shader',
  '.vue': 'Vue', '.svelte': 'Svelte', '.dart': 'Dart', '.lua': 'Lua',
};
const SPECIAL_NAMES: Record<string, string> = { Dockerfile: 'Dockerfile', Makefile: 'Makefile' };

async function* jsonlFiles(root: string, depth = 0): AsyncGenerator<string> {
  if (depth > 8) return;
  let dir;
  try { dir = await opendir(root); } catch { return; }
  for await (const entry of dir) {
    const child = join(root, entry.name);
    if (entry.isDirectory()) yield* jsonlFiles(child, depth + 1);
    else if (entry.isFile() && entry.name.endsWith('.jsonl')) yield child;
  }
}

export function localSourcePaths() {
  const home = os.homedir();
  return {
    codex: process.env.AGENT_DASH_CODEX_DIR ?? join(home, '.codex', 'sessions'),
    claude: process.env.AGENT_DASH_CLAUDE_DIR ?? join(home, '.claude', 'projects'),
  };
}

async function projectRoot(cwd: string): Promise<{ path: string; isGit: boolean; exists: boolean }> {
  if (!isAbsolute(cwd)) return { path: resolve(cwd), isGit: false, exists: false };
  let current: string;
  try {
    const resolved = await realpath(cwd);
    const info = await stat(resolved);
    current = info.isDirectory() ? resolved : dirname(resolved);
  } catch { return { path: resolve(cwd), isGit: false, exists: false }; }
  const actual = current;
  while (true) {
    if (existsSync(join(current, '.git'))) return { path: current, isGit: true, exists: true };
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return { path: actual, isGit: false, exists: true };
}

async function lastCommit(root: string): Promise<string | null> {
  try {
    const { stdout } = await exec('git', ['-c', `safe.directory=${root}`, '-C', root, 'log', '-1', '--format=%cI'], { timeout: 8000, maxBuffer: 1_000_000 });
    return stdout.trim() || null;
  } catch { return null; }
}

function inside(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return rel !== '' && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

async function gitFiles(root: string): Promise<string[] | null> {
  try {
    const { stdout } = await exec('git', ['-c', `safe.directory=${root}`, '-C', root, 'ls-files', '-co', '--exclude-standard', '-z'],
      { timeout: 20_000, maxBuffer: 60_000_000, encoding: 'buffer' });
    return stdout.toString('utf8').split('\0').filter(Boolean);
  } catch { return null; }
}

async function walkFiles(root: string): Promise<string[]> {
  const found: string[] = [];
  let seen = 0;
  let truncated = false;
  const deadline = Date.now() + 8_000;
  type Rule = { base: string; matcher: ReturnType<typeof ignore> };
  async function visit(directory: string, depth: number, inherited: Rule[]): Promise<void> {
    if (depth > 16 || found.length >= 8_000 || seen >= 20_000 || Date.now() > deadline) { truncated = true; return; }
    const rules = [...inherited];
    try { rules.push({ base: directory, matcher: ignore().add(await readFile(join(directory, '.gitignore'), 'utf8')) }); }
    catch { /* optional */ }
    let dir;
    try { dir = await opendir(directory); } catch { return; }
    for await (const entry of dir) {
      if (found.length >= 8_000 || seen >= 20_000 || Date.now() > deadline) { truncated = true; break; }
      seen += 1;
      if (SOURCE_DIRS.has(entry.name.toLowerCase())) continue;
      const full = join(directory, entry.name);
      const rel = relative(root, full).replaceAll('\\', '/');
      if (rules.some((rule) => rule.matcher.ignores(relative(rule.base, full).replaceAll('\\', '/') + (entry.isDirectory() ? '/' : '')))) continue;
      if (entry.isDirectory()) await visit(full, depth + 1, rules);
      else if (entry.isFile()) found.push(rel);
    }
  }
  await visit(root, 0, []);
  if (truncated) found.push('__AGENT_DASH_SCAN_TRUNCATED__');
  return found;
}

export async function scanCode(root: string, isGit: boolean, exists: boolean): Promise<CodeMetrics> {
  if (!exists) return { status: 'missing', lines: null, files: null, languages: [], note: 'Project folder is no longer available.' };
  if (!isGit && (root.toLowerCase() === os.homedir().toLowerCase() || dirname(root) === root))
    return { status: 'partial', lines: null, files: null, languages: [], note: 'General working directory: source scan skipped to avoid unrelated files.' };
  const listed = isGit ? await gitFiles(root) : null;
  const paths = listed ?? await walkFiles(root);
  const languageMap = new Map<string, LanguageSummary>();
  let files = 0;
  let lines = 0;
  let partial = (listed === null && isGit) || paths.includes('__AGENT_DASH_SCAN_TRUNCATED__');
  let bytesRead = 0;
  for (const rel of paths) {
    if (files >= 8_000 || bytesRead >= 50_000_000) { partial = true; break; }
    const full = resolve(root, rel);
    if (!inside(root, full) || rel.split(/[\\/]/).some((part) => SOURCE_DIRS.has(part.toLowerCase()))) continue;
    if (GENERATED_FILES.has(basename(rel))) continue;
    const language = EXTENSIONS[extname(rel).toLowerCase()] ?? SPECIAL_NAMES[basename(rel)];
    if (!language) continue;
    let info;
    try { info = await lstat(full); } catch { continue; }
    if (!info.isFile() || info.size > 2_000_000) { if (info.size > 2_000_000) partial = true; continue; }
    let content: string;
    try { content = await readFile(full, 'utf8'); } catch { partial = true; continue; }
    if (content.includes('\0')) continue;
    bytesRead += info.size;
    const count = content.split(/\r?\n/).filter((line) => line.trim().length > 0).length;
    files += 1;
    lines += count;
    const entry = languageMap.get(language) ?? { name: language, lines: 0, files: 0 };
    entry.lines += count;
    entry.files += 1;
    languageMap.set(language, entry);
  }
  return { status: partial ? 'partial' : 'ready', lines, files,
    languages: [...languageMap.values()].sort((a, b) => b.lines - a.lines),
    ...(partial ? { note: 'Some files could not be counted or scan limits were reached.' } : {}) };
}

interface ProjectBuilder {
  root: string;
  isGit: boolean;
  exists: boolean;
  sessions: Map<string, Observation>;
}

function combineObservation(target: Observation, other: Observation): void {
  if (other.firstAt !== null) target.firstAt = target.firstAt === null ? other.firstAt : Math.min(target.firstAt, other.firstAt);
  if (other.lastAt !== null) target.lastAt = target.lastAt === null ? other.lastAt : Math.max(target.lastAt, other.lastAt);
  target.activeMs += other.activeMs;
  target.activePartial ||= other.activePartial;
  target.usageMissing ||= other.usageMissing;
  target.toolPartial ||= other.toolPartial;
  target.delegationCount += other.delegationCount;
  for (const [category, count] of Object.entries(other.toolCategories)) {
    target.toolCategories[category] = (target.toolCategories[category] ?? 0) + count;
  }
  for (const [model, usage] of other.byModel) target.byModel.set(model, addUsage(target.byModel.get(model) ?? emptyUsage(), usage));
}

function modelRows(observations: Observation[]): ModelUsage[] {
  const map = new Map<string, ModelUsage>();
  for (const row of observations) for (const [model, usage] of row.byModel) {
    const key = `${row.provider}\0${model}`;
    const entry = map.get(key) ?? { provider: row.provider, model, usage: emptyUsage(), tokens: 0, estimatedUsd: null, priceKnown: false };
    entry.usage = addUsage(entry.usage, usage);
    entry.tokens = tokenTotal(entry.usage);
    entry.estimatedUsd = estimateUsd(entry.provider, model, entry.usage);
    entry.priceKnown = entry.estimatedUsd !== null;
    map.set(key, entry);
  }
  return [...map.values()].sort((a, b) => b.tokens - a.tokens);
}

function sessionSummary(row: Observation): SessionSummary {
  const models = modelRows([row]);
  return {
    id: row.sessionId, provider: row.provider,
    startedAt: row.firstAt === null ? null : new Date(row.firstAt).toISOString(),
    endedAt: row.lastAt === null ? null : new Date(row.lastAt).toISOString(),
    activeMs: row.activeMs, activePartial: row.activePartial,
    spanMs: row.firstAt !== null && row.lastAt !== null ? row.lastAt - row.firstAt : null,
    tokens: models.reduce((sum, m) => sum + m.tokens, 0), usageMissing: row.usageMissing,
    estimatedUsd: models.reduce((sum, m) => sum + (m.estimatedUsd ?? 0), 0),
    unpricedTokens: models.reduce((sum, m) => sum + (m.priceKnown ? 0 : m.tokens), 0),
    models: models.map((m) => m.model),
  };
}

export async function buildDashboard(onProgress: (message: string) => void = () => {}): Promise<DashboardData> {
  const sources = localSourcePaths();
  const codexFiles: string[] = [];
  const claudeFiles: string[] = [];
  for await (const file of jsonlFiles(sources.codex)) codexFiles.push(file);
  for await (const file of jsonlFiles(sources.claude)) claudeFiles.push(file);
  const errors = { Codex: 0, 'Claude Code': 0 };
  const observations: Observation[] = [];
  const jobs: { provider: Provider; file: string }[] = [
    ...codexFiles.map((file) => ({ provider: 'Codex' as const, file })),
    ...claudeFiles.map((file) => ({ provider: 'Claude Code' as const, file })),
  ];
  let next = 0;
  let done = 0;
  async function worker(): Promise<void> {
    while (next < jobs.length) {
      const job = jobs[next++];
      try { observations.push(...await (job.provider === 'Codex' ? parseCodex(job.file) : parseClaude(job.file))); }
      catch { errors[job.provider] += 1; }
      done += 1;
      if (done % 10 === 0 || done === jobs.length) onProgress(`Reading agent history · ${done} of ${jobs.length} files`);
    }
  }
  onProgress(`Reading agent history · 0 of ${jobs.length} files`);
  await Promise.all(Array.from({ length: Math.min(4, jobs.length) }, () => worker()));
  const roots = new Map<string, { path: string; isGit: boolean; exists: boolean }>();
  const projects = new Map<string, ProjectBuilder>();
  for (let index = 0; index < observations.length; index++) {
    const row = observations[index];
    let root = roots.get(row.cwd);
    if (!root) { root = await projectRoot(row.cwd); roots.set(row.cwd, root); }
    const key = process.platform === 'win32' ? root.path.toLowerCase() : root.path;
    let builder = projects.get(key);
    if (!builder) { builder = { root: root.path, isGit: root.isGit, exists: root.exists, sessions: new Map() }; projects.set(key, builder); }
    const sessionKey = `${row.provider}\0${row.sessionId}`;
    const prior = builder.sessions.get(sessionKey);
    if (prior) combineObservation(prior, row);
    else builder.sessions.set(sessionKey, row);
  }
  const summaries: ProjectSummary[] = [];
  let scanned = 0;
  for (const builder of projects.values()) {
    scanned += 1;
    onProgress(`Scanning project code · ${scanned} of ${projects.size}`);
    const rows = [...builder.sessions.values()];
    const sessions = rows.map(sessionSummary).sort((a, b) => (b.endedAt ?? '').localeCompare(a.endedAt ?? ''));
    const models = modelRows(rows);
    const code = await scanCode(builder.root, builder.isGit, builder.exists);
    const commit = builder.isGit ? await lastCommit(builder.root) : null;
    const lastAt = rows.reduce<number | null>((max, row) => row.lastAt !== null && (max === null || row.lastAt > max) ? row.lastAt : max, null);
    summaries.push({
      id: createHash('sha1').update(process.platform === 'win32' ? builder.root.toLowerCase() : builder.root).digest('hex').slice(0, 14),
      name: basename(builder.root) || builder.root, path: builder.root, isGit: builder.isGit,
      lastCommitAt: commit, lastAgentAt: lastAt === null ? null : new Date(lastAt).toISOString(),
      providers: [...new Set(rows.map((row) => row.provider))], sessionCount: rows.length,
      tokens: sessions.reduce((sum, session) => sum + session.tokens, 0),
      usageMissing: sessions.some((session) => session.usageMissing),
      estimatedUsd: sessions.reduce((sum, session) => sum + session.estimatedUsd, 0),
      unpricedTokens: sessions.reduce((sum, session) => sum + session.unpricedTokens, 0),
      activeMs: sessions.reduce((sum, session) => sum + session.activeMs, 0),
      activePartial: sessions.some((session) => session.activePartial),
      spanMs: sessions.reduce((sum, session) => sum + (session.spanMs ?? 0), 0),
      spanPartial: sessions.some((session) => session.spanMs === null), code, models, sessions,
      tools: {
        status: rows.some((row) => row.toolPartial) ? 'partial' : 'available',
        categories: rows.reduce<Record<string, number>>((total, row) => {
          for (const [category, count] of Object.entries(row.toolCategories)) total[category] = (total[category] ?? 0) + count;
          return total;
        }, {}),
        delegationCount: rows.reduce((sum, row) => sum + row.delegationCount, 0),
      },
    });
  }
  summaries.sort((a, b) => (b.lastAgentAt ?? '').localeCompare(a.lastAgentAt ?? ''));
  return { generatedAt: new Date().toISOString(), pricingAsOf: PRICING_AS_OF, projects: summaries,
    sources: [{ provider: 'Codex', files: codexFiles.length, errors: errors.Codex },
      { provider: 'Claude Code', files: claudeFiles.length, errors: errors['Claude Code'] }] };
}
