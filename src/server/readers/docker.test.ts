import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseImageRef, readDockerfile } from './docker.ts';

test('reads FROM lines, skipping stages, scratch and ARG images', () => {
  const text = `ARG BASE=node:24
FROM --platform=$BUILDPLATFORM golang:1.26.8-alpine AS build
FROM node:24-alpine AS web
from build AS again
FROM web
FROM \${BASE}
FROM scratch
FROM docker.io/library/python:3.13-alpine@sha256:79e7a9b9ff1cbceff819f856fb374477792a5967759d94df266de7b7b4120e6f
`;
  assert.deepEqual(readDockerfile(text), [
    { ecosystem: 'docker', name: 'golang:#.#.#-alpine', version: '1.26.8', pin: 'exact' },
    { ecosystem: 'docker', name: 'node:#-alpine', version: '24', pin: 'exact' },
    { ecosystem: 'docker', name: 'python:#.#-alpine', version: '3.13', pin: 'digest' },
  ]);
});

test('classifies floating tags and unsupported registries', () => {
  assert.deepEqual(parseImageRef('nginxinc/nginx-unprivileged:alpine'), {
    ecosystem: 'docker', name: 'nginxinc/nginx-unprivileged:alpine', version: 'alpine', pin: 'floating',
  });
  assert.deepEqual(parseImageRef('node'), { ecosystem: 'docker', name: 'node:latest', version: 'latest', pin: 'floating' });
  assert.deepEqual(parseImageRef('ghcr.io/astral-sh/uv:python3.12-bookworm-slim'), {
    ecosystem: 'docker', name: 'ghcr.io/astral-sh/uv:python3.12-bookworm-slim', version: 'python3.12-bookworm-slim', pin: 'unsupported',
  });
  assert.deepEqual(parseImageRef('localhost:5000/app:1.2.3'), {
    ecosystem: 'docker', name: 'localhost:5000/app:1.2.3', version: '1.2.3', pin: 'unsupported',
  });
  assert.deepEqual(parseImageRef('node:24.10.0-bookworm-slim'), {
    ecosystem: 'docker', name: 'node:#.#.#-bookworm-slim', version: '24.10.0', pin: 'exact',
  });
});
