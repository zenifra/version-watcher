import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ensurePackage, openDb, replaceRepoUsages, saveReleases, setIgnored } from './db.ts';
import { listPackages, listUpdates, packageDetail } from './updates.ts';

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
  assert.deepEqual(listUpdates(db, {}).map((r) => `${r.label} ${r.bump} ${r.latest} ${r.behindSince}`), [
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

test('packageDetail lists newer releases relative to the oldest use', () => {
  const { db, ids } = seed();
  const d = packageDetail(db, ids.express)!;
  assert.deepEqual(d.releases.map((r) => `${r.version}:${r.bump}`), ['5.0.0:major', '4.21.0:minor', '4.19.3:patch']);
  assert.deepEqual(d.uses.map((u) => u.repo), ['acme/api', 'acme/web']);
  assert.equal(packageDetail(db, 9999), null);
});
