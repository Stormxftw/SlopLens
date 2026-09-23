import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DashboardData } from '../src/types.ts';
import { buildDashboard } from './projects.ts';
import { previewReview, runJevReview, type JevReview } from './review.ts';

const PORT = 4381;
const HOST = '127.0.0.1';
const DIST = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'dist');
let data: DashboardData | null = null;
let state: 'loading' | 'ready' | 'error' = 'loading';
let progress = 'Starting local index…';
let lastError: string | null = null;
let running: Promise<void> | null = null;
const reviews = new Map<string, JevReview>();
const reviewing = new Set<string>();
const APP_ROOT = resolve(DIST, '..');

async function typesafeKey(): Promise<string> {
  if (process.env.TYPESAFE_API_KEY?.trim()) return process.env.TYPESAFE_API_KEY.trim();
  try {
    const config = await readFile(join(APP_ROOT, '.env.local'), 'utf8');
    const match = config.match(/^\s*TYPESAFE_API_KEY\s*=\s*(.+)\s*$/m);
    return match?.[1]?.trim().replace(/^['"]|['"]$/g, '') ?? '';
  } catch { return ''; }
}

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
    .then((next) => { data = next; reviews.clear(); state = 'ready'; progress = `Indexed ${next.projects.length} projects`; })
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
    if (url.pathname === '/api/status' && request.method === 'GET') {
      json(response, 200, { state, progress, lastError, generatedAt: data?.generatedAt ?? null }); return;
    }
    if (url.pathname === '/api/refresh' && request.method === 'POST') {
      if (!sameOrigin(request)) { json(response, 403, { error: 'Same-origin refresh only' }); return; }
      void refresh();
      json(response, 202, { state: 'loading', progress }); return;
    }
    if (url.pathname === '/api/projects' && request.method === 'GET') {
      if (!data) { json(response, 202, { state, progress, lastError }); return; }
      json(response, 200, data); return;
    }
    if (url.pathname === '/api/reviews' && request.method === 'GET') {
      json(response, 200, { reviews: [...reviews.values()] }); return;
    }
    if (url.pathname.startsWith('/api/review/')) {
      if (!data) { json(response, 202, { state, progress, lastError }); return; }
      const id = url.pathname.slice('/api/review/'.length);
      const project = data.projects.find((item) => item.id === id);
      if (!project) { json(response, 404, { error: 'Project not found' }); return; }
      if (request.method === 'GET') {
        json(response, 200, { preview: await previewReview(project), review: reviews.get(id) ?? null, configured: Boolean(await typesafeKey()) }); return;
      }
      if (request.method === 'POST') {
        if (!sameOrigin(request)) { json(response, 403, { error: 'Same-origin Jev review only' }); return; }
        if (reviewing.has(id)) { json(response, 409, { error: 'A Jev review is already running for this project.' }); return; }
        let body: unknown;
        try { body = await readSmallJson(request); } catch (error) { json(response, 400, { error: (error as Error).message }); return; }
        const goal = typeof body === 'object' && body !== null ? (body as { goal?: unknown }).goal : null;
        if (typeof goal !== 'string' || !goal.trim() || goal.length > 400) { json(response, 400, { error: 'Enter a goal of 1–400 characters.' }); return; }
        const preview = await previewReview(project);
        if (!preview.documents.length) { json(response, 422, { error: 'No readable project overview document is available.' }); return; }
        reviewing.add(id);
        try {
          const review = await runJevReview(project, goal, preview, await typesafeKey());
          reviews.set(id, review);
          json(response, 200, { review });
        } catch (error) { json(response, 502, { error: error instanceof Error ? error.message : 'Jev review failed.' }); }
        finally { reviewing.delete(id); }
        return;
      }
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
