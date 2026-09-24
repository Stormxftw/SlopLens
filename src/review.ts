import type { ProjectSummary } from './types.ts';

export function ageDays(project: ProjectSummary, now = new Date()): number | null {
  if (!project.lastAgentAt) return null;
  const timestamp = Date.parse(project.lastAgentAt);
  return Number.isFinite(timestamp) ? Math.max(0, Math.floor((now.getTime() - timestamp) / 86_400_000)) : null;
}

// A review queue, not an estimate of future value. Missing usage remains missing in the UI.
export function reviewPriority(project: ProjectSummary, now = new Date()): number | null {
  const age = ageDays(project, now);
  if (age === null) return null;
  const ageFactor = Math.min(1, age / 180);
  const effort = 0.45 * Math.min(1, project.activeMs / (20 * 3_600_000))
    + 0.35 * Math.min(1, project.tokens / 5_000_000)
    + 0.20 * Math.min(1, project.sessionCount / 20);
  return Math.round(100 * ageFactor * effort);
}
