import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { JevSettings } from '../src/jev-settings-types.ts';

const STORAGE_ERROR = 'The saved Jev key could not be opened by this Windows account. Replace or remove the saved key.';

/** Use the Windows account key. Secret material is stdin, never part of a command line. */
export function protectWithWindows(input: string, mode: 'protect' | 'unprotect'): Promise<string> {
  if (process.platform !== 'win32') return Promise.reject(new Error('Encrypted key storage is available on Windows only.'));
  const operation = mode === 'protect' ? 'Protect' : 'Unprotect';
  const script = `$ErrorActionPreference = 'Stop'; Add-Type -AssemblyName System.Security;
try {
  $bytes = [Convert]::FromBase64String([Console]::In.ReadToEnd());
  $result = [Security.Cryptography.ProtectedData]::${operation}($bytes, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser);
  [Console]::Out.Write([Convert]::ToBase64String($result));
} catch { exit 1 }`;
  return new Promise((resolve, reject) => {
    const child = spawn(join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let output = '';
    let settled = false;
    const finish = (error?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(new Error(error));
      else resolve(mode === 'protect' ? output.trim() : Buffer.from(output.trim(), 'base64').toString('utf8'));
    };
    const timer = setTimeout(() => { child.kill(); finish('Windows key protection timed out.'); }, 10_000);
    child.on('error', () => finish('Windows key protection could not start.'));
    child.stdin.on('error', () => finish('Windows key protection failed.'));
    child.stderr.resume(); // Never forward OS error output that might contain sensitive input.
    child.stdout.on('data', (chunk: Buffer) => {
      output += chunk.toString('utf8');
      if (output.length > 16_384) { child.kill(); finish('Windows key protection returned an invalid result.'); }
    });
    child.on('close', (code) => finish(code === 0 && /^[A-Za-z0-9+/]+={0,2}$/.test(output.trim()) ? undefined : 'Windows key protection failed.'));
    child.stdin.end(mode === 'protect' ? Buffer.from(input, 'utf8').toString('base64') : input);
  });
}

export function validateJevKey(value: unknown): string {
  if (typeof value !== 'string' || !/^[\x21-\x7e]{10,1024}$/.test(value.trim()))
    throw new Error('Enter a Jev API key of 10–1,024 characters without spaces or line breaks.');
  return value.trim();
}

export class JevKeyStore {
  readonly path: string;
  private changes: Promise<void> = Promise.resolve();
  constructor(private readonly root: string, private readonly options: {
    platform?: string;
    environment?: NodeJS.ProcessEnv;
    protect?: typeof protectWithWindows;
  } = {}) { this.path = join(root, '.local', 'jev-key.dpapi.json'); }

  private get canStore() { return (this.options.platform ?? process.platform) === 'win32'; }
  private get crypt() { return this.options.protect ?? protectWithWindows; }

  private async readSaved(): Promise<string | null> {
    try {
      const info = await lstat(this.path);
      if (!info.isFile() || info.size > 16_384) throw new Error(STORAGE_ERROR);
      const saved = JSON.parse(await readFile(this.path, 'utf8')) as { version?: number; protection?: string; ciphertext?: string };
      if (saved.version !== 1 || saved.protection !== 'windows-dpapi-current-user' || typeof saved.ciphertext !== 'string'
        || !/^[A-Za-z0-9+/]+={0,2}$/.test(saved.ciphertext)) throw new Error(STORAGE_ERROR);
      return validateJevKey(await this.crypt(saved.ciphertext, 'unprotect'));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw new Error(STORAGE_ERROR);
    }
  }

  private async fallback(): Promise<{ key: string; source: JevSettings['source'] }> {
    const environment = this.options.environment ?? process.env;
    if (environment.TYPESAFE_API_KEY?.trim()) return { key: environment.TYPESAFE_API_KEY.trim(), source: 'environment' };
    try {
      const config = await readFile(join(this.root, '.env.local'), 'utf8');
      const key = config.match(/^\s*TYPESAFE_API_KEY\s*=\s*(.+)\s*$/m)?.[1]?.trim().replace(/^['"]|['"]$/g, '') ?? '';
      return { key, source: key ? 'env-file' : 'none' };
    } catch { return { key: '', source: 'none' }; }
  }

  async key(): Promise<string> { return await this.readSaved() ?? (await this.fallback()).key; }

  async status(): Promise<JevSettings> {
    const base = { canStore: this.canStore, storagePath: this.path };
    try {
      const saved = await this.readSaved();
      if (saved !== null) return { ...base, configured: true, hasSavedKey: true, source: 'encrypted-file', problem: null };
      const fallback = await this.fallback();
      return { ...base, configured: Boolean(fallback.key), hasSavedKey: false, source: fallback.source, problem: null };
    } catch { return { ...base, configured: false, hasSavedKey: true, source: 'encrypted-file', problem: STORAGE_ERROR }; }
  }

  private mutate(action: () => Promise<void>): Promise<void> {
    const change = this.changes.catch(() => {}).then(action);
    this.changes = change;
    return change;
  }

  async save(value: unknown): Promise<void> {
    const key = validateJevKey(value);
    if (!this.canStore) throw new Error('Encrypted key storage is available on Windows only. Use a server environment variable on this platform.');
    return this.mutate(async () => {
      let ciphertext: string;
      try {
        ciphertext = await this.crypt(key, 'protect');
        if (await this.crypt(ciphertext, 'unprotect') !== key) throw new Error('round trip');
      } catch { throw new Error('Windows could not protect the key. The previous key was kept; nothing was saved in plain text.'); }
      await mkdir(dirname(this.path), { recursive: true });
      const temp = this.path + '.' + randomUUID() + '.tmp';
      try {
        await writeFile(temp, JSON.stringify({ version: 1, protection: 'windows-dpapi-current-user', ciphertext }), { encoding: 'utf8', mode: 0o600, flag: 'wx' });
        await rename(temp, this.path);
      } catch {
        await unlink(temp).catch(() => {});
        throw new Error('Could not save the encrypted key. Check that the app folder is writable.');
      }
    });
  }

  async remove(): Promise<void> {
    return this.mutate(async () => {
      try { await unlink(this.path); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('Could not remove the saved key.'); }
    });
  }
}

/** Test authentication only; no project evidence is sent. Never expose provider response bodies. */
export async function testJevConnection(key: string, fetchImpl: typeof fetch = fetch): Promise<void> {
  if (!key) throw new Error('Save a Jev API key first.');
  let response: Response;
  try {
    response = await fetchImpl('https://api.typesafe.ai/v1/models', {
      headers: { Authorization: 'Bearer ' + key }, redirect: 'error', signal: AbortSignal.timeout(15_000),
    });
  } catch { throw new Error('Could not reach Jev. The saved key was kept; try testing again.'); }
  await response.body?.cancel();
  if (response.status === 401 || response.status === 403) throw new Error('Jev rejected this key. Replace it with a valid API key.');
  if (!response.ok) throw new Error('Jev is temporarily unavailable (HTTP ' + response.status + '). The saved key was kept.');
}
