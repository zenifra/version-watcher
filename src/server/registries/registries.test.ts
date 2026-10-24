import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stubFetch } from '../test-helpers.ts';
import { dockerHubReleases } from './dockerhub.ts';
import { githubClient, githubRepoName } from './github.ts';
import { npmReleases } from './npm.ts';
import { pypiReleases } from './pypi.ts';

const repo = (i: number) => ({ full_name: `acme/r${i}`, owner: { login: 'acme' }, default_branch: 'main', archived: false });
const REPOS = 'https://api.github.com/user/repos?affiliation=owner,collaborator,organization_member&per_page=100';

test('github: paginates repos, lists blobs, reads raw files', async () => {
  const gh = githubClient(stubFetch({
    [`${REPOS}&page=1`]: Array.from({ length: 100 }, (_, i) => repo(i)),
    [`${REPOS}&page=2`]: [repo(100)],
    'https://api.github.com/repos/acme/r1/git/trees/main': { tree: [{ path: 'a/package.json', type: 'blob' }, { path: 'a', type: 'tree' }] },
    'https://api.github.com/repos/acme/r1/contents/my%20dir/Dockerfile': 'FROM node:24',
  }), 't');
  const repos = await gh.listRepos();
  assert.equal(repos.length, 101);
  assert.deepEqual(repos[1], { fullName: 'acme/r1', owner: 'acme', defaultBranch: 'main', archived: false });
  assert.deepEqual(await gh.tree(repos[1]), ['a/package.json']);
  assert.equal(await gh.file(repos[1], 'my dir/Dockerfile'), 'FROM node:24');
});

test('github: stable releases, falling back to tags', async () => {
  const gh = githubClient(stubFetch({
    'https://api.github.com/repos/longhorn/longhorn/releases': [
      { tag_name: 'v1.8.0', draft: false, prerelease: false, published_at: '2026-01-01T00:00:00Z', html_url: 'https://github.com/longhorn/longhorn/releases/tag/v1.8.0', body: 'notes' },
      { tag_name: 'v1.9.0-rc1', draft: false, prerelease: true, published_at: null, html_url: 'x', body: '' },
    ],
    'https://api.github.com/repos/acme/tool/releases': [],
    'https://api.github.com/repos/acme/tool/tags': [{ name: 'v2.0.0' }],
  }), 't');
  assert.deepEqual(await gh.releases('longhorn/longhorn'), [
    { version: 'v1.8.0', publishedAt: '2026-01-01T00:00:00Z', url: 'https://github.com/longhorn/longhorn/releases/tag/v1.8.0', notes: 'notes' },
  ]);
  assert.deepEqual(await gh.releases('acme/tool'), [
    { version: 'v2.0.0', publishedAt: null, url: 'https://github.com/acme/tool/releases/tag/v2.0.0', notes: null },
  ]);
});

test('npm: scoped names, publish times and GitHub release links', async () => {
  const f = stubFetch({
    'https://registry.npmjs.org/@types%2fnode': {
      versions: { '24.0.0': {}, '24.1.0': {} },
      time: { '24.0.0': '2026-01-01T00:00:00Z', '24.1.0': '2026-02-01T00:00:00Z' },
      repository: { url: 'git+https://github.com/DefinitelyTyped/DefinitelyTyped.git' },
    },
    'https://registry.npmjs.org/plain': { versions: { '1.0.0': {} }, time: {} },
  });
  assert.deepEqual(await npmReleases(f, '@types/node'), {
    notesRepo: 'DefinitelyTyped/DefinitelyTyped',
    releases: [
      { version: '24.0.0', publishedAt: '2026-01-01T00:00:00Z', url: 'https://github.com/DefinitelyTyped/DefinitelyTyped/releases', notes: null },
      { version: '24.1.0', publishedAt: '2026-02-01T00:00:00Z', url: 'https://github.com/DefinitelyTyped/DefinitelyTyped/releases', notes: null },
    ],
  });
  const plain = await npmReleases(f, 'plain');
  assert.equal(plain.notesRepo, null);
  assert.equal(plain.releases[0].url, 'https://www.npmjs.com/package/plain/v/1.0.0');
});

test('pypi: skips yanked/empty releases and only links http(s) changelogs', async () => {
  const f = stubFetch({
    'https://pypi.org/pypi/django/json': {
      info: { project_urls: { Changelog: 'https://docs.djangoproject.com/en/stable/releases/', Source: 'https://github.com/django/django' } },
      releases: {
        '5.1.2': [{ upload_time_iso_8601: '2026-01-01T00:00:00Z', yanked: false }],
        '5.1.1': [{ upload_time_iso_8601: '2025-12-01T00:00:00Z', yanked: true }],
        '5.0.0': [],
      },
    },
    'https://pypi.org/pypi/evil/json': {
      info: { project_urls: { Changelog: 'javascript:alert(1)' } },
      releases: { '1.0.0': [{ upload_time_iso_8601: null, yanked: false }] },
    },
  });
  assert.deepEqual(await pypiReleases(f, 'django'), {
    notesRepo: 'django/django',
    releases: [{ version: '5.1.2', publishedAt: '2026-01-01T00:00:00Z', url: 'https://docs.djangoproject.com/en/stable/releases/', notes: null }],
  });
  const evil = await pypiReleases(f, 'evil');
  assert.equal(evil.notesRepo, null);
  assert.equal(evil.releases[0].url, 'https://pypi.org/project/evil/');
});

test('docker hub: same variant and precision only, follows pagination', async () => {
  const f = stubFetch({
    'https://hub.docker.com/v2/repositories/library/node/tags?page_size=100&ordering=last_updated&name=alpine': {
      next: 'https://hub.docker.com/v2/repositories/library/node/tags?page=2',
      results: [
        { name: '26-alpine', last_updated: '2026-10-01T00:00:00Z' },
        { name: '26.1.0-alpine', last_updated: '2026-10-01T00:00:00Z' },
        { name: '26-alpine3.22', last_updated: '2026-10-01T00:00:00Z' },
      ],
    },
    'https://hub.docker.com/v2/repositories/library/node/tags?page=2': {
      next: null,
      results: [{ name: '25-alpine', last_updated: '2026-04-01T00:00:00Z' }],
    },
  });
  assert.deepEqual(await dockerHubReleases(f, 'node:#-alpine'), {
    notesRepo: 'nodejs/node',
    releases: [
      { version: '26', publishedAt: '2026-10-01T00:00:00Z', url: 'https://hub.docker.com/_/node/tags?name=alpine', notes: null },
      { version: '25', publishedAt: '2026-04-01T00:00:00Z', url: 'https://hub.docker.com/_/node/tags?name=alpine', notes: null },
    ],
  });
});

test('githubRepoName: owner/name from repository URLs', () => {
  assert.equal(githubRepoName('git+https://github.com/expressjs/express.git'), 'expressjs/express');
  assert.equal(githubRepoName('git@github.com:acme/tool.git'), 'acme/tool');
  assert.equal(githubRepoName('https://github.com/acme/mono/tree/main/packages/a'), 'acme/mono');
  assert.equal(githubRepoName('https://gitlab.com/acme/tool'), null);
  assert.equal(githubRepoName(undefined), null);
});
