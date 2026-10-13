import { test } from 'node:test';
import assert from 'node:assert/strict';
import { issueSession, passwordMatches, readCookie, sessionValid } from './auth.ts';

const DAY = 24 * 3600 * 1000;

test('password check', () => {
  assert.equal(passwordMatches('s3cret', 's3cret'), true);
  assert.equal(passwordMatches('s3cre', 's3cret'), false);
  assert.equal(passwordMatches(undefined, 's3cret'), false);
});

test('sessions: valid, tampered, expired, rotated password', () => {
  const now = Date.parse('2026-10-13T00:00:00Z');
  const s = issueSession('pw', now);
  assert.equal(sessionValid('pw', s, now + DAY), true);
  assert.equal(sessionValid('pw', s.replace(/.$/, (c) => (c === 'A' ? 'B' : 'A')), now), false);
  assert.equal(sessionValid('pw', `${now + 1}.${s.split('.')[1]}`, now), false);
  assert.equal(sessionValid('pw', s, now + 31 * DAY), false);
  assert.equal(sessionValid('new-pw', s, now), false);
  assert.equal(sessionValid('pw', undefined, now), false);
  assert.equal(sessionValid('pw', 'garbage', now), false);
});

test('readCookie', () => {
  assert.equal(readCookie('a=1; session=abc.def; b=2', 'session'), 'abc.def');
  assert.equal(readCookie(undefined, 'session'), undefined);
});
