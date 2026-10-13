import { type FetchFn, getJson, getText } from '../http.ts';
import type { Release } from '../types.ts';

export interface RepoInfo {
  fullName: string;
  owner: string;
  defaultBranch: string;
  archived: boolean;
}

interface ApiRepo { full_name: string; owner: { login: string }; default_branch: string; archived: boolean }
interface ApiRelease { tag_name: string; draft: boolean; prerelease: boolean; published_at: string | null; html_url: string; body: string | null }

const API = 'https://api.github.com';

export function githubClient(f: FetchFn, token: string) {
  const headers = {
    authorization: `Bearer ${token}`,
    accept: 'application/vnd.github+json',
    'x-github-api-version': '2022-11-28',
    'user-agent': 'version-watcher',
  };
  const encodePath = (path: string) => path.split('/').map(encodeURIComponent).join('/');

  return {
    async listRepos(): Promise<RepoInfo[]> {
      const out: RepoInfo[] = [];
      for (let page = 1; ; page++) {
        const url = `${API}/user/repos?affiliation=owner,collaborator,organization_member&per_page=100&page=${page}`;
        const batch = await getJson<ApiRepo[]>(f, url, headers);
        for (const r of batch) {
          out.push({ fullName: r.full_name, owner: r.owner.login, defaultBranch: r.default_branch, archived: r.archived });
        }
        if (batch.length < 100) return out;
      }
    },

    async tree(repo: RepoInfo): Promise<string[]> {
      const url = `${API}/repos/${repo.fullName}/git/trees/${encodeURIComponent(repo.defaultBranch)}?recursive=1`;
      const t = await getJson<{ tree: { path: string; type: string }[] }>(f, url, headers);
      return t.tree.filter((e) => e.type === 'blob').map((e) => e.path);
    },

    file(repo: RepoInfo, path: string): Promise<string> {
      const url = `${API}/repos/${repo.fullName}/contents/${encodePath(path)}?ref=${encodeURIComponent(repo.defaultBranch)}`;
      return getText(f, url, { ...headers, accept: 'application/vnd.github.raw+json' });
    },

    async releases(name: string): Promise<Release[]> {
      const rels = await getJson<ApiRelease[]>(f, `${API}/repos/${name}/releases?per_page=100`, headers);
      const stable = rels
        .filter((r) => !r.draft && !r.prerelease)
        .map((r) => ({ version: r.tag_name, publishedAt: r.published_at, url: r.html_url, notes: r.body || null }));
      if (stable.length) return stable;
      const tags = await getJson<{ name: string }[]>(f, `${API}/repos/${name}/tags?per_page=100`, headers);
      return tags.map((t) => ({
        version: t.name,
        publishedAt: null,
        url: `https://github.com/${name}/releases/tag/${encodeURIComponent(t.name)}`,
        notes: null,
      }));
    },
  };
}

export type GitHub = ReturnType<typeof githubClient>;
