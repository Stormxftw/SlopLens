import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DashboardData, ProjectSummary } from '../src/types.ts';
import { parseClaude, parseCodex } from '../server/parse.ts';
import { buildReviewPackage, localEvidenceGap, needsDeepReview, parsePortfolioReview, reconcilePortfolioReview, runPortfolioReview, type Evidence, type PortfolioReview } from '../server/portfolio-review.ts';
import { explanationBrief, hasDocumentedLead, reviewLanguage } from '../src/review-language.ts';
import { auditEvidence, eligibleForDimension, type ReviewDimension } from '../src/evidence-quality.ts';

const folders: string[] = [];
afterEach(async () => {
  for (const folder of folders.splice(0)) await rm(folder, { recursive: true, force: true });
  delete process.env.AGENT_DASH_REVIEW_CACHE;
});
async function folder() {
  const path = await mkdtemp(join(tmpdir(), 'sloplens-review-'));
  folders.push(path);
  return path;
}
function project(path: string, id = 'one'): ProjectSummary {
  return {
    id, name: 'Private Example', path, isGit: false, lastCommitAt: null, lastAgentAt: '2026-09-23T00:00:00Z',
    providers: ['Codex'], sessionCount: 1, tokens: 2000, usageMissing: false, estimatedUsd: 0.25,
    unpricedTokens: 0, activeMs: 30000, activePartial: false, spanMs: 30000, spanPartial: false,
    code: { status: 'ready', lines: 90, files: 3, languages: [{ name: 'TypeScript', lines: 90, files: 3 }] },
    tools: { status: 'available', categories: { edit: 2, command: 1 }, delegationCount: 0 },
    models: [], sessions: [{ id: 'secret-session-id', provider: 'Codex', startedAt: null,
      endedAt: '2026-09-23T00:00:00Z', activeMs: 30000, activePartial: false, spanMs: 30000,
      tokens: 2000, usageMissing: false, estimatedUsd: 0.25, unpricedTokens: 0, models: [] }],
  };
}
function answer(pkg: Awaited<ReturnType<typeof buildReviewPackage>>, values: { low?: boolean; blocker?: string } = {}) {
  const evidence = pkg.base.state.evidence as Evidence[];
  const cite = (dimension: ReviewDimension) => ({ type: 'choice',
    choice: evidence.find((item) => eligibleForDimension(item, dimension))?.id ?? 'none', confidence: 0.9 });
  const score = values.low ? 1 : 2.5;
  const confidence = values.low ? 0.4 : 0.9;
  return { model: 'jev-test', usage: { input_tokens: 100, output_tokens: 20 }, answers: {
    working_output: { type: 'score', score, confidence },
    next_release: { type: 'score', score, confidence },
    use_case: { type: 'score', score, confidence },
    blocker: { type: 'choice', choice: values.blocker ?? 'no_documented_blocker', confidence: 0.9 },
    effort_return: { type: 'choice', choice: 'modest_effort', confidence: 0.9 },
    working_evidence: cite('workingOutput'), next_evidence: cite('nextRelease'), use_evidence: cite('useCase'),
    concern: { type: 'choice', choice: values.blocker === 'explicit_no_value_or_duplicate' ? evidence[1]?.id ?? 'none' : 'none', confidence: 0.9 },
  } };
}

