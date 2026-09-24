import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DashboardData } from '../src/types.ts';
import { buildReviewPackage, localEvidenceGap, needsDeepReview, reconcilePortfolioReview, runPortfolioReview, type PortfolioReview, type ReviewPackage } from './portfolio-review.ts';

const CACHE_FILE = process.env.AGENT_DASH_REVIEW_CACHE
  ?? join(dirname(fileURLToPath(import.meta.url)), '..', '.local', 'portfolio-reviews.json');
const CACHE_VERSION = 2;
const cache = new Map<string, PortfolioReview>();
let loaded = false;
let saving: Promise<void> = Promise.resolve();
let currentJob: BatchJob | null = null;

export interface BatchPreview {
  fingerprint: string;
  generatedAt: string;
  projects: ReviewPackage[];
  cached: number;
  localOnly: number;
  maxCalls: number;
  totalBytes: number;
}

export interface BatchJob {
  id: string;
  state: 'running' | 'complete';
  total: number;
  done: number;
  reused: number;
  succeeded: number;
  local: number;
  warnings: { projectId: string; error: string }[];
  failed: { projectId: string; error: string }[];
  startedAt: string;
  finishedAt: string | null;
}

async function loadCache(): Promise<void> {
  if (loaded) return;
  loaded = true;
  try {
    const body = JSON.parse(await readFile(CACHE_FILE, 'utf8')) as { version?: number; reviews?: PortfolioReview[] };
    if (body.version !== CACHE_VERSION || !Array.isArray(body.reviews)) return;
    for (const review of body.reviews) {
      if (review && typeof review.projectId === 'string' && /^[a-f0-9]{64}$/.test(review.fingerprint)
        && typeof review.forwardScore === 'number') cache.set(review.projectId, review);
    }
  } catch { /* No usable local cache yet. */ }
}

function saveCache(): Promise<void> {
  saving = saving.catch(() => {}).then(async () => {
    await mkdir(dirname(CACHE_FILE), { recursive: true });
    const temp = CACHE_FILE + '.' + randomUUID() + '.tmp';
    await writeFile(temp, JSON.stringify({ version: CACHE_VERSION, reviews: [...cache.values()] }), 'utf8');
    await rename(temp, CACHE_FILE);
  });
  return saving;
}

export async function prepareBatch(data: DashboardData): Promise<BatchPreview> {
  await loadCache();
  const projects: ReviewPackage[] = [];
  for (const project of data.projects) projects.push(await buildReviewPackage(project));
  const fingerprint = createHash('sha256').update(JSON.stringify(projects.map((item) => [item.projectId, item.fingerprint]))).digest('hex');
  const fresh = projects.filter((item) => cache.get(item.projectId)?.fingerprint !== item.fingerprint);
  return {
    fingerprint, generatedAt: data.generatedAt, projects,
    cached: projects.length - fresh.length,
    localOnly: fresh.filter((item) => !item.evidence.length).length,
    maxCalls: fresh.reduce((sum, item) => sum + (!item.evidence.length ? 0 : item.deep ? 2 : 1), 0),
    totalBytes: projects.reduce((sum, item) => sum + item.bytes.base + item.bytes.deep, 0),
  };
}

export async function validReviews(preview: BatchPreview): Promise<PortfolioReview[]> {
  await loadCache();
  return preview.projects.flatMap((pkg) => {
    const result = cache.get(pkg.projectId);
    return result?.fingerprint === pkg.fingerprint ? [reconcilePortfolioReview(result, pkg)] : [];
  });
}

export function batchStatus(): BatchJob | null { return currentJob; }
export function batchRunning(): boolean { return currentJob?.state === 'running'; }

export async function startBatch(preview: BatchPreview, key: string,
  options: { projectIds?: string[]; force?: boolean; deep?: boolean } = {},
  runner: typeof runPortfolioReview = runPortfolioReview): Promise<BatchJob> {
  if (batchRunning()) throw new Error('A Jev batch is already running.');
  const wanted = options.projectIds ? new Set(options.projectIds) : null;
  const work = wanted ? preview.projects.filter((item) => wanted.has(item.projectId)) : preview.projects;
  if (wanted && work.length !== wanted.size) throw new Error('A selected project is no longer indexed.');
  if (!key.trim() && work.some((pkg) => pkg.evidence.length && (options.force || options.deep || cache.get(pkg.projectId)?.fingerprint !== pkg.fingerprint)))
    throw new Error('TYPESAFE_API_KEY is not configured on the local server.');
  const job: BatchJob = {
    id: randomUUID(), state: 'running', total: work.length, done: 0, reused: 0, succeeded: 0, local: 0, failed: [], warnings: [],
    startedAt: new Date().toISOString(), finishedAt: null,
  };
  currentJob = job;
  let next = 0;
  const worker = async () => {
    while (next < work.length) {
      const pkg = work[next++];
      try {
        const previous = cache.get(pkg.projectId);
        if (!options.force && !options.deep && previous?.fingerprint === pkg.fingerprint) {
          job.reused += 1;
        } else {
          let review = pkg.evidence.length ? await runner(pkg, key, options.deep && pkg.deep ? 'deep' : 'base') : localEvidenceGap(pkg);
          // Preserve the usable first assessment even if optional expansion fails.
          cache.set(pkg.projectId, review);
          await saveCache();
          if (!options.deep && needsDeepReview(review, pkg)) {
            try {
              review = await runner(pkg, key, 'deep');
              cache.set(pkg.projectId, review);
              await saveCache();
            } catch {
              job.warnings.push({ projectId: pkg.projectId, error: 'Extra evidence could not be assessed. The first result is saved; Deep review can retry it.' });
            }
          }
          if (review.engine === 'local') job.local += 1;
          else job.succeeded += 1;
        }
      } catch (error) {
        job.failed.push({ projectId: pkg.projectId, error: error instanceof Error ? error.message : 'Jev review failed.' });
      }
      job.done += 1;
    }
  };
  void Promise.all(Array.from({ length: Math.min(2, work.length) }, () => worker())).finally(() => {
    job.state = 'complete';
    job.finishedAt = new Date().toISOString();
  });
  if (work.length === 0) { job.state = 'complete'; job.finishedAt = new Date().toISOString(); }
  return job;
}
