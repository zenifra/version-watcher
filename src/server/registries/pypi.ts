import { type FetchFn, getJson } from '../http.ts';
import type { Release } from '../types.ts';

interface PypiDoc {
  info?: { project_urls?: Record<string, string> | null };
  releases?: Record<string, { upload_time_iso_8601: string | null; yanked: boolean }[]>;
}

export async function pypiReleases(f: FetchFn, name: string): Promise<Release[]> {
  const doc = await getJson<PypiDoc>(f, `https://pypi.org/pypi/${encodeURIComponent(name)}/json`);
  // project_urls is author-controlled: only accept http(s) links.
  const link =
    Object.entries(doc.info?.project_urls ?? {}).find(
      ([label, url]) => /changelog|release|changes|history/i.test(label) && /^https?:\/\//i.test(url),
    )?.[1] ?? `https://pypi.org/project/${name}/`;
  return Object.entries(doc.releases ?? {})
    .filter(([, files]) => files.some((file) => !file.yanked))
    .map(([version, files]) => ({ version, publishedAt: files[0].upload_time_iso_8601, url: link, notes: null }));
}
