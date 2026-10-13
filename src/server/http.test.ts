import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getJson, HttpError, RateLimitError } from './http.ts';
import { stubFetch } from './test-helpers.ts';

const f = stubFetch({
  'https://api.github.com/limited': new Response('', { status: 403, headers: { 'x-ratelimit-remaining': '0' } }),
  'https://api.github.com/too-many': new Response('', { status: 429 }),
  'https://hub.docker.com/too-many': new Response('', { status: 429 }),
  'https://x.test/forbidden': new Response('', { status: 403 }),
  'https://x.test/ok': { a: 1 },
});

test('rate limits become RateLimitError, other failures HttpError', async () => {
  await assert.rejects(getJson(f, 'https://api.github.com/limited'), RateLimitError);
  await assert.rejects(getJson(f, 'https://api.github.com/too-many'), RateLimitError);
  await assert.rejects(getJson(f, 'https://x.test/forbidden'), (e) => e instanceof HttpError && e.status === 403);
  await assert.rejects(getJson(f, 'https://x.test/missing'), (e) => e instanceof HttpError && e.status === 404);
  assert.deepEqual(await getJson(f, 'https://x.test/ok'), { a: 1 });
});

test('a 429 from a registry only fails that request', async () => {
  await assert.rejects(getJson(f, 'https://hub.docker.com/too-many'), (e) => e instanceof HttpError && e.status === 429);
});
