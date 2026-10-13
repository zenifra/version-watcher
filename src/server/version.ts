import type { Bump } from './types.ts';

const VERSION = /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:\+.*)?$/i;
const BUMPS: Bump[] = ['major', 'minor', 'patch'];

// Stable versions only: 1 to 3 numeric parts, optional "v" and "+build".
// Anything else (1.0.0-rc.1, 2.0b1, 1.0.post1, main) is not comparable.
export function parseVersion(version: string): number[] | null {
  const m = VERSION.exec(version.trim());
  return m ? m.slice(1).filter((p): p is string => p !== undefined).map(Number) : null;
}

export function compareVersions(a: string, b: string): number {
  const x = parseVersion(a);
  const y = parseVersion(b);
  if (!x || !y) return Number(!x) - Number(!y);
  for (let i = 0; i < 3; i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d) return d;
  }
  return 0;
}

// Compares only as many parts as the version in use has: "v4" (a floating
// major tag) is only behind on v5+, while "4.19.2" is behind on 4.19.3.
export function bumpOf(used: string, candidate: string): Bump | null {
  const u = parseVersion(used);
  const c = parseVersion(candidate);
  if (!u || !c) return null;
  for (let i = 0; i < u.length; i++) {
    const d = (c[i] ?? 0) - u[i];
    if (d > 0) return BUMPS[i];
    if (d < 0) return null;
  }
  return null;
}

export function minFromRange(range: string): string | null {
  const m = /(\d+)(?:\.(\d+|[x*]))?(?:\.(\d+|[x*]))?/i.exec(range);
  if (!m) return null;
  const parts = [m[1]];
  for (const p of [m[2], m[3]]) {
    if (p === undefined || !/^\d+$/.test(p)) break;
    parts.push(p);
  }
  return parts.join('.');
}
