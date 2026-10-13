import { test } from 'node:test';
import assert from 'node:assert/strict';
import { manifestPaths, readManifests } from './scan.ts';

test('manifestPaths keeps known manifests and drops ignored paths', () => {
  const paths = [
    'package.json', 'package-lock.json', 'apps/web/package.json', 'node_modules/x/package.json',
    'examples/demo/Dockerfile', 'Dockerfile', 'docker/api.Dockerfile', 'Dockerfile.dev',
    'requirements-dev.txt', 'svc/pyproject.toml', '.github/workflows/ci.yml',
    '.github/workflows/nested/x.yml', 'README.md', 'bun.lock',
  ];
  assert.deepEqual(manifestPaths(paths, ['node_modules/', 'examples/']), [
    'package.json', 'package-lock.json', 'apps/web/package.json', 'Dockerfile', 'docker/api.Dockerfile',
    'Dockerfile.dev', 'requirements-dev.txt', 'svc/pyproject.toml', '.github/workflows/ci.yml', 'bun.lock',
  ]);
});

test('readManifests routes files, uses the nearest lockfile and isolates broken files', () => {
  const files = new Map([
    ['package-lock.json', JSON.stringify({
      packages: { 'node_modules/express': { version: '4.21.2' }, 'apps/web/node_modules/react': { version: '19.0.0' } },
    })],
    ['package.json', JSON.stringify({ dependencies: { express: '^4.19.0' } })],
    ['apps/web/package.json', JSON.stringify({ dependencies: { react: '^19.0.0' } })],
    ['apps/bad/package.json', '{ not json'],
    ['Dockerfile', 'FROM node:24-alpine'],
    ['.github/workflows/requirements.yml', '      - uses: actions/checkout@v4'],
    ['requirements.txt', 'django==5.1.2'],
  ]);
  const { found, errors } = readManifests(files);
  assert.deepEqual(found.map((f) => `${f.file} ${f.ecosystem} ${f.name}@${f.version}`), [
    'package.json npm express@4.21.2',
    'apps/web/package.json npm react@19.0.0',
    'Dockerfile docker node:#-alpine@24',
    '.github/workflows/requirements.yml actions actions/checkout@v4',
    'requirements.txt pypi django@5.1.2',
  ]);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /^apps\/bad\/package\.json: /);
});
