import { type FormEvent, useEffect, useState } from 'react';
import type { IgnoredRow, UpdateRow } from '../server/updates.ts';
import { api, type OnAuthError } from './api.ts';
import { TargetCell } from './Updates.tsx';

interface PackagesResponse {
  manual: UpdateRow[];
  ignored: IgnoredRow[];
}

const EMPTY = { label: '', name: '', currentVersion: '' };

export function Infra({ onAuthError }: { onAuthError: OnAuthError }) {
  const [data, setData] = useState<PackagesResponse | null>(null);
  const [form, setForm] = useState(EMPTY);
  const [error, setError] = useState('');

  const load = () => api<PackagesResponse>('/packages').then(setData, onAuthError);
  useEffect(() => {
    load();
  }, []);
  const fail = (e: unknown) => {
    onAuthError(e);
    setError((e as Error).message);
  };

  const add = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      await api('/packages', { method: 'POST', body: form });
      setForm(EMPTY);
      load();
    } catch (err) {
      fail(err);
    }
  };
  const field = (key: keyof typeof EMPTY, label: string, placeholder: string) => (
    <label className="flex flex-col gap-1">
      {label}
      <input required value={form[key]} placeholder={placeholder} onChange={(e) => setForm({ ...form, [key]: e.target.value })}
        className="rounded border border-zinc-300 bg-white px-2 py-1" />
    </label>
  );

  return (
    <section className="space-y-6 text-sm">
      <form onSubmit={add} className="flex flex-wrap items-end gap-3">
        {field('label', 'Name', 'Longhorn')}
        {field('name', 'GitHub releases repo', 'longhorn/longhorn')}
        {field('currentVersion', 'Version in use', 'v1.7.2')}
        <button className="rounded bg-zinc-900 px-3 py-1.5 text-white">Add</button>
      </form>
      <p className="text-xs text-zinc-500">New entries get their releases on the next check.</p>
      {error && <p role="alert" className="text-red-700">{error}</p>}

      <div className="overflow-x-auto">
        <table className="w-full text-left">
          <thead className="text-xs uppercase text-zinc-500">
            <tr><th className="py-2 pr-3">Name</th><th className="pr-3">Releases repo</th><th className="pr-3">In use</th><th className="pr-3">Minor / patch</th><th className="pr-3">Major</th><th /></tr>
          </thead>
          <tbody>
            {data?.manual.map((row) => (
              <InfraRow key={`${row.id}:${row.uses[0]?.version}`} row={row} onSaved={load} onError={fail} />
            ))}
          </tbody>
        </table>
      </div>

      <div>
        <h2 className="mb-2 font-semibold">Ignored</h2>
        {data?.ignored.length ? (
          <ul className="space-y-1">
            {data.ignored.map((p) => (
              <li key={p.id} className="flex items-center gap-3">
                <span>{p.ecosystem} · {p.label}</span>
                <button type="button" className="text-blue-700 underline"
                  onClick={() => api(`/packages/${p.id}`, { method: 'PATCH', body: { ignored: false } }).then(load, fail)}>
                  Watch again
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-zinc-500">Nothing ignored.</p>
        )}
      </div>
    </section>
  );
}

function InfraRow({ row, onSaved, onError }: { row: UpdateRow; onSaved: () => void; onError: (e: unknown) => void }) {
  const [version, setVersion] = useState(row.uses[0]?.version ?? '');
  const save = () => api(`/packages/${row.id}`, { method: 'PATCH', body: { currentVersion: version } }).then(onSaved, onError);
  const remove = () => api(`/packages/${row.id}`, { method: 'DELETE' }).then(onSaved, onError);
  return (
    <tr className="border-t border-zinc-200">
      <td className="py-2 pr-3 font-medium">{row.label}</td>
      <td className="pr-3">{row.name}</td>
      <td className="pr-3">
        <input aria-label={`Version in use for ${row.label}`} value={version} onChange={(e) => setVersion(e.target.value)}
          className="w-28 rounded border border-zinc-300 bg-white px-2 py-1" />
        <button type="button" onClick={save} className="ml-2 text-blue-700 underline">Save</button>
      </td>
      <td className="pr-3"><TargetCell target={row.minor} /></td>
      <td className="pr-3"><TargetCell target={row.major} /></td>
      <td><button type="button" onClick={remove} className="text-red-700 underline">Remove</button></td>
    </tr>
  );
}
