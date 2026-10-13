import type { Found } from '../types.ts';
import { minFromRange } from '../version.ts';

export interface Lockfile {
  kind: 'npm' | 'bun';
  text: string;
}

// Specs that do not point at a registry version: workspace:, file:, git+https:,
// npm: aliases, local paths and GitHub "user/repo" shorthands.
const NOT_REGISTRY = /^[a-z+]+:|^(\.|~\/|\/)|\//i;

export function readPackageJson(text: string, lock: Lockfile | null, relDir = ''): Found[] {
  const pkg = JSON.parse(text) as {
    dependencies?: Record<string, unknown>;
    devDependencies?: Record<string, unknown>;
  };
  const locked = lock ? lockedVersion(lock) : () => undefined;
  const out: Found[] = [];
  for (const [name, spec] of Object.entries({ ...pkg.devDependencies, ...pkg.dependencies })) {
    if (typeof spec !== 'string' || NOT_REGISTRY.test(spec)) continue;
    const resolved = locked(name, relDir);
    const min = minFromRange(spec);
    if (resolved) out.push({ ecosystem: 'npm', name, version: resolved, pin: 'exact' });
    else if (min) out.push({ ecosystem: 'npm', name, version: min, pin: 'range' });
    else out.push({ ecosystem: 'npm', name, version: spec, pin: 'floating' });
  }
  return out;
}

function lockedVersion(lock: Lockfile): (name: string, relDir: string) => string | undefined {
  if (lock.kind === 'npm') {
    const j = JSON.parse(lock.text) as {
      packages?: Record<string, { version?: string }>;
      dependencies?: Record<string, { version?: string }>;
    };
    return (name, relDir) =>
      (relDir ? j.packages?.[`${relDir}/node_modules/${name}`]?.version : undefined) ??
      j.packages?.[`node_modules/${name}`]?.version ??
      j.dependencies?.[name]?.version;
  }
  // bun.lock is JSON with trailing commas; entries look like "name": ["name@1.2.3", ...].
  const j = JSON.parse(lock.text.replace(/,(\s*[}\]])/g, '$1')) as { packages?: Record<string, unknown[]> };
  return (name) => {
    const id = j.packages?.[name]?.[0];
    return typeof id === 'string' ? id.slice(id.lastIndexOf('@') + 1) : undefined;
  };
}
