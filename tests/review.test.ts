import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ProjectSummary } from '../src/types.ts';
import { ageDays, reviewPriority } from '../src/review.ts';
import { parseJevReview, previewReview, runJevReview } from '../server/review.ts';

const folders: string[] = [];
afterEach(async () => { for (const folder of folders.splice(0)) await rm(folder, { recursive: true, force: true }); });

function project(path = 'C:\\example', lastAgentAt: string | null = '2026-03-01T00:00:00Z'): ProjectSummary {
  return { id: 'one', name: 'Example', path, isGit: true, lastCommitAt: null, lastAgentAt,
    providers: ['Codex'], sessionCount: 12, tokens: 3_000_000, usageMissing: true,
    estimatedUsd: 25, unpricedTokens: 500_000, activeMs: 12 * 3_600_000, activePartial: true,
    spanMs: 0, spanPartial: false, code: { status: 'ready', lines: 1200, files: 8, languages: [] }, models: [], sessions: [] };
}

describe('project review', () => {
  it('prioritizes old recorded effort but leaves unknown activity unranked', () => {
    const now = new Date('2026-09-23T00:00:00Z');
    const old = project();
    const recent = project('C:\\example', '2026-09-20T00:00:00Z');
    expect(ageDays(old, now)).toBe(206);
    expect(reviewPriority(old, now)).toBeGreaterThan(reviewPriority(recent, now)!);
    expect(reviewPriority(project('C:\\example', null), now)).toBeNull();
    expect(reviewPriority({ ...old, estimatedUsd: 100_000 }, now)).toBe(reviewPriority(old, now));
  });

  it('previews only bounded top-level overview documents', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'current-review-'));
    folders.push(folder);
    await writeFile(join(folder, 'CURRENT_MILESTONE.md'), 'Next release: working demo');
    await writeFile(join(folder, 'README.md'), 'R'.repeat(9000));
    await writeFile(join(folder, '.env.local'), 'TYPESAFE_API_KEY=never-send');
    const preview = await previewReview(project(folder));
    expect(preview.documents.map((document) => document.name)).toEqual(['CURRENT_MILESTONE.md', 'README.md']);
    expect(preview.characters).toBeLessThanOrEqual(5600);
    expect(preview.documents[1]?.truncated).toBe(true);
    expect(JSON.stringify(preview)).not.toContain('never-send');
  });

  it('validates Jev scores and keeps usage unknown when absent', () => {
    const preview = { projectId: 'one', documents: [{ name: 'README.md', excerpt: 'Demo', truncated: false }], characters: 4 };
    const body = { model: 'jev-1.13', answers: {
      release_clarity: { type: 'score', score: 2.5, confidence: 0.7 },
      value_evidence: { type: 'score', score: 1.5, confidence: 0.4 },
    } };
    const review = parseJevReview('one', 'Make a demo', preview, body);
    expect(review.worthExploring).toBe(68);
    expect(review.inputTokens).toBeNull();
    expect(() => parseJevReview('one', 'Make a demo', preview, { ...body, answers: { ...body.answers, value_evidence: { type: 'score', score: 10, confidence: 0.4 } } })).toThrow('invalid score');
  });

  it('sends exactly the previewed notes and goal in one request', async () => {
    const preview = { projectId: 'one', documents: [{ name: 'README.md', excerpt: 'Small demo', truncated: false }], characters: 10 };
    const fetchMock = vi.fn(async (_url: string, options: RequestInit) => {
      const body = JSON.parse(String(options.body));
      expect(body.state.goal).toBe('Show a useful demo');
      expect(body.state.documents).toEqual([{ name: 'README.md', excerpt: 'Small demo' }]);
      expect(body.state).not.toHaveProperty('sessions');
      expect(Object.keys(body.questions)).toEqual(['release_clarity', 'value_evidence']);
      return Response.json({ model: 'jev-1.13', answers: {
        release_clarity: { type: 'score', score: 3, confidence: 0.9 },
        value_evidence: { type: 'score', score: 2, confidence: 0.8 },
      }, usage: { input_tokens: 240, output_tokens: 12 } });
    });
    const result = await runJevReview(project(), 'Show a useful demo', preview, 'local-test-key', fetchMock as typeof fetch);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.inputTokens).toBe(240);
  });
});
