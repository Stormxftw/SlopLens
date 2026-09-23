import { lstat, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ProjectSummary } from '../src/types.ts';
import type { JevReview, ReviewPreview } from '../src/review.ts';
export type { JevReview, ReviewPreview } from '../src/review.ts';

const DOCUMENTS = ['CURRENT_MILESTONE.md', 'PROJECT_STATE.md', 'README.md'];
const MAX_DOCUMENT_CHARS = 2800;
const MAX_TOTAL_CHARS = 5600;
const ENDPOINT = 'https://api.typesafe.ai/v1/systemone';

export async function previewReview(project: ProjectSummary): Promise<ReviewPreview> {
  const documents: ReviewPreview['documents'] = [];
  if (project.code.status === 'missing') return { projectId: project.id, documents, characters: 0 };
  let remaining = MAX_TOTAL_CHARS;
  for (const name of DOCUMENTS) {
    if (remaining <= 0) break;
    const file = join(project.path, name);
    try {
      const info = await lstat(file);
      if (!info.isFile() || info.size > 100_000) continue;
      const source = await readFile(file, 'utf8');
      const limit = Math.min(MAX_DOCUMENT_CHARS, remaining);
      const excerpt = source.slice(0, limit);
      documents.push({ name, excerpt, truncated: source.length > excerpt.length });
      remaining -= excerpt.length;
    } catch { /* Optional document is absent or unreadable. */ }
  }
  return { projectId: project.id, documents, characters: MAX_TOTAL_CHARS - remaining };
}

function scoreAnswer(value: unknown): { score: number; confidence: number } {
  if (!value || typeof value !== 'object') throw new Error('Jev returned an invalid score answer.');
  const answer = value as Record<string, unknown>;
  if (answer.type !== 'score' || typeof answer.score !== 'number' || typeof answer.confidence !== 'number'
      || !Number.isFinite(answer.score) || answer.score < 0 || answer.score > 3
      || !Number.isFinite(answer.confidence) || answer.confidence < 0 || answer.confidence > 1) {
    throw new Error('Jev returned an invalid score answer.');
  }
  return { score: answer.score, confidence: answer.confidence };
}

export function parseJevReview(projectId: string, goal: string, preview: ReviewPreview, body: unknown): JevReview {
  if (!body || typeof body !== 'object') throw new Error('Jev returned an invalid response.');
  const result = body as Record<string, unknown>;
  if (!result.answers || typeof result.answers !== 'object') throw new Error('Jev returned no answers.');
  const answers = result.answers as Record<string, unknown>;
  const releaseClarity = scoreAnswer(answers.release_clarity);
  const valueEvidence = scoreAnswer(answers.value_evidence);
  const usage = result.usage && typeof result.usage === 'object' ? result.usage as Record<string, unknown> : {};
  const token = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
  return {
    projectId, goal, reviewedAt: new Date().toISOString(), model: typeof result.model === 'string' ? result.model : 'jev-latest',
    releaseClarity, valueEvidence,
    worthExploring: Math.round((0.55 * releaseClarity.score / 3 + 0.45 * valueEvidence.score / 3) * 100),
    inputTokens: token(usage.input_tokens), outputTokens: token(usage.output_tokens),
    documentNames: preview.documents.map((document) => document.name),
  };
}

export async function runJevReview(
  project: ProjectSummary, goal: string, preview: ReviewPreview, apiKey: string,
  fetchImpl: typeof fetch = fetch,
): Promise<JevReview> {
  if (!apiKey.trim()) throw new Error('TYPESAFE_API_KEY is not configured on the local server.');
  if (!goal.trim() || goal.length > 400) throw new Error('Enter a goal of 1–400 characters.');
  if (!preview.documents.length) throw new Error('No readable milestone, project state, or README document is available for Jev review.');
  const state = {
    goal: goal.trim(),
    project: { name: project.name, last_agent_activity: project.lastAgentAt, last_commit: project.lastCommitAt,
      sessions: project.sessionCount, current_source_lines: project.code.lines, code_scan_status: project.code.status },
    documents: preview.documents.map(({ name, excerpt }) => ({ name, excerpt })),
  };
  const payload = {
    model: 'jev-latest', state,
    questions: {
      release_clarity: { type: 'score', instructions: 'Based only on `documents`, how clearly is there a bounded next release that can be demonstrated? Ignore past effort and cost.', criteria: [
        'No concrete next release or working path is described.',
        'A direction exists, but the next deliverable or verification is vague.',
        'A specific next deliverable and some verification steps are described.',
        'A small, specific next release and exact demonstration or verification steps are described.',
      ] },
      value_evidence: { type: 'score', instructions: 'Based only on `documents` and `goal`, how much evidence is there that the next release serves this stated goal? Ignore past effort and cost. Do not infer market demand.', criteria: [
        'No documented connection to the stated goal.',
        'The project loosely relates to the goal, with no concrete use case.',
        'A concrete use case relates to the goal, but benefit is not yet demonstrated.',
        'The documents show a concrete use case and a way to demonstrate benefit for the goal.',
      ] },
    },
  };
  let response: Response;
  try {
    response = await fetchImpl(ENDPOINT, { method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload), signal: AbortSignal.timeout(45_000), redirect: 'error' });
  } catch {
    throw new Error('Jev request failed or timed out. No automatic retry was made.');
  }
  if (!response.ok) throw new Error(`Jev returned HTTP ${response.status}. Check the local key, credits, or service status.`);
  let body: unknown;
  try { body = await response.json(); } catch { throw new Error('Jev returned unreadable JSON.'); }
  return parseJevReview(project.id, goal.trim(), preview, body);
}
