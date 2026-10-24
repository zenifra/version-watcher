import { type FetchFn, getJson } from '../http.ts';
import type { Releases } from '../types.ts';
import { githubRepoName } from './github.ts';

interface PypiDoc {
  info?: { project_urls?: Record<string, string> | null };
  releases?: Record<string, { upload_time_iso_8601: string | null; yanked: boolean }[]>;
}

export async function pypiReleases(f: FetchFn, name: string): Promise<Releases> {
  const doc = await getJson<PypiDoc>(f, `https://pypi.org/pypi/${encodeURIComponent(name)}/json`);
  // project_urls is author-controlled: only accept http(s) links.
  const urls = Object.entries(doc.info?.project_urls ?? {});
  const link =
    urls.find(
      ([label, url]) => /changelog|release|changes|history/i.test(label) && /^https?:\/\//i.test(url),
    )?.[1] ?? `https://pypi.org/project/${name}/`;
  const releases = Object.entries(doc.releases ?? {})
    .filter(([, files]) => files.some((file) => !file.yanked))
    .map(([version, files]) => ({ version, publishedAt: files[0].upload_time_iso_8601, url: link, notes: null }));
  const notesRepo = urls.map(([, url]) => githubRepoName(url)).find(Boolean) ?? null;
  return { releases, notesRepo };
}
