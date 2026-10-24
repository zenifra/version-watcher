import type { DatabaseSync } from 'node:sqlite';
import type { Bump, Ecosystem, Pin, Release } from './types.ts';
import { COMPARABLE } from './types.ts';
import { bumpOf, compareVersions, parseVersion } from './version.ts';

export interface Use {
  repo: string;
  file: string;
  version: string;
  pin: Pin;
}

export interface UpdateRow {
  id: number;
  ecosystem: Ecosystem;
  name: string;
  label: string;
  source: 'scan' | 'manual';
  uses: Use[];
  bump: Bump | null;
  // Targets for the oldest version in use.
  minor: Target | null;
  major: Target | null;
  behindSince: string | null;
}

export interface Target {
  to: string;
  bump: Bump;
}

export interface Upgrade extends Target {
  // Newest first: the target, then every release between it and the version in use.
  releases: Release[];
}

export interface UpgradePaths {
  version: string;
  repos: string[];
  minor: Upgrade | null; // newest release on the same major line
  major: Upgrade | null; // newest release on a later major line
}

export interface UpdateFilter {
  ecosystem?: string;
  bump?: string;
  repo?: string;
  q?: string;
  all?: boolean;
}

export interface PackageDetail extends UpdateRow {
  ignored: boolean;
  paths: UpgradePaths[];
}

export interface IgnoredRow {
  id: number;
  ecosystem: Ecosystem;
  name: string;
  label: string;
}

interface PackageRow {
  id: number;
  ecosystem: Ecosystem;
  name: string;
  label: string;
  source: 'scan' | 'manual';
  current_version: string | null;
  ignored: number;
}

const rank = (b: Bump | null) => (b ? { patch: 1, minor: 2, major: 3 }[b] : 0);

function usesOf(db: DatabaseSync, p: PackageRow): Use[] {
  if (p.source === 'manual') {
    return p.current_version ? [{ repo: 'manual', file: '', version: p.current_version, pin: 'exact' }] : [];
  }
  return db.prepare('select repo, file, version, pin from usages where package_id = ? order by repo, file').all(p.id) as unknown as Use[];
}

function releasesOf(db: DatabaseSync, id: number): Release[] {
  const rows = db
    .prepare('select version, published_at as publishedAt, url, notes from releases where package_id = ?')
    .all(id) as unknown as Release[];
  return rows.sort((a, b) => compareVersions(b.version, a.version));
}

function upgradesFrom(version: string, releases: Release[]): Pick<UpgradePaths, 'minor' | 'major'> {
  const major = parseVersion(version)![0];
  const newer = releases.filter((r) => bumpOf(version, r.version));
  const upgrade = (rs: Release[]): Upgrade | null =>
    rs.length ? { to: rs[0].version, bump: bumpOf(version, rs[0].version)!, releases: rs } : null;
  return {
    minor: upgrade(newer.filter((r) => parseVersion(r.version)![0] === major)),
    major: upgrade(newer.filter((r) => parseVersion(r.version)![0] > major)),
  };
}

const comparable = (uses: Use[]) => uses.filter((u) => COMPARABLE.has(u.pin) && parseVersion(u.version));
const target = (u: Upgrade | null): Target | null => u && { to: u.to, bump: u.bump };

function summarize(p: PackageRow, uses: Use[], releases: Release[]): UpdateRow {
  let bump: Bump | null = null;
  let behindSince: string | null = null;
  for (const u of uses) {
    if (!COMPARABLE.has(u.pin)) continue;
    const newer = releases.filter((r) => bumpOf(u.version, r.version));
    if (!newer.length) continue;
    const b = bumpOf(u.version, newer[0].version);
    if (rank(b) > rank(bump)) bump = b;
    const oldest = newer[newer.length - 1].publishedAt;
    if (oldest && (!behindSince || oldest < behindSince)) behindSince = oldest;
  }
  const oldest = comparable(uses).map((u) => u.version).sort(compareVersions)[0];
  const { minor, major } = oldest ? upgradesFrom(oldest, releases) : { minor: null, major: null };
  return {
    id: p.id, ecosystem: p.ecosystem, name: p.name, label: p.label, source: p.source, uses,
    bump, minor: target(minor), major: target(major), behindSince,
  };
}

export function listUpdates(db: DatabaseSync, f: UpdateFilter): UpdateRow[] {
  const q = f.q?.toLowerCase();
  return (db.prepare('select * from packages where ignored = 0').all() as unknown as PackageRow[])
    .map((p) => summarize(p, usesOf(db, p), releasesOf(db, p.id)))
    .filter(
      (r) =>
        r.uses.length > 0 &&
        (f.all || r.bump) &&
        (!f.ecosystem || r.ecosystem === f.ecosystem) &&
        (!f.bump || r.bump === f.bump) &&
        (!f.repo || r.uses.some((u) => u.repo === f.repo)) &&
        (!q || r.label.toLowerCase().includes(q)),
    )
    .sort(
      (a, b) =>
        rank(b.bump) - rank(a.bump) ||
        (a.behindSince ?? '~').localeCompare(b.behindSince ?? '~') ||
        a.label.localeCompare(b.label),
    );
}

export function packageDetail(db: DatabaseSync, id: number): PackageDetail | null {
  const p = db.prepare('select * from packages where id = ?').get(id) as unknown as PackageRow | undefined;
  if (!p) return null;
  const uses = usesOf(db, p);
  const releases = releasesOf(db, id);
  const repos = new Map<string, Set<string>>();
  for (const u of comparable(uses)) repos.set(u.version, (repos.get(u.version) ?? new Set()).add(u.repo));
  return {
    ...summarize(p, uses, releases),
    ignored: p.ignored === 1,
    paths: [...repos]
      .sort(([a], [b]) => compareVersions(a, b))
      .map(([version, inRepos]) => ({ version, repos: [...inRepos], ...upgradesFrom(version, releases) })),
  };
}

export function listPackages(db: DatabaseSync): { manual: UpdateRow[]; ignored: IgnoredRow[] } {
  return {
    manual: listUpdates(db, { all: true }).filter((r) => r.source === 'manual').sort((a, b) => a.label.localeCompare(b.label)),
    ignored: db.prepare('select id, ecosystem, name, label from packages where ignored = 1 order by label').all() as unknown as IgnoredRow[],
  };
}
