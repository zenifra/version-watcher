import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createApp } from './app.ts';
import { issueSession } from './auth.ts';
import type { Checker } from './check.ts';
import type { Config } from './config.ts';
import { openDb } from './db.ts';

const config: Config = {
  port: 0, githubToken: 't', owners: [], authPassword: 'pw', authDisabled: false,
  dataDir: ':memory:', intervalHours: 24, ignorePaths: [],
};
const now = Date.parse('2026-10-13T00:00:00Z');
const cookie = `session=${issueSession('pw', now)}`;
let base = '';
let server: Server;
let running = false;
const checker: Checker = {
  get running() { return running; },
  start() { if (running) return false; running = true; return true; },
  async idle() {},
};

before(async () => {
  const app = createApp({ db: openDb(':memory:'), config, checker, webDir: '/nonexistent', now: () => now, loginDelayMs: 0 });
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => server.close());

const call = (path: string, init: RequestInit = {}) => fetch(base + path, init);
const json = (method: string, body: unknown, withCookie = true): RequestInit => ({
  method,
  headers: { 'content-type': 'application/json', ...(withCookie ? { cookie } : {}) },
  body: JSON.stringify(body),
});

test('health is public; everything else needs a session', async () => {
  assert.equal((await call('/api/health')).status, 200);
  assert.equal((await call('/api/updates')).status, 401);
  assert.equal((await call('/api/updates', { headers: { cookie: 'session=1.forged' } })).status, 401);
  const expired = `session=${issueSession('pw', now - 31 * 24 * 3600 * 1000)}`;
  assert.equal((await call('/api/updates', { headers: { cookie: expired } })).status, 401);
  assert.equal((await call('/api/updates', { headers: { cookie } })).status, 200);
});

test('login sets an HttpOnly session cookie', async () => {
  assert.equal((await call('/api/login', json('POST', { password: 'nope' }, false))).status, 401);
  const ok = await call('/api/login', json('POST', { password: 'pw' }, false));
  assert.equal(ok.status, 200);
  const setCookie = ok.headers.get('set-cookie') ?? '';
  assert.match(setCookie, /^session=\d+\./);
  assert.match(setCookie, /HttpOnly/);
  assert.match(setCookie, /SameSite=Lax/);
});

test('writes require JSON', async () => {
  const res = await call('/api/runs', { method: 'POST', headers: { cookie, 'content-type': 'text/plain' }, body: '{}' });
  assert.equal(res.status, 415);
});

test('manual infra CRUD with validation', async () => {
  assert.equal((await call('/api/packages', json('POST', { label: 'Longhorn', name: 'not a repo', currentVersion: 'v1' }))).status, 400);
  assert.equal((await call('/api/packages', json('POST', { label: 'Longhorn', name: 'longhorn/longhorn', currentVersion: 'latest' }))).status, 400);
  const created = await call('/api/packages', json('POST', { label: 'Longhorn', name: 'longhorn/longhorn', currentVersion: 'v1.7.2' }));
  assert.equal(created.status, 201);
  const { id } = (await created.json()) as { id: number };
  assert.equal((await call('/api/packages', json('POST', { label: 'LH', name: 'longhorn/longhorn', currentVersion: 'v1.7.2' }))).status, 409);

  const patched = await call(`/api/packages/${id}`, json('PATCH', { currentVersion: 'v1.8.0' }));
  assert.equal(((await patched.json()) as { uses: { version: string }[] }).uses[0].version, 'v1.8.0');
  assert.equal((await call(`/api/packages/${id}`, json('PATCH', { ignored: 'yes' }))).status, 400);

  const list = (await (await call('/api/packages', { headers: { cookie } })).json()) as { manual: { label: string }[] };
  assert.deepEqual(list.manual.map((m) => m.label), ['Longhorn']);
  assert.equal((await call(`/api/packages/${id}`, { method: 'DELETE', headers: { cookie } })).status, 204);
  assert.equal((await call(`/api/packages/${id}`, { headers: { cookie } })).status, 404);
});

test('check now: 202 then 409 while running', async () => {
  running = false;
  assert.equal((await call('/api/runs', json('POST', {}))).status, 202);
  assert.equal((await call('/api/runs', json('POST', {}))).status, 409);
  const runs = (await (await call('/api/runs', { headers: { cookie } })).json()) as { running: boolean };
  assert.equal(runs.running, true);
  running = false;
});

test('unknown api route is a JSON 404', async () => {
  const res = await call('/api/nope', { headers: { cookie } });
  assert.equal(res.status, 404);
  assert.deepEqual(await res.json(), { error: 'not found' });
});
