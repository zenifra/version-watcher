import { Fragment, useEffect, useState } from 'react';
import type { RepoRow } from '../server/db.ts';
import type { Bump, Release } from '../server/types.ts';
import type { PackageDetail, Target, UpdateRow, Upgrade, Use } from '../server/updates.ts';
import { api, isHttpUrl, type OnAuthError } from './api.ts';

const ECOSYSTEMS = ['npm', 'pypi', 'actions', 'docker', 'infra'];
const BUMP_STYLE: Record<Bump, string> = {
  major: 'bg-red-100 text-red-800',
  minor: 'bg-amber-100 text-amber-800',
  patch: 'bg-emerald-100 text-emerald-800',
};

export function BumpBadge({ bump }: { bump: Bump | null }) {
  if (!bump) return <span className="text-xs text-zinc-500">up to date</span>;
  return <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${BUMP_STYLE[bump]}`}>{bump}</span>;
}

export function TargetCell({ target }: { target: Target | null }) {
  if (!target) return <span className="text-zinc-400">—</span>;
  return <span className="flex items-center gap-1.5">{target.to} <BumpBadge bump={target.bump} /></span>;
}

function describe(u: Use): string {
  if (u.pin === 'sha') return `${u.version.slice(0, 7)} (SHA)`;
  if (u.pin === 'floating') return `${u.version} (floating)`;
  if (u.pin === 'unsupported') return `${u.version} (registry not supported)`;
  if (u.pin === 'digest') return `${u.version} (digest)`;
  return u.version;
}

const repoName = (repo: string) => (repo === 'manual' ? 'manual entry' : repo.split('/').pop()!);

export function inUse(uses: Use[]): string {
  const groups = new Map<string, Set<string>>();
  for (const u of uses) {
    const key = describe(u);
    const where = repoName(u.repo);
    groups.set(key, (groups.get(key) ?? new Set()).add(where));
  }
  return [...groups].map(([version, repos]) => `${version} in ${[...repos].join(', ')}`).join(' · ');
}

function Select(props: { label: string; value: string; options: string[]; onChange: (v: string) => void }) {
  return (
    <select aria-label={props.label} value={props.value} onChange={(e) => props.onChange(e.target.value)}
      className="rounded border border-zinc-300 bg-white px-2 py-1">
      <option value="">{props.label}: all</option>
      {props.options.map((o) => <option key={o} value={o}>{o}</option>)}
    </select>
  );
}

export function Updates({ onAuthError }: { onAuthError: OnAuthError }) {
  const [filter, setFilter] = useState({ ecosystem: '', bump: '', repo: '', q: '', all: false });
  const [rows, setRows] = useState<UpdateRow[] | null>(null);
  const [repos, setRepos] = useState<string[]>([]);
  const [open, setOpen] = useState<number | null>(null);

  const load = () => {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(filter)) if (v) params.set(k, v === true ? '1' : String(v));
    api<UpdateRow[]>(`/updates?${params}`).then(setRows, onAuthError);
  };
  useEffect(load, [filter]);
  useEffect(() => {
    api<RepoRow[]>('/repos').then((r) => setRepos(['manual', ...r.map((x) => x.name)]), onAuthError);
  }, []);

  return (
    <section>
      <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
        <input type="search" placeholder="Search" aria-label="Search" value={filter.q}
          onChange={(e) => setFilter({ ...filter, q: e.target.value })}
          className="rounded border border-zinc-300 bg-white px-2 py-1" />
        <Select label="Ecosystem" value={filter.ecosystem} options={ECOSYSTEMS} onChange={(ecosystem) => setFilter({ ...filter, ecosystem })} />
        <Select label="Bump" value={filter.bump} options={['major', 'minor', 'patch']} onChange={(bump) => setFilter({ ...filter, bump })} />
        <Select label="Repository" value={filter.repo} options={repos} onChange={(repo) => setFilter({ ...filter, repo })} />
        <label className="flex items-center gap-1">
          <input type="checkbox" checked={filter.all} onChange={(e) => setFilter({ ...filter, all: e.target.checked })} />
          Show up to date
        </label>
      </div>
      {rows === null ? (
        <p className="text-sm text-zinc-500">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-zinc-500">Nothing to show. On a fresh install, run a check first.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs uppercase text-zinc-500">
              <tr><th className="py-2 pr-3">Ecosystem</th><th className="pr-3">Name</th><th className="pr-3">In use</th><th className="pr-3">Minor / patch</th><th className="pr-3">Major</th><th>Behind since</th></tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <Fragment key={r.id}>
                  <tr className="border-t border-zinc-200 align-top">
                    <td className="py-2 pr-3">{r.ecosystem}</td>
                    <td className="py-2 pr-3">
                      <button type="button" aria-expanded={open === r.id} onClick={() => setOpen(open === r.id ? null : r.id)}
                        className="text-left font-medium underline-offset-2 hover:underline">
                        {r.label}
                      </button>
                    </td>
                    <td className="py-2 pr-3">{inUse(r.uses)}</td>
                    <td className="py-2 pr-3"><TargetCell target={r.minor} /></td>
                    <td className="py-2 pr-3"><TargetCell target={r.major} /></td>
                    <td className="py-2">{r.behindSince?.slice(0, 10) ?? '—'}</td>
                  </tr>
                  {open === r.id && (
                    <tr><td colSpan={6}><Detail id={r.id} onAuthError={onAuthError} onChanged={load} /></td></tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function Detail({ id, onAuthError, onChanged }: { id: number; onAuthError: OnAuthError; onChanged: () => void }) {
  const [detail, setDetail] = useState<PackageDetail | null>(null);
  useEffect(() => {
    api<PackageDetail>(`/packages/${id}`).then(setDetail, onAuthError);
  }, [id]);
  if (!detail) return <p className="p-3 text-sm text-zinc-500">Loading…</p>;

  const ignore = () => api(`/packages/${id}`, { method: 'PATCH', body: { ignored: true } }).then(onChanged, onAuthError);

  return (
    <div className="mb-3 space-y-3 rounded border border-zinc-200 bg-white p-3">
      <ul className="text-xs text-zinc-600">
        {detail.uses.map((u, i) => <li key={i}>{u.repo}{u.file && ` · ${u.file}`} · {describe(u)}</li>)}
      </ul>
      {detail.paths.length === 0 && <p className="text-sm text-zinc-500">No comparable version in use.</p>}
      {detail.paths.map((p) => (
        <div key={p.version} className="space-y-2">
          <h3 className="text-sm font-semibold">{p.version} <span className="font-normal text-zinc-500">in {p.repos.map(repoName).join(', ')}</span></h3>
          {!p.minor && !p.major && <p className="text-sm text-zinc-500">Up to date.</p>}
          <UpgradeNotes title="Minor / patch" from={p.version} upgrade={p.minor} />
          <UpgradeNotes title="Major" from={p.version} upgrade={p.major} />
        </div>
      ))}
      <button type="button" onClick={ignore} className="rounded border border-zinc-300 px-3 py-1 text-sm">Ignore</button>
    </div>
  );
}

function UpgradeNotes({ title, from, upgrade }: { title: string; from: string; upgrade: Upgrade | null }) {
  if (!upgrade) return null;
  const [target, ...between] = upgrade.releases;
  return (
    <div className="rounded border border-zinc-200 p-2">
      <p className="mb-1 flex items-center gap-2 text-xs font-medium uppercase text-zinc-500">
        {title}: {from} → {upgrade.to} <BumpBadge bump={upgrade.bump} />
      </p>
      <ReleaseNotes release={target} />
      {between.length > 0 && (
        <details className="mt-2">
          <summary className="cursor-pointer text-xs text-zinc-600">
            {between.length} release{between.length > 1 ? 's' : ''} between {from} and {upgrade.to}
          </summary>
          <div className="mt-2 space-y-2">{between.map((r) => <ReleaseNotes key={r.version} release={r} />)}</div>
        </details>
      )}
    </div>
  );
}

function ReleaseNotes({ release: r }: { release: Release }) {
  return (
    <article className="border-l-2 border-zinc-200 pl-3">
      <header className="flex flex-wrap items-center gap-2">
        <strong>{r.version}</strong>
        {r.publishedAt && <span className="text-xs text-zinc-500">{r.publishedAt.slice(0, 10)}</span>}
        {isHttpUrl(r.url) && (
          <a href={r.url} target="_blank" rel="noreferrer noopener" className="text-xs text-blue-700 underline">Release notes</a>
        )}
      </header>
      {r.notes
        ? <pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap font-sans text-xs text-zinc-700">{r.notes}</pre>
        : <p className="mt-1 text-xs text-zinc-500">No notes published with this release.</p>}
    </article>
  );
}
