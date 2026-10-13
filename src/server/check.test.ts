import { mock, test } from 'node:test';
import assert from 'node:assert/strict';
import { type Checker, createChecker, runCheck, scheduleChecks } from './check.ts';
import type { Config } from './config.ts';
import { listRepos, listRuns, openDb } from './db.ts';
import { stubFetch } from './test-helpers.ts';
import { listUpdates } from './updates.ts';

const config: Config = {
  port: 0, githubToken: 't', owners: ['acme'], authPassword: 'p', authDisabled: false,
  dataDir: ':memory:', intervalHours: 24, ignorePaths: ['node_modules/'],
};
const GH = 'https://api.github.com';
const repo = (name: string, extra = {}) => ({ full_name: name, owner: { login: name.split('/')[0] }, default_branch: 'main', archived: false, ...extra });

function routes(overrides: Record<string, unknown> = {}) {
  return {
    [`${GH}/user/repos`]: [
      repo('acme/app'), repo('acme/empty'), repo('acme/secret'), repo('acme/half'),
      repo('acme/old', { archived: true }), repo('other/x'),
    ],
    [`${GH}/repos/acme/app/git/trees/main`]: {
      tree: ['package.json', 'package-lock.json', 'Dockerfile', '.github/workflows/ci.yml', 'node_modules/x/package.json']
        .map((path) => ({ path, type: 'blob' })),
    },
    [`${GH}/repos/acme/app/contents/package.json`]: JSON.stringify({ dependencies: { express: '^4.19.0' } }),
    [`${GH}/repos/acme/app/contents/package-lock.json`]: JSON.stringify({ packages: { 'node_modules/express': { version: '4.19.2' } } }),
    [`${GH}/repos/acme/app/contents/Dockerfile`]: 'FROM node:24-alpine',
    [`${GH}/repos/acme/app/contents/.github/workflows/ci.yml`]: '      - uses: actions/checkout@v4',
    [`${GH}/repos/acme/empty/git/trees/main`]: new Response('{"message":"Git Repository is empty."}', { status: 409 }),
    [`${GH}/repos/acme/secret/git/trees/main`]: new Response('{"message":"Forbidden"}', { status: 403 }),
    [`${GH}/repos/acme/half/git/trees/main`]: { tree: [{ path: 'package.json', type: 'blob' }, { path: 'Dockerfile', type: 'blob' }] },
    [`${GH}/repos/acme/half/contents/package.json`]: '{ broken',
    [`${GH}/repos/acme/half/contents/Dockerfile`]: 'FROM python:3.12-slim',
    'https://registry.npmjs.org/express': {
      versions: { '4.19.2': {}, '4.21.2': {}, '5.1.0': {}, '6.0.0-beta.1': {} },
      time: { '4.21.2': '2026-01-01T00:00:00Z', '5.1.0': '2026-03-01T00:00:00Z' },
    },
    'https://hub.docker.com/v2/repositories/library/node/tags': { next: null, results: [{ name: '26-alpine', last_updated: '2026-04-01T00:00:00Z' }] },
    'https://hub.docker.com/v2/repositories/library/python/tags': { next: null, results: [{ name: '3.13-slim', last_updated: '2026-02-01T00:00:00Z' }] },
    [`${GH}/repos/actions/checkout/releases`]: [
      { tag_name: 'v5.0.0', draft: false, prerelease: false, published_at: '2026-05-01T00:00:00Z', html_url: 'https://github.com/actions/checkout/releases/tag/v5.0.0', body: 'v5' },
    ],
    ...overrides,
  };
}

test('full check: scans repos, isolates failures, stores releases', async () => {
  const db = openDb(':memory:');
  await runCheck({ db, config, fetch: stubFetch(routes()), now: () => new Date('2026-10-13T00:00:00Z') });

  assert.deepEqual(listRepos(db).map((r) => `${r.name} ${r.status}`), [
    'acme/app ok', 'acme/empty no-manifest', 'acme/half error', 'acme/secret error',
  ]);
  assert.match(listRepos(db).find((r) => r.name === 'acme/half')!.error!, /^package\.json: /);
  // major before minor, then the longest behind first
  assert.deepEqual(listUpdates(db, {}).map((r) => `${r.ecosystem} ${r.label} ${r.bump} ${r.latest}`), [
    'npm express major 5.1.0',
    'docker node:#-alpine major 26',
    'actions actions/checkout major v5.0.0',
    'docker python:#.#-slim minor 3.13',
  ]);
  const run = listRuns(db, 1)[0];
  assert.equal(run.finishedAt, '2026-10-13T00:00:00.000Z');
  assert.equal(run.packagesChecked, 4);
  assert.ok(run.errors.some((e) => e.startsWith('acme/secret: HTTP 403')));
  assert.ok(run.errors.some((e) => e.startsWith('acme/half/package.json')));
});

test('rate limit stops the run and is recorded', async () => {
  const db = openDb(':memory:');
  const limited = new Response('', { status: 403, headers: { 'x-ratelimit-remaining': '0' } });
  await runCheck({ db, config, fetch: stubFetch(routes({ [`${GH}/repos/acme/app/git/trees/main`]: limited })) });
  const run = listRuns(db, 1)[0];
  assert.ok(run.finishedAt);
  assert.deepEqual(run.errors, ['rate limited by api.github.com']);
  assert.equal(run.packagesChecked, 0);
});

test('only one check at a time', async () => {
  const db = openDb(':memory:');
  const checker = createChecker({ db, config, fetch: stubFetch(routes()) });
  assert.equal(checker.start(), true);
  assert.equal(checker.running, true);
  assert.equal(checker.start(), false);
  await checker.idle();
  assert.equal(checker.running, false);
  assert.equal(listRuns(db, 5).length, 1);
});

test('a storage failure is logged, never an unhandled rejection', async () => {
  const db = openDb(':memory:');
  db.exec('drop table runs');
  const checker = createChecker({ db, config, fetch: stubFetch(routes()) });
  assert.equal(checker.start(), true);
  await checker.idle();
  assert.equal(checker.running, false);
  assert.equal(checker.start(), true);
  await checker.idle();
});

test('after a restart the next check waits only for the rest of the interval', () => {
  mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  try {
    let starts = 0;
    const fake: Checker = { running: false, start: () => { starts++; return true; }, idle: async () => {} };
    const hour = 3600 * 1000;
    const now = Date.parse('2026-10-13T12:00:00Z');
    scheduleChecks(fake, new Date(now - 23 * hour).toISOString(), 24 * hour, now);
    mock.timers.tick(hour - 1);
    assert.equal(starts, 0);
    mock.timers.tick(1);
    assert.equal(starts, 1);
    mock.timers.tick(24 * hour);
    assert.equal(starts, 2);

    starts = 0;
    scheduleChecks(fake, null, 24 * hour, now);
    mock.timers.tick(0);
    assert.equal(starts, 1);
  } finally {
    mock.timers.reset();
  }
});
