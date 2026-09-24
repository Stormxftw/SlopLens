import { describe, expect, it } from 'vitest';
import type { ProjectSummary } from '../src/types.ts';
import { ageDays, reviewPriority } from '../src/review.ts';

function project(lastAgentAt: string | null = '2026-03-01T00:00:00Z'): ProjectSummary {
  return {
    id: 'one', name: 'Example', path: 'C:\\example', isGit: true, lastCommitAt: null, lastAgentAt,
    providers: ['Codex'], sessionCount: 12, tokens: 3_000_000, usageMissing: true,
    estimatedUsd: 25, unpricedTokens: 500_000, activeMs: 12 * 3_600_000, activePartial: true,
    spanMs: 0, spanPartial: false, code: { status: 'ready', lines: 1200, files: 8, languages: [] },
    tools: { status: 'available', categories: {}, delegationCount: 0 }, models: [], sessions: [],
  };
}

describe('review urgency', () => {
  it('prioritizes old recorded effort but leaves unknown activity unranked', () => {
    const now = new Date('2026-09-23T00:00:00Z');
    const old = project();
    const recent = project('2026-09-20T00:00:00Z');
    expect(ageDays(old, now)).toBe(206);
    expect(reviewPriority(old, now)).toBeGreaterThan(reviewPriority(recent, now)!);
    expect(reviewPriority(project(null), now)).toBeNull();
    expect(reviewPriority({ ...old, estimatedUsd: 100_000 }, now)).toBe(reviewPriority(old, now));
  });
});
