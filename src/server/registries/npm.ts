import { type FetchFn, getJson } from '../http.ts';
import type { Releases } from '../types.ts';
import { githubRepoName } from './github.ts';

interface Packument {
  versions?: Record<string, unknown>;
  time?: Record<string, string>;
  repository?: string | { url?: string };
}

export async function npmReleases(f: FetchFn, name: string): Promise<Releases> {
  const doc = await getJson<Packument>(f, `https://registry.npmjs.org/${name.replace('/', '%2f')}`);
  const notesRepo = githubRepoName(typeof doc.repository === 'string' ? doc.repository : doc.repository?.url);
  const releases = Object.keys(doc.versions ?? {}).map((version) => ({
    version,
    publishedAt: doc.time?.[version] ?? null,
    url: notesRepo ? `https://github.com/${notesRepo}/releases` : `https://www.npmjs.com/package/${name}/v/${version}`,
    notes: null,
  }));
  return { releases, notesRepo };
}
