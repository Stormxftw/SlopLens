import { afterEach, describe, expect, it, vi } from 'vitest';
import { createServer, type Server } from 'node:http';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JevKeyStore, protectWithWindows, testJevConnection } from '../server/jev-key.ts';
import { handleJevSettings } from '../server/jev-settings.ts';

const folders: string[] = [];
const servers: Server[] = [];
const fixtureKey = 'synthetic-test-credential-one';
const replacementKey = 'synthetic-test-credential-two';
afterEach(async () => {
  for (const server of servers.splice(0)) { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); }
  for (const path of folders.splice(0)) await rm(path, { recursive: true, force: true });
});
async function root() { const path = await mkdtemp(join(tmpdir(), 'sloplens-key-test-')); folders.push(path); return path; }
function fakeCrypt() {
  const values = new Map<string, string>();
  return vi.fn(async (value: string, mode: 'protect' | 'unprotect') => {
    if (mode === 'unprotect') {
      if (!values.has(value)) throw new Error('Unrecognized ciphertext');
      return values.get(value)!;
    }
    const opaque = Buffer.from('opaque-ciphertext-' + values.size).toString('base64');
    values.set(opaque, value); return opaque;
  });
}

describe('Jev key storage', () => {
  it('saves only ciphertext, replaces atomically, survives a new store, and restores explicit fallback after removal', async () => {
    const path = await root();
    await writeFile(join(path, '.env.local'), 'TYPESAFE_API_KEY=legacy-synthetic-credential\nOTHER_SETTING=kept\n');
    const crypt = fakeCrypt();
    const options = { platform: 'win32', environment: {}, protect: crypt };
    const store = new JevKeyStore(path, options);
    expect(await store.status()).toMatchObject({ source: 'env-file', configured: true, hasSavedKey: false });
    await store.save(fixtureKey);
    const saved = await readFile(store.path, 'utf8');
    expect(saved).not.toContain(fixtureKey);
    expect(JSON.parse(saved).protection).toBe('windows-dpapi-current-user');
    expect(JSON.stringify(await store.status())).not.toContain(fixtureKey);
    await store.save(replacementKey);
    expect(await new JevKeyStore(path, options).key()).toBe(replacementKey);
    await store.remove();
    expect(await store.key()).toBe('legacy-synthetic-credential');
    expect(await readFile(join(path, '.env.local'), 'utf8')).toContain('OTHER_SETTING=kept');
    const env = new JevKeyStore(path, { ...options, environment: { TYPESAFE_API_KEY: 'environment-synthetic-credential' } });
    expect(await env.status()).toMatchObject({ source: 'environment', configured: true });
  });

  it('fails closed for corrupt storage and protects the previous key when encryption or validation fails', async () => {
    const path = await root();
    const protect = fakeCrypt();
    const store = new JevKeyStore(path, { platform: 'win32', environment: {}, protect });
    await store.save(fixtureKey);
    const saved = await readFile(store.path, 'utf8');
    await expect(store.save('bad\r\nAuthorization: injected')).rejects.toThrow('without spaces or line breaks');
    protect.mockRejectedValueOnce(new Error('sensitive upstream error ' + replacementKey));
    await expect(store.save(replacementKey)).rejects.toThrow('previous key was kept');
    expect(await readFile(store.path, 'utf8')).toBe(saved);
    await writeFile(store.path, '{broken');
    expect(await store.status()).toMatchObject({ configured: false, hasSavedKey: true, source: 'encrypted-file' });
    await expect(store.key()).rejects.toThrow('could not be opened');
    await store.remove();
    expect(await store.status()).toMatchObject({ configured: false, hasSavedKey: false });
    const unsupported = new JevKeyStore(path, { platform: 'linux', environment: {} });
    await expect(unsupported.save(fixtureKey)).rejects.toThrow('Windows only');
  });

  it.runIf(process.platform === 'win32')('round trips through real current-user Windows DPAPI without writing plaintext', async () => {
    const path = await root();
    const store = new JevKeyStore(path, { environment: {} });
    await store.save(fixtureKey);
    expect(await new JevKeyStore(path, { environment: {} }).key()).toBe(fixtureKey);
    const saved = JSON.parse(await readFile(store.path, 'utf8'));
    expect(saved.ciphertext).not.toContain(fixtureKey);
    expect(Buffer.from(saved.ciphertext, 'base64').toString('utf8')).not.toContain(fixtureKey);
    await expect(protectWithWindows(Buffer.from('corrupt').toString('base64'), 'unprotect')).rejects.toThrow();
  }, 30_000);

  it('tests only the model endpoint, forbids redirects, and redacts provider errors', async () => {
    const fetchMock = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => new Response('private server error ' + fixtureKey, { status: 401 }));
    await expect(testJevConnection(fixtureKey, fetchMock as typeof fetch)).rejects.toThrow('Jev rejected this key');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.typesafe.ai/v1/models');
    expect(init).toMatchObject({ redirect: 'error', headers: { Authorization: 'Bearer ' + fixtureKey } });
    expect(init?.body).toBeUndefined();
  });

  it('guards the HTTP settings lifecycle against cross-origin, missing headers, busy review, invalid and oversized bodies', async () => {
    const path = await root();
    const store = new JevKeyStore(path, { platform: 'win32', environment: {}, protect: fakeCrypt() });
    let busy = false;
    const fetchMock = vi.fn(async () => new Response(null, { status: 200 }));
    const server = createServer((request, response) => {
      void handleJevSettings(request, response, request.url ?? '', store, port, () => busy, fetchMock)
        .catch(() => { response.writeHead(500); response.end('Unexpected failure'); });
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as { port: number }).port;
    const base = 'http://127.0.0.1:' + port;
    const headers = { Origin: base, 'Content-Type': 'application/json', 'X-SlopLens-Settings': '1' };
    const post = (body: string, extra: Record<string, string> = {}) => fetch(base + '/api/jev-key', { method: 'POST', headers: { ...headers, ...extra }, body });
    expect((await post(JSON.stringify({ key: fixtureKey }), { Origin: 'https://example.invalid' })).status).toBe(403);
    expect((await post(JSON.stringify({ key: fixtureKey }), { 'X-SlopLens-Settings': '' })).status).toBe(403);
    expect((await post(JSON.stringify({ key: fixtureKey }), { Origin: '' })).status).toBe(403);
    busy = true;
    expect((await post(JSON.stringify({ key: fixtureKey }))).status).toBe(409);
    busy = false;
    expect((await post('invalid json')).status).toBe(400);
    expect((await post(JSON.stringify({ key: 'short' }))).status).toBe(400);
    expect((await post('x'.repeat(3000))).status).toBe(413);
    const saved = await post(JSON.stringify({ key: fixtureKey }));
    expect(saved.status).toBe(200);
    expect(await saved.text()).not.toContain(fixtureKey);
    const status = await fetch(base + '/api/jev-key');
    expect(status.headers.get('cache-control')).toBe('no-store');
    expect(await status.json()).toMatchObject({ configured: true, source: 'encrypted-file' });
    const tested = await fetch(base + '/api/jev-key/test', { method: 'POST', headers });
    expect(tested.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const deleted = await fetch(base + '/api/jev-key', { method: 'DELETE', headers });
    expect(await deleted.json()).toMatchObject({ configured: false, hasSavedKey: false });
    expect(await store.key()).toBe('');
  });
});
