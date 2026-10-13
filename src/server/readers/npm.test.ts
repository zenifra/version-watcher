import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readPackageJson } from './npm.ts';

const pkg = JSON.stringify({
  dependencies: { express: '^4.19.2', local: 'file:../local', ws: 'workspace:*', gh: 'user/repo', alias: 'npm:other@1.0.0' },
  devDependencies: { typescript: '~5.6.0', tool: 'latest' },
});

test('uses package-lock.json versions and skips non-registry specs', () => {
  const lock = JSON.stringify({ lockfileVersion: 3, packages: { 'node_modules/express': { version: '4.21.2' } } });
  assert.deepEqual(readPackageJson(pkg, { kind: 'npm', text: lock }), [
    { ecosystem: 'npm', name: 'typescript', version: '5.6.0', pin: 'range' },
    { ecosystem: 'npm', name: 'tool', version: 'latest', pin: 'floating' },
    { ecosystem: 'npm', name: 'express', version: '4.21.2', pin: 'exact' },
  ]);
});

test('prefers the workspace-local entry of a root lockfile', () => {
  const lock = JSON.stringify({
    packages: { 'apps/web/node_modules/react': { version: '19.0.0' }, 'node_modules/react': { version: '18.3.1' } },
  });
  const web = JSON.stringify({ dependencies: { react: '^19.0.0' } });
  assert.deepEqual(readPackageJson(web, { kind: 'npm', text: lock }, 'apps/web'), [
    { ecosystem: 'npm', name: 'react', version: '19.0.0', pin: 'exact' },
  ]);
});

test('reads lockfile v1 dependencies', () => {
  const lock = JSON.stringify({ lockfileVersion: 1, dependencies: { express: { version: '4.18.2' } } });
  const p = JSON.stringify({ dependencies: { express: '^4.18.0' } });
  assert.equal(readPackageJson(p, { kind: 'npm', text: lock })[0].version, '4.18.2');
});

test('reads bun.lock (JSON with trailing commas)', () => {
  const lock = `{
  "lockfileVersion": 1,
  "workspaces": { "": { "name": "app", "dependencies": { "hono": "^4.6.0", }, }, },
  "packages": {
    "hono": ["hono@4.7.10", "", {}, "sha512-abc"],
    "@scope/lib": ["@scope/lib@2.1.0", "", {}, "sha512-def"],
  }
}`;
  const p = JSON.stringify({ dependencies: { hono: '^4.6.0', '@scope/lib': '^2.0.0' } });
  assert.deepEqual(readPackageJson(p, { kind: 'bun', text: lock }), [
    { ecosystem: 'npm', name: 'hono', version: '4.7.10', pin: 'exact' },
    { ecosystem: 'npm', name: '@scope/lib', version: '2.1.0', pin: 'exact' },
  ]);
});

test('falls back to the range minimum without a lockfile', () => {
  assert.deepEqual(readPackageJson(JSON.stringify({ dependencies: { express: '^4.19.2' } }), null), [
    { ecosystem: 'npm', name: 'express', version: '4.19.2', pin: 'range' },
  ]);
});

test('throws on invalid JSON', () => {
  assert.throws(() => readPackageJson('{ nope', null));
});
