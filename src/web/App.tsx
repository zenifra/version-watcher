import { useEffect, useRef, useState } from 'react';
import type { RunRow } from '../server/db.ts';
import { ago, api, type OnAuthError, Unauthorized } from './api.ts';
import { Checks } from './Checks.tsx';
import { Infra } from './Infra.tsx';
import { Login } from './Login.tsx';
import { Updates } from './Updates.tsx';

export interface RunsResponse {
  running: boolean;
  runs: RunRow[];
}

const PAGES = [['updates', 'Updates'], ['infra', 'Infra'], ['checks', 'Checks']] as const;
const currentPage = () => location.hash.replace(/^#\/?/, '') || 'updates';

export function App() {
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [page, setPage] = useState(currentPage);
  const [generation, setGeneration] = useState(0);

  useEffect(() => {
    const onHash = () => setPage(currentPage());
    addEventListener('hashchange', onHash);
    return () => removeEventListener('hashchange', onHash);
  }, []);
  useEffect(() => {
    api('/session').then(() => setAuthed(true), () => setAuthed(false));
  }, []);

  if (authed === null) return null;
  if (!authed) return <Login onDone={() => setAuthed(true)} />;

  const onAuthError: OnAuthError = (e) => {
    if (e instanceof Unauthorized) setAuthed(false);
  };

  return (
    <div className="mx-auto max-w-6xl px-4 py-4">
      <header className="mb-4 flex flex-wrap items-center gap-x-6 gap-y-2">
        <h1 className="text-lg font-semibold">Version Watcher</h1>
        <nav className="flex gap-4 text-sm">
          {PAGES.map(([key, label]) => (
            <a key={key} href={`#/${key}`} aria-current={page === key ? 'page' : undefined}
              className={page === key ? 'font-semibold underline' : 'text-zinc-600 hover:text-zinc-900'}>
              {label}
            </a>
          ))}
        </nav>
        <RunBar onAuthError={onAuthError} onFinished={() => setGeneration((g) => g + 1)} />
        <button type="button" onClick={() => api('/logout', { method: 'POST', body: {} }).finally(() => setAuthed(false))}
          className="text-sm text-zinc-600 underline hover:text-zinc-900">
          Sign out
        </button>
      </header>
      {page === 'infra' ? (
        <Infra key={generation} onAuthError={onAuthError} />
      ) : page === 'checks' ? (
        <Checks key={generation} onAuthError={onAuthError} />
      ) : (
        <Updates key={generation} onAuthError={onAuthError} />
      )}
    </div>
  );
}

function RunBar({ onAuthError, onFinished }: { onAuthError: OnAuthError; onFinished: () => void }) {
  const [state, setState] = useState<RunsResponse | null>(null);
  const wasRunning = useRef(false);
  const refresh = () => api<RunsResponse>('/runs').then(setState, onAuthError);

  useEffect(() => {
    refresh();
  }, []);
  useEffect(() => {
    if (!state) return;
    if (wasRunning.current && !state.running) onFinished();
    wasRunning.current = state.running;
    if (!state.running) return;
    const timer = setTimeout(refresh, 3000);
    return () => clearTimeout(timer);
  }, [state]);

  const last = state?.runs.find((r) => r.finishedAt);
  const start = () => api('/runs', { method: 'POST', body: {} }).then(refresh, (e) => { onAuthError(e); refresh(); });

  return (
    <div className="ml-auto flex items-center gap-3 text-sm text-zinc-600">
      <span aria-live="polite">
        {state?.running
          ? 'Checking…'
          : last
            ? `Last check ${ago(last.finishedAt!)} · ${last.errors.length} error${last.errors.length === 1 ? '' : 's'}`
            : 'Never checked'}
      </span>
      <button type="button" disabled={!state || state.running} onClick={start}
        className="rounded bg-zinc-900 px-3 py-1.5 text-white disabled:opacity-50">
        Check now
      </button>
    </div>
  );
}
