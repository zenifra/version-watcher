import { accessSync, constants, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { Ecosystem, FoundIn, Pin, Release } from './types.ts';
import { COMPARABLE } from './types.ts';
import { compareVersions, parseVersion } from './version.ts';

export type RepoStatus = 'ok' | 'no-manifest' | 'error';

export interface RunRow {
  id: number;
  startedAt: string;
  finishedAt: string | null;
  packagesChecked: number;
  errors: string[];
}

export interface RepoRow {
  name: string;
  lastScanAt: string | null;
  status: RepoStatus;
  error: string | null;
}

const SCHEMA = `
create table if not exists packages (
  id integer primary key,
  ecosystem text not null,
  name text not null,
  label text not null,
  source text not null,
  current_version text,
  ignored integer not null default 0,
  unique (ecosystem, name)
);
create table if not exists usages (
  package_id integer not null references packages(id) on delete cascade,
  repo text not null,
  file text not null,
  version text not null,
  pin text not null
);
create index if not exists usages_repo on usages(repo);
create index if not exists usages_package on usages(package_id);
create table if not exists releases (
  package_id integer not null references packages(id) on delete cascade,
  version text not null,
  published_at text,
  url text,
  notes text,
  primary key (package_id, version)
);
create table if not exists repos (
  name text primary key,
  last_scan_at text,
  status text not null,
  error text
);
create table if not exists runs (
  id integer primary key,
  started_at text not null,
  finished_at text,
  packages_checked integer not null default 0,
  errors_json text not null default '[]'
);`;

export function openDb(dataDir: string): DatabaseSync {
  let file = ':memory:';
  if (dataDir !== ':memory:') {
    mkdirSync(dataDir, { recursive: true });
    accessSync(dataDir, constants.W_OK);
    file = join(dataDir, 'version-watcher.db');
  }
  const db = new DatabaseSync(file);
  db.exec('pragma journal_mode = wal; pragma foreign_keys = on;');
  db.exec(SCHEMA);
  return db;
}

function tx(db: DatabaseSync, fn: () => void): void {
  db.exec('begin');
  try {
    fn();
    db.exec('commit');
  } catch (e) {
    db.exec('rollback');
    throw e;
  }
}

export function ensurePackage(
  db: DatabaseSync,
  p: { ecosystem: Ecosystem; name: string; label?: string; source?: 'scan' | 'manual'; currentVersion?: string | null },
): number {
  db.prepare(
    'insert into packages (ecosystem, name, label, source, current_version) values (?, ?, ?, ?, ?) on conflict (ecosystem, name) do nothing',
  ).run(p.ecosystem, p.name, p.label ?? p.name, p.source ?? 'scan', p.currentVersion ?? null);
  return (db.prepare('select id from packages where ecosystem = ? and name = ?').get(p.ecosystem, p.name) as { id: number }).id;
}

export function replaceRepoUsages(db: DatabaseSync, repo: string, found: FoundIn[]): void {
  tx(db, () => {
    db.prepare('delete from usages where repo = ?').run(repo);
    const insert = db.prepare('insert into usages (package_id, repo, file, version, pin) values (?, ?, ?, ?, ?)');
    for (const f of found) insert.run(ensurePackage(db, f), repo, f.file, f.version, f.pin);
  });
}

export function setRepoStatus(db: DatabaseSync, name: string, status: RepoStatus, error: string | null, at: string): void {
  db.prepare(
    'insert into repos (name, last_scan_at, status, error) values (?, ?, ?, ?) on conflict (name) do update set last_scan_at = excluded.last_scan_at, status = excluded.status, error = excluded.error',
  ).run(name, at, status, error);
}

// Forget repos that were archived, deleted or are no longer visible to the token.
export function pruneRepos(db: DatabaseSync, keep: string[]): void {
  const kept = new Set(keep);
  tx(db, () => {
    for (const { name } of db.prepare('select name from repos').all() as { name: string }[]) {
      if (!kept.has(name)) db.prepare('delete from repos where name = ?').run(name);
    }
    for (const { repo } of db.prepare('select distinct repo from usages').all() as { repo: string }[]) {
      if (!kept.has(repo)) db.prepare('delete from usages where repo = ?').run(repo);
    }
  });
}

export function packagesToCheck(db: DatabaseSync): { id: number; ecosystem: Ecosystem; name: string; minVersion: string }[] {
  const packages = db.prepare('select id, ecosystem, name, source, current_version from packages where ignored = 0 order by id').all() as {
    id: number; ecosystem: Ecosystem; name: string; source: string; current_version: string | null;
  }[];
  const out: { id: number; ecosystem: Ecosystem; name: string; minVersion: string }[] = [];
  for (const p of packages) {
    const versions =
      p.source === 'manual'
        ? [p.current_version ?? '']
        : (db.prepare('select version, pin from usages where package_id = ?').all(p.id) as { version: string; pin: string }[])
            .filter((u) => COMPARABLE.has(u.pin as Pin))
            .map((u) => u.version);
    const min = versions.filter((v) => parseVersion(v)).sort(compareVersions)[0];
    if (min) out.push({ id: p.id, ecosystem: p.ecosystem, name: p.name, minVersion: min });
  }
  return out;
}

export function saveReleases(db: DatabaseSync, packageId: number, releases: Release[]): void {
  tx(db, () => {
    db.prepare('delete from releases where package_id = ?').run(packageId);
    const insert = db.prepare(
      'insert or ignore into releases (package_id, version, published_at, url, notes) values (?, ?, ?, ?, ?)',
    );
    for (const r of releases) insert.run(packageId, r.version, r.publishedAt, r.url, r.notes);
  });
}

export function setIgnored(db: DatabaseSync, id: number, ignored: boolean): void {
  db.prepare('update packages set ignored = ? where id = ?').run(ignored ? 1 : 0, id);
}

export function setCurrentVersion(db: DatabaseSync, id: number, version: string): void {
  db.prepare('update packages set current_version = ? where id = ?').run(version, id);
}

export function deletePackage(db: DatabaseSync, id: number): void {
  db.prepare('delete from packages where id = ?').run(id);
}

export function startRun(db: DatabaseSync, at: string): number {
  return Number(db.prepare('insert into runs (started_at) values (?)').run(at).lastInsertRowid);
}

export function finishRun(db: DatabaseSync, id: number, at: string, checked: number, errors: string[]): void {
  db.prepare('update runs set finished_at = ?, packages_checked = ?, errors_json = ? where id = ?').run(
    at, checked, JSON.stringify(errors), id,
  );
}

export function lastFinishedAt(db: DatabaseSync): string | null {
  const row = db.prepare('select max(finished_at) as at from runs').get() as { at: string | null };
  return row.at;
}

export function listRuns(db: DatabaseSync, limit: number): RunRow[] {
  const rows = db.prepare('select * from runs order by id desc limit ?').all(limit) as {
    id: number; started_at: string; finished_at: string | null; packages_checked: number; errors_json: string;
  }[];
  return rows.map((r) => ({
    id: r.id,
    startedAt: r.started_at,
    finishedAt: r.finished_at,
    packagesChecked: r.packages_checked,
    errors: JSON.parse(r.errors_json) as string[],
  }));
}

export function listRepos(db: DatabaseSync): RepoRow[] {
  return db.prepare('select name, last_scan_at as lastScanAt, status, error from repos order by name').all() as unknown as RepoRow[];
}
