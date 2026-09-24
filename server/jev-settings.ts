import type { IncomingMessage, ServerResponse } from 'node:http';
import { JevKeyStore, testJevConnection } from './jev-key.ts';

export async function handleJevSettings(request: IncomingMessage, response: ServerResponse, path: string,
  store: JevKeyStore, port: number, busy: () => boolean, fetchImpl: typeof fetch = fetch): Promise<boolean> {
  if (path !== '/api/jev-key' && path !== '/api/jev-key/test') return false;
  const send = (status: number, body: unknown) => {
    response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    response.end(JSON.stringify(body));
  };
  const origins = [`http://127.0.0.1:${port}`, 'http://127.0.0.1:4380'];
  const host = request.headers.host;
  if (!origins.some((origin) => new URL(origin).host === host)
    || request.headers['sec-fetch-site'] === 'cross-site'
    || (request.headers.origin && !origins.includes(request.headers.origin))) {
    send(403, { error: 'Same-origin key settings only.' }); return true;
  }
  if (request.method === 'GET' && path === '/api/jev-key') { send(200, await store.status()); return true; }
  if (!['POST', 'DELETE'].includes(request.method ?? '') || (path.endsWith('/test') && request.method !== 'POST')) {
    send(405, { error: 'Method not allowed.' }); return true;
  }
  // Browser mutations require both a same-origin request and an application-specific header.
  if (!request.headers.origin || request.headers['x-sloplens-settings'] !== '1') {
    send(403, { error: 'Open Jev settings in this app to change or test the key.' }); return true;
  }
  if (busy()) { send(409, { error: 'Wait for the running review to finish before changing or testing its key.' }); return true; }
  if (path.endsWith('/test')) {
    try { await testJevConnection(await store.key(), fetchImpl); send(200, { ok: true, message: 'Connected to Jev. No project data was sent.' }); }
    catch (error) { send(400, { error: error instanceof Error ? error.message : 'Could not test the Jev key.' }); }
    return true;
  }
  try {
    if (request.method === 'DELETE') await store.remove();
    else {
      if (request.headers['content-type']?.split(';')[0].trim() !== 'application/json') {
        send(415, { error: 'Use JSON to save the key.' }); return true;
      }
      let content = '';
      for await (const chunk of request) {
        content += String(chunk);
        if (content.length > 2048) { send(413, { error: 'Key request is too large.' }); return true; }
      }
      let body: unknown;
      try { body = JSON.parse(content); } catch { send(400, { error: 'Key request must be JSON.' }); return true; }
      await store.save(body && typeof body === 'object' ? (body as { key?: unknown }).key : undefined);
    }
    send(200, await store.status());
  } catch (error) { send(400, { error: error instanceof Error ? error.message : 'Could not update the Jev key.' }); }
  return true;
}
