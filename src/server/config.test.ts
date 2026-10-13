import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ConfigError, loadConfig } from './config.ts';

test('defaults', () => {
  assert.deepEqual(loadConfig({ GITHUB_TOKEN: 't', AUTH_PASSWORD: 'p' }), {
    port: 3000, githubToken: 't', owners: [], authPassword: 'p', authDisabled: false, dataDir: './data',
    intervalHours: 24, ignorePaths: ['node_modules/', 'test/fixtures/', 'examples/'],
  });
});

test('parses lists and numbers', () => {
  const c = loadConfig({ GITHUB_TOKEN: 't', AUTH_DISABLED: 'true', GITHUB_OWNERS: ' Acme, other ', PORT: '8080', IGNORE_PATHS: '', CHECK_INTERVAL_HOURS: '6' });
  assert.deepEqual([c.owners, c.port, c.ignorePaths, c.intervalHours, c.authPassword], [['acme', 'other'], 8080, [], 6, null]);
});

test('rejects unsafe or invalid config', () => {
  assert.throws(() => loadConfig({ AUTH_PASSWORD: 'p' }), ConfigError);
  assert.throws(() => loadConfig({ GITHUB_TOKEN: 't' }), /AUTH_PASSWORD/);
  assert.throws(() => loadConfig({ GITHUB_TOKEN: 't', AUTH_PASSWORD: 'p', PORT: 'abc' }), /PORT/);
  assert.throws(() => loadConfig({ GITHUB_TOKEN: 't', AUTH_PASSWORD: 'p', CHECK_INTERVAL_HOURS: '1000' }), /CHECK_INTERVAL_HOURS/);
});
