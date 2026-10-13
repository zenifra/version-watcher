import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ensurePackage, finishRun, lastFinishedAt, listRepos, listRuns, openDb, packagesToCheck, pruneRepos,
  replaceRepoUsages, setIgnored, setRepoStatus, startRun,
} from './db.ts';

test('creates a missing data dir', () => {
  const dir = join(mkdtempSync(join(tmpdir(), 'vw-')), 'nested', 'data');
  openDb(dir).close();
  assert.ok(existsSync(join(dir, 'version-watcher.db')));
});

test('fails clearly on a read-only data dir', { skip: process.getuid?.() === 0 }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'vw-'));
  chmodSync(dir, 0o500);
  assert.throws(() => openDb(dir), /EACCES/);
});

test('usages, repo pruning and packages to check', () => {
  const db = openDb(':memory:');
  replaceRepoUsages(db, 'acme/a', [
    { ecosystem: 'npm', name: 'express', version: '4.21.2', pin: 'exact', file: 'package.json' },
    { ecosystem: 'actions', name: 'org/tool', version: 'main', pin: 'floating', file: '.github/workflows/ci.yml' },
  ]);
  replaceRepoUsages(db, 'acme/b', [{ ecosystem: 'npm', name: 'express', version: '4.19.0', pin: 'range', file: 'package.json' }]);
  ensurePackage(db, { ecosystem: 'infra', name: 'longhorn/longhorn', label: 'Longhorn', source: 'manual', currentVersion: 'v1.7.2' });
  const ignored = ensurePackage(db, { ecosystem: 'pypi', name: 'django', source: 'manual', currentVersion: '5.0.0' });
  setIgnored(db, ignored, true);
  setRepoStatus(db, 'acme/a', 'ok', null, '2026-10-13T00:00:00Z');
  setRepoStatus(db, 'acme/b', 'ok', null, '2026-10-13T00:00:00Z');

  assert.deepEqual(packagesToCheck(db).map((p) => `${p.ecosystem} ${p.name} ${p.minVersion}`), [
    'npm express 4.19.0',
    'infra longhorn/longhorn v1.7.2',
  ]);

  pruneRepos(db, ['acme/a']);
  assert.deepEqual(listRepos(db).map((r) => r.name), ['acme/a']);
  assert.equal(packagesToCheck(db)[0].minVersion, '4.21.2');
});

test('runs', () => {
  const db = openDb(':memory:');
  assert.equal(lastFinishedAt(db), null);
  const id = startRun(db, '2026-10-13T00:00:00Z');
  finishRun(db, id, '2026-10-13T00:01:00Z', 3, ['boom']);
  assert.equal(lastFinishedAt(db), '2026-10-13T00:01:00Z');
  assert.deepEqual(listRuns(db, 10), [
    { id, startedAt: '2026-10-13T00:00:00Z', finishedAt: '2026-10-13T00:01:00Z', packagesChecked: 3, errors: ['boom'] },
  ]);
});
