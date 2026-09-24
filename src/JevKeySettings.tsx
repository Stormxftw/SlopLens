import { useEffect, useState } from 'react';
import type { JevSettings } from './jev-settings-types.ts';

const sourceName = { 'encrypted-file': 'Encrypted key saved for this Windows account',
  environment: 'Using the server environment variable', 'env-file': 'Using .env.local (plain text)', none: 'No Jev key configured' };

export default function JevKeySettings({ busy, onConfigured }: { busy: boolean; onConfigured: (value: boolean) => void }) {
  const [settings, setSettings] = useState<JevSettings | null>(null);
  const [key, setKey] = useState('');
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  async function request<T>(path = '/api/jev-key', method = 'GET', body?: string): Promise<T> {
    const response = await fetch(path, { method, cache: 'no-store', headers: { 'Content-Type': 'application/json', 'X-SlopLens-Settings': '1' }, body });
    const result = await response.json() as T & { error?: string };
    if (!response.ok) throw new Error(result.error ?? 'Jev settings are unavailable.');
    return result;
  }
  function update(value: JevSettings) { setSettings(value); onConfigured(value.configured); }
  useEffect(() => {
    let stopped = false;
    void request<JevSettings>().then((value) => { if (!stopped) { update(value); setExpanded(!value.configured); } })
      .catch(() => { if (!stopped) setError('Could not load Jev key settings. Reload this page to try again.'); });
    return () => { stopped = true; };
  }, []);

  async function act(action: 'save' | 'remove' | 'test') {
    setPending(true); setError(null); setMessage(null); setExpanded(true);
    const entered = key;
    setKey('');
    try {
      if (action === 'save') {
        update(await request<JevSettings>('/api/jev-key', 'POST', JSON.stringify({ key: entered })));
        setMessage('Key saved with Windows encryption. Testing the connection…');
      }
      if (action === 'remove') {
        const next = await request<JevSettings>('/api/jev-key', 'DELETE');
        update(next);
        setMessage(next.configured ? 'Saved key removed. The existing server configuration is now active.' : 'Saved key removed. Jev is disconnected.');
      } else {
        const result = await request<{ message: string }>('/api/jev-key/test', 'POST');
        setMessage(action === 'save' ? 'Key saved with Windows encryption. ' + result.message : result.message);
      }
    } catch (reason) { setMessage(null); setError(reason instanceof Error ? reason.message : 'Could not update Jev settings.'); }
    finally { setPending(false); }
  }

  return <details className="jev-key-settings" open={expanded} onToggle={(event) => setExpanded(event.currentTarget.open)}>
    <summary>Jev API key <span>{settings ? sourceName[settings.source] : 'Loading settings…'}</span></summary>
    <div className="jev-key-content">
      <p>Connect your own Jev account. Saving also tests authentication with TypeSafe; no project data is sent by the connection test.</p>
      {settings?.problem && <p className="key-error" role="alert">{settings.problem}</p>}
      {settings?.canStore ? <form onSubmit={(event) => { event.preventDefault(); void act('save'); }}>
        <label htmlFor="jev-api-key">{settings.configured ? 'New or replacement API key' : 'Jev API key'}</label>
        <input id="jev-api-key" type="password" value={key} onChange={(event) => setKey(event.target.value)}
          autoComplete="off" autoCapitalize="none" spellCheck={false} maxLength={1024} minLength={10}
          placeholder="Paste your Jev API key" required disabled={pending || busy} aria-describedby="jev-key-storage" />
        <button className="review-open" disabled={pending || busy || !key.trim()} type="submit">{pending ? 'Working…' : 'Save and test key'}</button>
      </form> : settings && <p>Encrypted storage is available on Windows. On this platform, set TYPESAFE_API_KEY in the server environment.</p>}
      <div className="key-actions">
        {settings?.configured && <button className="review-open" disabled={pending || busy} onClick={() => void act('test')}>Test connection</button>}
        {settings?.hasSavedKey && <button className="review-open" disabled={pending || busy} onClick={() => void act('remove')}>Remove saved key</button>}
      </div>
      {message && <p role="status">{message}</p>}
      {error && <p className="key-error" role="alert">{error}</p>}
      <div id="jev-key-storage" className="key-storage">
        <b>Where it is stored</b>
        <code>{settings?.storagePath ?? 'This app’s .local/jev-key.dpapi.json'}</code>
        <p>Windows DPAPI encrypts saved keys for the Windows account running this app. They stay out of Git and browser storage. The saved value is never sent back to the page.</p>
        <p>Programs running as the same Windows user can decrypt it. Re-enter the key when moving to a different account or machine. Removing it here deletes the local copy; revoke it with TypeSafe to invalidate it everywhere.</p>
        <p>A saved key takes priority over TYPESAFE_API_KEY in the environment, then .env.local. Removing it restores that fallback. Existing .env.local files stay unchanged and are plain text; saving here does not encrypt or erase a copy already in that file.</p>
      </div>
    </div>
  </details>;
}
