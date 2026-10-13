import { useEffect, useState } from 'react';
import type { RepoRow, RunRow } from '../server/db.ts';
import { ago, api, type OnAuthError } from './api.ts';
import type { RunsResponse } from './App.tsx';

const STATUS_STYLE: Record<RepoRow['status'], string> = {
  ok: 'text-emerald-700',
  'no-manifest': 'text-zinc-500',
  error: 'text-red-700',
};

const duration = (r: RunRow) =>
  r.finishedAt ? `${Math.max(1, Math.round((Date.parse(r.finishedAt) - Date.parse(r.startedAt)) / 1000))}s` : 'running';

export function Checks({ onAuthError }: { onAuthError: OnAuthError }) {
  const [repos, setRepos] = useState<RepoRow[]>([]);
  const [runs, setRuns] = useState<RunRow[]>([]);
  useEffect(() => {
    api<RepoRow[]>('/repos').then(setRepos, onAuthError);
    api<RunsResponse>('/runs').then((r) => setRuns(r.runs), onAuthError);
  }, []);

  return (
    <section className="space-y-8 text-sm">
      <div className="overflow-x-auto">
        <h2 className="mb-2 font-semibold">Repositories</h2>
        <table className="w-full text-left">
          <thead className="text-xs uppercase text-zinc-500">
            <tr><th className="py-2 pr-3">Repository</th><th className="pr-3">Status</th><th className="pr-3">Last scan</th><th>Error</th></tr>
          </thead>
          <tbody>
            {repos.map((r) => (
              <tr key={r.name} className="border-t border-zinc-200 align-top">
                <td className="py-2 pr-3">{r.name}</td>
                <td className={`py-2 pr-3 ${STATUS_STYLE[r.status]}`}>{r.status}</td>
                <td className="py-2 pr-3">{r.lastScanAt ? ago(r.lastScanAt) : '—'}</td>
                <td className="whitespace-pre-wrap py-2 text-xs text-zinc-600">{r.error ?? ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="overflow-x-auto">
        <h2 className="mb-2 font-semibold">Recent checks</h2>
        <table className="w-full text-left">
          <thead className="text-xs uppercase text-zinc-500">
            <tr><th className="py-2 pr-3">Started</th><th className="pr-3">Duration</th><th className="pr-3">Packages</th><th>Errors</th></tr>
          </thead>
          <tbody>
            {runs.map((r) => (
              <tr key={r.id} className="border-t border-zinc-200 align-top">
                <td className="py-2 pr-3">{new Date(r.startedAt).toLocaleString()}</td>
                <td className="py-2 pr-3">{duration(r)}</td>
                <td className="py-2 pr-3">{r.packagesChecked}</td>
                <td className="py-2">
                  {r.errors.length === 0 ? '0' : (
                    <details>
                      <summary className="cursor-pointer">{r.errors.length}</summary>
                      <ul className="mt-1 space-y-1 text-xs text-zinc-600">{r.errors.map((e, i) => <li key={i}>{e}</li>)}</ul>
                    </details>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
