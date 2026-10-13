import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readWorkflow } from './actions.ts';

test('reads action refs and classifies tags, SHAs and branches', () => {
  const text = `jobs:
  test:
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4.1.0
        with: { node-version: 24 }
      - uses: "docker/build-push-action@0123456789abcdef0123456789abcdef01234567" # v6.9.0
      - uses: ./.github/actions/local
      - uses: docker://alpine:3.20
      - uses: org/tool/sub/path@main
  call:
    uses: org/shared/.github/workflows/build.yml@v2
`;
  assert.deepEqual(readWorkflow(text), [
    { ecosystem: 'actions', name: 'actions/checkout', version: 'v4', pin: 'exact' },
    { ecosystem: 'actions', name: 'actions/setup-node', version: 'v4.1.0', pin: 'exact' },
    { ecosystem: 'actions', name: 'docker/build-push-action', version: '0123456789abcdef0123456789abcdef01234567', pin: 'sha' },
    { ecosystem: 'actions', name: 'org/tool', version: 'main', pin: 'floating' },
    { ecosystem: 'actions', name: 'org/shared', version: 'v2', pin: 'exact' },
  ]);
});
