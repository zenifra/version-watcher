import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bumpOf, compareVersions, minFromRange, parseVersion } from './version.ts';

test('parseVersion accepts v prefix, 1-3 parts and build metadata only', () => {
  assert.deepEqual(parseVersion('v1.34.10+rke2r1'), [1, 34, 10]);
  assert.deepEqual(parseVersion('24'), [24]);
  assert.deepEqual(parseVersion('4.19'), [4, 19]);
  assert.equal(parseVersion('1.0.0-beta.1'), null);
  assert.equal(parseVersion('2.0rc1'), null);
  assert.equal(parseVersion('1.0.post1'), null);
  assert.equal(parseVersion('main'), null);
});

test('bumpOf respects the precision of the version in use', () => {
  assert.equal(bumpOf('4.19.2', '4.19.3'), 'patch');
  assert.equal(bumpOf('4.19.2', '4.21.0'), 'minor');
  assert.equal(bumpOf('4.19.2', '5.0.0'), 'major');
  assert.equal(bumpOf('v4', 'v4.2.2'), null);
  assert.equal(bumpOf('v4', 'v5.0.0'), 'major');
  assert.equal(bumpOf('24.10', '24.11.0'), 'minor');
  assert.equal(bumpOf('1.2.3', '1.2.3'), null);
  assert.equal(bumpOf('1.2.3', '1.2.2'), null);
  assert.equal(bumpOf('v1.34.10+rke2r1', 'v1.34.11+rke2r1'), 'patch');
  assert.equal(bumpOf('1.2.3', 'nightly'), null);
});

test('compareVersions sorts numerically and puts unparseable last', () => {
  assert.deepEqual(['1.10.0', '1.2.0', 'x', '2'].sort(compareVersions), ['1.2.0', '1.10.0', '2', 'x']);
});

test('minFromRange takes the lowest concrete version', () => {
  assert.equal(minFromRange('^4.19.2'), '4.19.2');
  assert.equal(minFromRange('>=1.2 <2'), '1.2');
  assert.equal(minFromRange('~1.2.x'), '1.2');
  assert.equal(minFromRange('4.x'), '4');
  assert.equal(minFromRange('*'), null);
  assert.equal(minFromRange('latest'), null);
});
