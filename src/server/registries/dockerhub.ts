import { type FetchFn, getJson } from '../http.ts';
import type { Release } from '../types.ts';

interface TagPage {
  next: string | null;
  results: { name: string; last_updated: string | null }[];
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// name is "<image>:<pattern>" from readers/docker.ts, e.g. "node:#-alpine".
export async function dockerHubReleases(f: FetchFn, name: string): Promise<Release[]> {
  const colon = name.lastIndexOf(':');
  const image = name.slice(0, colon);
  const pattern = name.slice(colon + 1);
  const dash = pattern.indexOf('-');
  const variant = dash < 0 ? '' : pattern.slice(dash + 1);
  const precision = (dash < 0 ? pattern : pattern.slice(0, dash)).split('.').length;
  const tagRe = new RegExp(`^\\d+${'(?:\\.\\d+)'.repeat(precision - 1)}${variant ? `-${escape(variant)}` : ''}$`);
  const repo = image.includes('/') ? image : `library/${image}`;
  const page = image.includes('/') ? `https://hub.docker.com/r/${repo}/tags` : `https://hub.docker.com/_/${image}/tags`;
  const link = variant ? `${page}?name=${encodeURIComponent(variant)}` : page;

  const out: Release[] = [];
  let url: string | null =
    `https://hub.docker.com/v2/repositories/${repo}/tags?page_size=100&ordering=last_updated` +
    (variant ? `&name=${encodeURIComponent(variant)}` : '');
  for (let i = 0; i < 5 && url; i++) {
    const data: TagPage = await getJson<TagPage>(f, url);
    for (const tag of data.results) {
      if (!tagRe.test(tag.name)) continue;
      const version = variant ? tag.name.slice(0, -(variant.length + 1)) : tag.name;
      out.push({ version, publishedAt: tag.last_updated, url: link, notes: null });
    }
    url = data.next;
  }
  return out;
}
