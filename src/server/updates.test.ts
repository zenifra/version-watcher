import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ensurePackage, openDb, replaceRepoUsages, saveReleases, setIgnored } from './db.ts';
import { listPackages, listUpdates, packageDetail, type Upgrade } from './updates.ts';

const rel = (version: string, publishedAt: string) => ({ version, publishedAt, url: null, notes: null });

function seed() {
  const db = openDb(':memory:');
  replaceRepoUsages(db, 'acme/api', [
    { ecosystem: 'npm', name: 'express', version: '4.19.2', pin: 'exact', file: 'package.json' },
    { ecosystem: 'actions', name: 'actions/checkout', version: 'v4', pin: 'exact', file: '.github/workflows/ci.yml' },
    { ecosystem: 'npm', name: 'left-pad', version: '1.3.0', pin: 'exact', file: 'package.json' },
  ]);
  replaceRepoUsages(db, 'acme/web', [
    { ecosystem: 'npm', name: 'express', version: '4.21.0', pin: 'exact', file: 'package.json' },
    { ecosystem: 'actions', name: 'org/tool', version: '0123456789abcdef0123456789abcdef01234567', pin: 'sha', file: '.github/workflows/ci.yml' },
  ]);
  const ids = Object.fromEntries(
    (db.prepare('select id, name from packages').all() as { id: number; name: string }[]).map((p) => [p.name, p.id]),
  );
  saveReleases(db, ids.express, [rel('4.19.3', '2026-01-01'), rel('4.21.0', '2026-03-01'), rel('5.0.0', '2026-05-01')]);
  saveReleases(db, ids['actions/checkout'], [rel('v4.2.2', '2026-02-01')]);
  const lh = ensurePackage(db, { ecosystem: 'infra', name: 'longhorn/longhorn', label: 'Longhorn', source: 'manual', currentVersion: 'v1.7.2' });
  saveReleases(db, lh, [rel('v1.7.3', '2026-04-01')]);
  return { db, ids, lh };
}

test('lists only packages behind, most severe and longest behind first', () => {
  const { db } = seed();
  assert.deepEqual(listUpdates(db, {}).map((r) => `${r.label} ${r.bump} ${(r.major ?? r.minor)?.to} ${r.behindSince}`), [
    'express major 5.0.0 2026-01-01',
    'Longhorn patch v1.7.3 2026-04-01',
  ]);
});

test('a floating major tag is not behind on minors; all=1 shows it', () => {
  const { db } = seed();
  const all = listUpdates(db, { all: true }).map((r) => `${r.label}:${r.bump}`);
  assert.deepEqual(all.sort(), ['Longhorn:patch', 'actions/checkout:null', 'express:major', 'left-pad:null', 'org/tool:null']);
});

test('filters', () => {
  const { db } = seed();
  assert.deepEqual(listUpdates(db, { ecosystem: 'infra' }).map((r) => r.label), ['Longhorn']);
  assert.deepEqual(listUpdates(db, { bump: 'patch' }).map((r) => r.label), ['Longhorn']);
  assert.deepEqual(listUpdates(db, { repo: 'acme/web' }).map((r) => r.label), ['express']);
  assert.deepEqual(listUpdates(db, { q: 'LONG' }).map((r) => r.label), ['Longhorn']);
  assert.deepEqual(listUpdates(db, { repo: 'manual' }).map((r) => r.label), ['Longhorn']);
});

test('ignored packages leave the list and show up in listPackages', () => {
  const { db, ids } = seed();
  setIgnored(db, ids.express, true);
  assert.deepEqual(listUpdates(db, {}).map((r) => r.label), ['Longhorn']);
  const { manual, ignored } = listPackages(db);
  assert.deepEqual(manual.map((r) => r.label), ['Longhorn']);
  assert.deepEqual(ignored.map((r) => r.label), ['express']);
});

test('rows point at the newest minor/patch and the newest major of the oldest use', () => {
  const { db } = seed();
  const express = listUpdates(db, {}).find((r) => r.label === 'express')!;
  assert.deepEqual([express.minor, express.major], [{ to: '4.21.0', bump: 'minor' }, { to: '5.0.0', bump: 'major' }]);
  const checkout = listUpdates(db, { all: true }).find((r) => r.label === 'actions/checkout')!;
  assert.deepEqual([checkout.minor, checkout.major], [null, null]);
});

test('packageDetail: per version in use, a minor/patch and a major upgrade with every release in between', () => {
  const db = openDb(':memory:');
  const found = (version: string) => [{ ecosystem: 'docker' as const, name: 'node:#.#.#-alpine', version, pin: 'exact' as const, file: 'Dockerfile' }];
  replaceRepoUsages(db, 'acme/api', found('24.12.0'));
  replaceRepoUsages(db, 'acme/jobs', found('24.12.0'));
  replaceRepoUsages(db, 'acme/web', found('26.0.0'));
  const { id } = db.prepare('select id from packages').get() as { id: number };
  saveReleases(db, id, ['24.12.1', '24.13.0', '24.13.1', '25.0.0', '26.0.0', '26.0.1'].map((v) => rel(v, '2026-01-01')));
  const upgrade = (u: Upgrade | null) => u && `${u.to} ${u.bump}: ${u.releases.map((r) => r.version).join(' ')}`;
  assert.deepEqual(packageDetail(db, id)!.paths.map((p) => [p.version, p.repos, upgrade(p.minor), upgrade(p.major)]), [
    ['24.12.0', ['acme/api', 'acme/jobs'], '24.13.1 minor: 24.13.1 24.13.0 24.12.1', '26.0.1 major: 26.0.1 26.0.0 25.0.0'],
    ['26.0.0', ['acme/web'], '26.0.1 patch: 26.0.1', null],
  ]);
  assert.equal(packageDetail(db, 9999), null);
});

test('packageDetail: a floating major tag only has a major upgrade; uncomparable pins have no paths', () => {
  const { db, ids } = seed();
  saveReleases(db, ids['actions/checkout'], [rel('v4.2.2', '2026-02-01'), rel('v5.0.0', '2026-05-01')]);
  const [checkout] = packageDetail(db, ids['actions/checkout'])!.paths;
  assert.equal(checkout.minor, null);
  assert.equal(checkout.major?.to, 'v5.0.0');
  assert.deepEqual(packageDetail(db, ids['org/tool'])!.paths, []);
});