describe('portfolio evidence and judgments', () => {
  it('finds late current actions and acceptance items without losing long safe evidence or section context', async () => {
    const path = await folder();
    const longReport = 'A working export workflow was verified. ' + 'The export preserves the report headings and column order. '.repeat(12);
    const content = ['# Current milestone', ...Array.from({ length: 45 }, (_, index) => index === 0
      ? '**Next action:** Resume the user integration checklist.' : 'General background detail ' + index + ' about the application.'),
      longReport, '## Acceptance', '- [ ] Verify the implemented export in a clean browser.',
      '## Next action', 'Finish the live export acceptance run, then record its result.',
      '## Future expansion', '- [ ] Build a second interface after this release.'];
    await writeFile(join(path, 'CURRENT_MILESTONE.md'), content.join('\n'));
    await writeFile(join(path, 'README.md'), 'A designer can export a report for a client.\n' + 'Private background. '.repeat(40) + 'Contact person@example.com\n');
    const pkg = await buildReviewPackage(project(path));
    const base = pkg.base.state.evidence as Evidence[];
    const deep = pkg.deep!.state.evidence as Evidence[];
    expect(base.some((item) => item.text === longReport.trim())).toBe(true);
    expect(base.some((item) => item.line === 51 && item.section?.includes('Next action'))).toBe(true);
    expect(base.some((item) => item.text.includes('Verify the implemented export'))).toBe(true);
    expect(base.some((item) => item.text.startsWith('#'))).toBe(false);
    expect(base.length).toBeLessThanOrEqual(20);
    expect(deep.length).toBeLessThanOrEqual(42);
    expect(base.reduce((sum, item) => sum + item.text.length + (item.section?.length ?? 0), 0)).toBeLessThanOrEqual(6500);
    expect(deep.reduce((sum, item) => sum + item.text.length + (item.section?.length ?? 0), 0)).toBeLessThanOrEqual(16000);
    expect(base.every((item) => deep.some((other) => other.id === item.id))).toBe(true);
    expect(JSON.stringify(pkg)).not.toContain('person@example.com');
    const review = parsePortfolioReview(pkg, answer(pkg), 'base');
    expect(reviewLanguage(review, pkg).nextEvidence?.text).toContain('Finish the live export');
  });

  it('rejects invented or unsent citations and never presents an open test as completed output', async () => {
    const path = await folder();
    await writeFile(join(path, 'CURRENT_MILESTONE.md'), '# Acceptance\n- [ ] Verify the implemented export in a real browser.\nNext action: finish the live acceptance run.\n');
    await writeFile(join(path, 'README.md'), 'A designer can export a useful report.\n' + Array.from({ length: 40 }, (_, index) => 'Reference detail ' + index + ' about the report format.').join('\n'));
    const pkg = await buildReviewPackage(project(path));
    const body = answer(pkg);
    body.answers.working_evidence.choice = 'invented';
    expect(() => parsePortfolioReview(pkg, body, 'base')).toThrow('invalid choice');
    const baseIds = (pkg.base.state.evidence as Evidence[]).map((item) => item.id);
    body.answers.working_evidence.choice = pkg.evidence.find((item) => !baseIds.includes(item.id))!.id;
    expect(() => parsePortfolioReview(pkg, body, 'base')).toThrow('invalid choice');
    body.answers.working_evidence.choice = pkg.evidence.find((item) => item.text.startsWith('- [ ]'))!.id;
    const review = parsePortfolioReview(pkg, body, 'base');
    expect(auditEvidence(review, pkg).workingOutput).toBeNull();
    expect(review.disposition).toBe('investigate');
    expect(reviewLanguage(review, pkg).findings[0].text).toContain('not established');
    expect(reviewLanguage(review, pkg).limitations).toContain('not that implementation is absent');
    expect(auditEvidence(review, { ...pkg, fingerprint: 'changed' }).useCase).toBeNull();
  });

  it('requires confidence for both judgments and citations and blocks contradictory roles', async () => {
    const path = await folder();
    await writeFile(join(path, 'README.md'), 'A working export workflow is verified.\nNext release: finish the report export acceptance.\nA designer can export a useful report.\n');
    const pkg = await buildReviewPackage(project(path));
    const body = answer(pkg);
    expect(parsePortfolioReview(pkg, body, 'base').disposition).toBe('finish_candidate');
    body.answers.use_case.confidence = 0.4;
    const uncertainRating = parsePortfolioReview(pkg, body, 'base');
    expect(uncertainRating.disposition).toBe('investigate');
    expect(auditEvidence(uncertainRating, pkg).useCase).not.toBeNull();
    expect(reviewLanguage(uncertainRating, pkg).findings[2].text).toContain('intended user');
    body.answers.use_case.confidence = 0.9;
    body.answers.working_evidence.confidence = 0.3;
    expect(parsePortfolioReview(pkg, body, 'base').disposition).toBe('investigate');
    body.answers.working_evidence.confidence = 0.9;
    body.answers.concern.choice = body.answers.working_evidence.choice;
    expect(auditEvidence(parsePortfolioReview(pkg, body, 'base'), pkg).workingOutput).toBeNull();
  });

  it('screens private lines, includes allowed notes, and never sends paths or session IDs', async () => {
    const path = await folder();
    await mkdir(join(path, 'plans'));
    await writeFile(join(path, 'CURRENT_MILESTONE.md'),
      '# Current milestone\nA working export command has a verified demo.\nNext release: share the demo.\nAPI_KEY=very-secret-value\nContact dev@example.com\nC:\\\\Users\\\\person\\\\private.txt\nPASSWORD:\nshortvalue\n');
    await writeFile(join(path, 'plans', '001.md'), 'Specific user: a designer exporting a report.\n');
    await writeFile(join(path, 'PROJECT_STATE.md'), [
      'Verification journal is stored under %LOCALAPPDATA%/Temp/private/commands.db.',
      'A real run_1234567890abcdef1234567890abcdef completed the test.',
      'The session was 12345678-1234-1234-1234-123456789abc.',
      'The working folder is C:/Users/person/private.',
      'The Linux working folder is /tmp/private-project.',
    ].join('\n'));
    const pkg = await buildReviewPackage(project(path));
    const body = JSON.stringify(pkg.base);
    expect(body).toContain('working export command');
    expect(body).toContain('designer exporting');
    expect(body).not.toContain('very-secret-value');
    expect(body).not.toContain('shortvalue');
    expect(body).not.toContain('dev@example.com');
    expect(body).not.toContain('secret-session-id');
    expect(body).not.toMatch(/LOCALAPPDATA|run_123|12345678-1234|private-project|C:\/Users/);
    expect(body).not.toContain(path);
    expect(pkg.omitted.unsafe).toBeGreaterThanOrEqual(3);
    expect(pkg.bytes.base).toBeLessThan(15_000);
  });

  it('keeps thin evidence in investigate and requires a cited concern for a negative suggestion', async () => {
    const path = await folder();
    const thin = await buildReviewPackage(project(path));
    expect(parsePortfolioReview(thin, answer(thin), 'base').disposition).toBe('investigate');
    await writeFile(join(path, 'README.md'), 'This project duplicates an existing working tool.\nThe next release has no distinct user need.\n');
    const rich = await buildReviewPackage(project(path));
    const negative = parsePortfolioReview(rich, answer(rich, { blocker: 'explicit_no_value_or_duplicate' }), 'base');
    expect(negative.disposition).toBe('deprioritize_candidate');
    expect(negative.concernId).toBeTruthy();
    const low = parsePortfolioReview(rich, answer(rich, { low: true }), 'base');
    expect(low.disposition).toBe('investigate');
    expect(() => parsePortfolioReview(rich, { answers: { ...answer(rich).answers,
      use_case: { type: 'score', score: Number.NaN, confidence: 0.9 } } }, 'base')).toThrow('invalid score');
    expect(needsDeepReview(low, rich)).toBe(false);
  });

  it('does not turn negated archive language or missing notes into a recommendation', async () => {
    const path = await folder();
    await writeFile(join(path, 'README.md'), 'Do not archive this project; a useful workflow is working.\nA specific user can export a report.\n');
    const pkg = await buildReviewPackage(project(path));
    const candidate = answer(pkg, { blocker: 'explicit_no_value_or_duplicate' });
    candidate.answers.concern.choice = 'e1';
    const review = parsePortfolioReview(pkg, candidate, 'base');
    expect(review.disposition).toBe('investigate');
    expect(reconcilePortfolioReview({ ...review, disposition: 'deprioritize_candidate' }, pkg).disposition).toBe('investigate');
    const emptyPath = await folder();
    const empty = await buildReviewPackage(project(emptyPath));
    const emptyReview = parsePortfolioReview(empty, answer(empty), 'base');
    expect(hasDocumentedLead(emptyReview, empty)).toBe(false);
    expect(reviewLanguage(emptyReview, empty).title).toBe('Not enough project evidence');
  });

  it('exports a grounded AI brief without project identity or unsupported evidence', async () => {
    const path = await folder();
    await writeFile(join(path, 'README.md'), 'A designer can export a useful report.\nThe next release verifies the export.\n');
    const pkg = await buildReviewPackage(project(path));
    const review = parsePortfolioReview(pkg, answer(pkg), 'base');
    const brief = explanationBrief(review, pkg);
    expect(brief).toContain('A designer can export');
    expect(brief).toContain('Distinguish documented facts from model judgments');
    expect(brief).not.toContain(path);
    expect(brief).not.toContain('Private Example');
    expect(brief).not.toContain('secret-session-id');
    expect(JSON.parse(brief).selected_evidence).toHaveLength(2);
    expect(hasDocumentedLead(review, pkg)).toBe(true);
    const navigation = await folder();
    await writeFile(join(navigation, 'README.md'), '1. Open `NEXT_STEP.md`.\nThe files here avoid private account details.\n');
    const navPkg = await buildReviewPackage(project(navigation));
    const navReview = parsePortfolioReview(navPkg, answer(navPkg), 'base');
    expect(hasDocumentedLead(navReview, navPkg)).toBe(false);
    expect(explanationBrief(navReview, navPkg)).toContain('Citation checks test existence');
    await writeFile(join(navigation, 'README.md'), 'This starter does not use a deployment config file.\nThe same line is selected twice.\n');
    const configPkg = await buildReviewPackage(project(navigation));
    expect(hasDocumentedLead(parsePortfolioReview(configPkg, answer(configPkg), 'base'), configPkg)).toBe(false);
    await writeFile(join(navigation, 'README.md'), '- `npx electron .`: Run the app with a local shell.\nExternal docs describe the available workflow.\n');
    const commandPkg = await buildReviewPackage(project(navigation));
    expect(hasDocumentedLead(parsePortfolioReview(commandPkg, answer(commandPkg), 'base'), commandPkg)).toBe(false);
  });

  it('uses the exact previewed body and expands only when safe omitted evidence exists', async () => {
    const path = await folder();
    await writeFile(join(path, 'README.md'), Array.from({ length: 35 }, (_, index) =>
      'Evidence item ' + index + ': a user can run and verify a small useful workflow.').join('\n'));
    const pkg = await buildReviewPackage(project(path));
    expect(pkg.deep).not.toBeNull();
    const bodies: string[] = [];
    const fetchMock = vi.fn(async (_url: string, options: RequestInit) => {
      bodies.push(String(options.body));
      return Response.json(answer(pkg, { low: bodies.length === 1 }));
    });
    const first = await runPortfolioReview(pkg, 'test-key', 'base', fetchMock as typeof fetch);
    expect(first.disposition).toBe('investigate');
    expect(needsDeepReview(first, pkg)).toBe(true);
    await runPortfolioReview(pkg, 'test-key', 'deep', fetchMock as typeof fetch);
    expect(bodies).toEqual([JSON.stringify(pkg.base), JSON.stringify(pkg.deep)]);
  });

  it('deduplicates recognizable Codex and Claude tool calls without retaining their content', async () => {
    const path = await folder();
    const codex = join(path, 'codex.jsonl');
    const record = (type: string, payload: object) => JSON.stringify({ type, payload, timestamp: '2026-09-23T00:00:00Z' });
    await writeFile(codex, [
      record('session_meta', { id: 'c1', cwd: path }), record('turn_context', { cwd: path, model: 'test' }),
      record('response_item', { type: 'function_call', name: 'functions.exec_command', call_id: 'a', arguments: 'private command' }),
      record('response_item', { type: 'function_call', name: 'functions.exec_command', call_id: 'a', arguments: 'private command' }),
      record('response_item', { type: 'function_call', name: 'collaboration.spawn_agent', call_id: 'b' }),
    ].join('\n'));
    const codexRow = (await parseCodex(codex))[0];
    expect(codexRow.toolCategories).toEqual({ command: 1, delegation: 1 });
    expect(codexRow.delegationCount).toBe(1);
    expect(JSON.stringify(codexRow)).not.toContain('private command');
    const claude = join(path, 'claude.jsonl');
    const message = (uuid: string) => JSON.stringify({ type: 'assistant', cwd: path, sessionId: 'a',
      uuid, timestamp: '2026-09-23T00:00:00Z', message: { id: 'm', model: 'test',
        content: [{ type: 'tool_use', id: 'tool-1', name: 'Read', input: { path: 'private' } }] } });
    await writeFile(claude, [message('a'), message('b')].join('\n'));
    const claudeRow = (await parseClaude(claude))[0];
    expect(claudeRow.toolCategories).toEqual({ read: 1 });
    expect(JSON.stringify(claudeRow)).not.toContain('private');
  });

  it('reuses matching metadata, invalidates changed notes, and preserves partial batch success', async () => {
    const path = await folder();
    process.env.AGENT_DASH_REVIEW_CACHE = join(path, 'reviews.json');
    vi.resetModules();
    const batch = await import('../server/review-batch.ts');
    const first = join(path, 'first');
    const second = join(path, 'second');
    await mkdir(first); await mkdir(second);
    await writeFile(join(first, 'README.md'), 'A useful workflow is verified.\nA small next release is defined.\n');
    await writeFile(join(second, 'README.md'), 'Another useful workflow is verified.\nA small next release is defined.\n');
    const data: DashboardData = { generatedAt: 'now', pricingAsOf: '2026-09-23',
      projects: [project(first, 'first'), project(second, 'second')], sources: [] };
    const preview = await batch.prepareBatch(data);
    let calls = 0;
    const runner = async (pkg: typeof preview.projects[number], _key: string, mode: 'base' | 'deep'): Promise<PortfolioReview> => {
      calls += 1;
      if (pkg.projectId === 'second') throw new Error('Synthetic service failure');
      return parsePortfolioReview(pkg, answer(pkg), mode);
    };
    await batch.startBatch(preview, 'test-key', {}, runner);
    for (let index = 0; index < 100 && batch.batchStatus()?.state === 'running'; index++) await new Promise((resolve) => setTimeout(resolve, 10));
    expect(batch.batchStatus()?.succeeded).toBe(1);
    expect(batch.batchStatus()?.failed).toHaveLength(1);
    expect(await batch.validReviews(preview)).toHaveLength(1);
    expect(JSON.stringify(JSON.parse(await readFile(process.env.AGENT_DASH_REVIEW_CACHE, 'utf8')))).not.toContain('useful workflow');
    await batch.startBatch(preview, 'test-key', { projectIds: ['first'] }, runner);
    for (let index = 0; index < 100 && batch.batchStatus()?.state === 'running'; index++) await new Promise((resolve) => setTimeout(resolve, 10));
    expect(batch.batchStatus()?.reused).toBe(1);
    expect(calls).toBe(2);
    expect(await batch.validReviews(await batch.prepareBatch({ ...data, projects: data.projects.map((item) => ({ ...item, tokens: item.tokens + 1 })) }))).toHaveLength(0);
    await writeFile(join(first, 'README.md'), 'The release changed to a different workflow.\n');
    expect(await batch.validReviews(await batch.prepareBatch(data))).toHaveLength(0);
  });

  it('handles absent evidence locally and keeps the base result when automatic expansion fails', async () => {
    const path = await folder();
    process.env.AGENT_DASH_REVIEW_CACHE = join(path, 'reviews.json');
    vi.resetModules();
    const batch = await import('../server/review-batch.ts');
    const empty = join(path, 'empty');
    const rich = join(path, 'rich');
    await mkdir(empty); await mkdir(rich);
    await writeFile(join(rich, 'README.md'), Array.from({ length: 35 }, (_, index) => 'A user can export a report variant ' + index + ' for a client.').join('\n'));
    const data: DashboardData = { generatedAt: 'now', pricingAsOf: '2026-09-23', projects: [project(empty, 'empty'), project(rich, 'rich')], sources: [] };
    const preview = await batch.prepareBatch(data);
    expect(preview.maxCalls).toBe(2);
    expect(preview.localOnly).toBe(1);
    const runner = vi.fn(async (pkg: typeof preview.projects[number], _key: string, mode: 'base' | 'deep') => {
      if (mode === 'deep') throw new Error('Synthetic timeout');
      return parsePortfolioReview(pkg, answer(pkg, { low: true }), mode);
    });
    await batch.startBatch(preview, 'test-key', {}, runner);
    for (let index = 0; index < 100 && batch.batchRunning(); index++) await new Promise((resolve) => setTimeout(resolve, 10));
    expect(runner).toHaveBeenCalledTimes(2);
    expect(batch.batchStatus()).toMatchObject({ done: 2, succeeded: 1, local: 1, failed: [] });
    expect(batch.batchStatus()?.warnings).toHaveLength(1);
    const results = await batch.validReviews(preview);
    expect(results).toHaveLength(2);
    expect(results.find((item) => item.projectId === 'rich')?.mode).toBe('base');
    const local = results.find((item) => item.projectId === 'empty')!;
    expect(local).toMatchObject({ engine: 'local', inputTokens: 0, disposition: 'investigate' });
    expect(reviewLanguage(local, preview.projects[0]).findings).toEqual([]);
    expect(JSON.parse(explanationBrief(localEvidenceGap(preview.projects[0]), preview.projects[0])).assessment.ratings_out_of_3).toBeNull();
    const saved = await readFile(process.env.AGENT_DASH_REVIEW_CACHE, 'utf8');
    expect(saved).not.toContain('A user can export');
    expect(JSON.parse(saved).version).toBe(2);
    const next = await batch.prepareBatch(data);
    expect(next.maxCalls).toBe(0);
    await batch.startBatch(next, '', {}, runner);
    for (let index = 0; index < 100 && batch.batchRunning(); index++) await new Promise((resolve) => setTimeout(resolve, 10));
    expect(batch.batchStatus()?.reused).toBe(2);
    expect(runner).toHaveBeenCalledTimes(2);
  });
});
