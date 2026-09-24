import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DashboardData } from '../src/types.ts';
import { buildDashboard } from './projects.ts';
import { batchRunning, batchStatus, prepareBatch, startBatch, validReviews, type BatchPreview } from './review-batch.ts';
import { JevKeyStore } from './jev-key.ts';
import { handleJevSettings } from './jev-settings.ts';

const PORT = Number(process.env.AGENT_DASH_PORT ?? 4381);
if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) throw new Error('AGENT_DASH_PORT must be a valid TCP port.');
const HOST = '127.0.0.1';
const DIST = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'dist');
let data: DashboardData | null = null;
let state: 'loading' | 'ready' | 'error' = 'loading';
let progress = 'Starting local index…';
let lastError: string | null = null;
let running: Promise<void> | null = null;
let batchPreview: BatchPreview | null = null;
const APP_ROOT = resolve(DIST, '..');
const jevKeys = new JevKeyStore(APP_ROOT);

async function readSmallJson(request: IncomingMessage): Promise<unknown> {
  let content = '';
  for await (const chunk of request) {
    content += String(chunk);
    if (content.length > 2000) throw new Error('Request body is too large.');
  }
  try { return JSON.parse(content); } catch { throw new Error('Request body must be JSON.'); }
}

function refresh(): Promise<void> {
  if (running) return running;
  state = 'loading';
  progress = 'Preparing local scan…';
  lastError = null;
  running = buildDashboard((message) => { progress = message; })
    .then((next) => { batchPreview = null; return next; })
    .then((next) => { data = next; state = 'ready'; progress = `Indexed ${next.projects.length} projects`; })
    .catch((error: unknown) => {
      state = 'error';
      lastError = error instanceof Error ? error.message : 'Index failed';
      progress = data ? 'Showing the last successful index' : 'Could not index local history';
      console.error('Dashboard index failed:', lastError);
    })
    .finally(() => { running = null; });
  return running;
}

function json(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  response.end(JSON.stringify(body));
}

function sameOrigin(request: IncomingMessage): boolean {
  const origin = request.headers.origin;
  return !origin || origin === 'http://127.0.0.1:4380' || origin === `http://${HOST}:${PORT}`;
}

async function serveStatic(pathname: string, response: ServerResponse): Promise<void> {
  const requested = pathname === '/' ? '/index.html' : pathname;
  let decoded: string;
  try { decoded = decodeURIComponent(requested); } catch { response.writeHead(400); response.end(); return; }
  const file = resolve(DIST, `.${decoded}`);
  const inside = file === DIST || file.startsWith(`${DIST}${sep}`);
  if (!inside) { response.writeHead(403); response.end(); return; }
  try {
    const info = await stat(file);
    if (!info.isFile()) throw new Error('not file');
    const types: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };
    response.writeHead(200, { 'Content-Type': `${types[extname(file)] ?? 'application/octet-stream'}; charset=utf-8`, 'X-Content-Type-Options': 'nosniff' });
    response.end(await readFile(file));
  } catch {
    if (pathname !== '/' && !pathname.includes('.')) return serveStatic('/', response);
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('Build the UI with npm run build, or use npm run dev.');
  }
}

const server = createServer((request, response) => {
  void (async () => {
    if (request.headers.host !== `${HOST}:${PORT}` && request.headers.host !== `${HOST}:4380`) {
      json(response, 403, { error: 'Local host only' }); return;
    }
    const url = new URL(request.url ?? '/', `http://${HOST}:${PORT}`);
    if (await handleJevSettings(request, response, url.pathname, jevKeys, PORT, batchRunning)) return;
    if (url.pathname === '/api/status' && request.method === 'GET') {
      json(response, 200, { state, progress, lastError, generatedAt: data?.generatedAt ?? null }); return;
    }
    if (url.pathname === '/api/refresh' && request.method === 'POST') {
      if (!sameOrigin(request)) { json(response, 403, { error: 'Same-origin refresh only' }); return; }
      if (batchRunning()) { json(response, 409, { error: 'Wait for the Jev batch to finish before refreshing.' }); return; }
      void refresh();
      json(response, 202, { state: 'loading', progress }); return;
    }
    if (url.pathname === '/api/projects' && request.method === 'GET') {
      if (!data) { json(response, 202, { state, progress, lastError }); return; }
      json(response, 200, data); return;
    }
    if (url.pathname === '/api/review-batch/preview' && request.method === 'GET') {
      if (!data) { json(response, 202, { state, progress, lastError }); return; }
      batchPreview = await prepareBatch(data);
      json(response, 200, { preview: batchPreview, configured: (await jevKeys.status()).configured,
        reviews: await validReviews(batchPreview) }); return;
    }
    if (url.pathname === '/api/review-batch/status' && request.method === 'GET') {
      if (!data) { json(response, 202, { state, progress, lastError }); return; }
      const preview = batchPreview ?? await prepareBatch(data);
      batchPreview = preview;
      json(response, 200, { job: batchStatus(), reviews: await validReviews(preview) }); return;
    }
    if (url.pathname === '/api/review-batch' && request.method === 'POST') {
      if (!sameOrigin(request)) { json(response, 403, { error: 'Same-origin Jev review only' }); return; }
      if (!data) { json(response, 202, { state, progress, lastError }); return; }
      if (batchRunning()) { json(response, 409, { error: 'A Jev batch is already running.' }); return; }
      let body: unknown;
      try { body = await readSmallJson(request); } catch (error) { json(response, 400, { error: (error as Error).message }); return; }
      const options = body && typeof body === 'object' ? body as Record<string, unknown> : {};
      if (typeof options.fingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(options.fingerprint)
          || (options.projectIds !== undefined && (!Array.isArray(options.projectIds)
            || options.projectIds.some((id) => typeof id !== 'string')))) {
        json(response, 400, { error: 'Invalid batch request.' }); return;
      }
      const latest = await prepareBatch(data);
      if (latest.fingerprint !== options.fingerprint) {
        json(response, 409, { error: 'Project evidence changed. Reload the batch preview before sending.' }); return;
      }
      batchPreview = latest;
      try {
        const job = await startBatch(latest, await jevKeys.key(), {
          projectIds: options.projectIds as string[] | undefined,
          force: options.force === true, deep: options.deep === true,
        });
        json(response, 202, { job });
      } catch (error) { json(response, 400, { error: error instanceof Error ? error.message : 'Could not start the Jev batch.' }); }
      return;
    }
    if (url.pathname.startsWith('/api/projects/') && request.method === 'GET') {
      if (!data) { json(response, 202, { state, progress, lastError }); return; }
      const id = url.pathname.slice('/api/projects/'.length);
      const project = data.projects.find((item) => item.id === id);
      json(response, project ? 200 : 404, project ?? { error: 'Project not found' }); return;
    }
    if (url.pathname.startsWith('/api/')) { json(response, 404, { error: 'Not found' }); return; }
    await serveStatic(url.pathname, response);
  })().catch((error: unknown) => {
    console.error('Request failed:', error);
    if (!response.headersSent) json(response, 500, { error: 'Request failed' });
    else response.end();
  });
});

server.listen(PORT, HOST, () => {
  console.log(`Agent Project Dashboard API: http://${HOST}:${PORT}`);
  console.log('Local indexing starts in the background. Session content is never served.');
  void refresh();
});
