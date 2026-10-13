import { posix } from 'node:path';
import type { Found, FoundIn } from './types.ts';
import { readWorkflow } from './readers/actions.ts';
import { readDockerfile } from './readers/docker.ts';
import { type Lockfile, readPackageJson } from './readers/npm.ts';
import { readPyproject, readRequirements } from './readers/pypi.ts';

const LOCKFILES: Record<string, Lockfile['kind']> = { 'package-lock.json': 'npm', 'bun.lock': 'bun' };
const WORKFLOW = /^\.github\/workflows\/[^/]+\.ya?ml$/;

function isManifest(path: string): boolean {
  const base = posix.basename(path);
  return (
    base === 'package.json' ||
    base in LOCKFILES ||
    /^requirements.*\.txt$/.test(base) ||
    base === 'pyproject.toml' ||
    WORKFLOW.test(path) ||
    /^Dockerfile(\..+)?$/.test(base) ||
    /\.dockerfile$/i.test(base)
  );
}

export function manifestPaths(paths: string[], ignore: string[]): string[] {
  return paths.filter((p) => isManifest(p) && !ignore.some((i) => `/${p}`.includes(`/${i}`)));
}

function nearestLock(files: Map<string, string>, dir: string): [Lockfile | null, string] {
  for (let d = dir; ; d = posix.dirname(d)) {
    for (const [file, kind] of Object.entries(LOCKFILES)) {
      const text = files.get(posix.join(d, file));
      if (text !== undefined) return [{ kind, text }, posix.relative(d, dir)];
    }
    if (d === '.' || d === '/') return [null, ''];
  }
}

function readOne(file: string, text: string, files: Map<string, string>): Found[] {
  const base = posix.basename(file);
  if (WORKFLOW.test(file)) return readWorkflow(text);
  if (base === 'package.json') return readPackageJson(text, ...nearestLock(files, posix.dirname(file)));
  if (base === 'pyproject.toml') return readPyproject(text);
  if (base.startsWith('requirements')) return readRequirements(text);
  return readDockerfile(text);
}

export function readManifests(files: Map<string, string>): { found: FoundIn[]; errors: string[] } {
  const found: FoundIn[] = [];
  const errors: string[] = [];
  for (const [file, text] of files) {
    if (posix.basename(file) in LOCKFILES) continue;
    try {
      for (const f of readOne(file, text, files)) found.push({ ...f, file });
    } catch (e) {
      errors.push(`${file}: ${(e as Error).message}`);
    }
  }
  return { found, errors };
}
