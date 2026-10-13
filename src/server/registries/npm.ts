import { type FetchFn, getJson } from '../http.ts';
import type { Release } from '../types.ts';

interface Packument {
  versions?: Record<string, unknown>;
  time?: Record<string, string>;
  repository?: string | { url?: string };
}

export function githubRepoUrl(url: string | undefined): string | null {
  const m = url ? /github\.com[/:]([\w.-]+\/[\w.-]+?)(?:\.git)?(?:[#/].*)?$/.exec(url) : null;
  return m ? `https://github.com/${m[1]}` : null;
}

export async function npmReleases(f: FetchFn, name: string): Promise<Release[]> {
  const doc = await getJson<Packument>(f, `https://registry.npmjs.org/${name.replace('/', '%2f')}`);
  const repo = githubRepoUrl(typeof doc.repository === 'string' ? doc.repository : doc.repository?.url);
  return Object.keys(doc.versions ?? {}).map((version) => ({
    version,
    publishedAt: doc.time?.[version] ?? null,
    url: repo ? `${repo}/releases` : `https://www.npmjs.com/package/${name}/v/${version}`,
    notes: null,
  }));
}
