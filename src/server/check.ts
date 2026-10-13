import type { DatabaseSync } from 'node:sqlite';
import type { Config } from './config.ts';
import {
  finishRun, packagesToCheck, pruneRepos, replaceRepoUsages, saveReleases, setRepoStatus, startRun,
} from './db.ts';
import { type FetchFn, HttpError, RateLimitError } from './http.ts';
import { dockerHubReleases } from './registries/dockerhub.ts';
import { type GitHub, githubClient, type RepoInfo } from './registries/github.ts';
import { npmReleases } from './registries/npm.ts';
import { pypiReleases } from './registries/pypi.ts';
import { manifestPaths, readManifests } from './scan.ts';
import type { Ecosystem, Release } from './types.ts';
import { compareVersions, parseVersion } from './version.ts';

export interface CheckDeps {
  db: DatabaseSync;
  config: Config;
  fetch: FetchFn;
  now?: () => Date;
}

export interface Checker {
  readonly running: boolean;
  start(): boolean;
  idle(): Promise<void>;
}

const MAX_RELEASES = 100;

function fetchReleases(pkg: { ecosystem: Ecosystem; name: string }, gh: GitHub, f: FetchFn): Promise<Release[]> {
  switch (pkg.ecosystem) {
    case 'npm': return npmReleases(f, pkg.name);
    case 'pypi': return pypiReleases(f, pkg.name);
    case 'docker': return dockerHubReleases(f, pkg.name);
    case 'actions':
    case 'infra': return gh.releases(pkg.name);
  }
}

async function scanRepo(deps: CheckDeps, gh: GitHub, repo: RepoInfo, at: string): Promise<string[]> {
  const { db, config } = deps;
  const files = new Map<string, string>();
  for (const path of manifestPaths(await gh.tree(repo), config.ignorePaths)) {
    files.set(path, await gh.file(repo, path));
  }
  const { found, errors } = readManifests(files);
  replaceRepoUsages(db, repo.fullName, found);
  const status = errors.length ? 'error' : found.length ? 'ok' : 'no-manifest';
  setRepoStatus(db, repo.fullName, status, errors.join('\n') || null, at);
  return errors.map((e) => `${repo.fullName}/${e}`);
}

export async function runCheck(deps: CheckDeps): Promise<void> {
  const { db, config, fetch: f, now = () => new Date() } = deps;
  const at = () => now().toISOString();
  const runId = startRun(db, at());
  const errors: string[] = [];
  let checked = 0;
  try {
    const gh = githubClient(f, config.githubToken);
    const repos = (await gh.listRepos()).filter(
      (r) => !r.archived && (!config.owners.length || config.owners.includes(r.owner.toLowerCase())),
    );
    for (const repo of repos) {
      try {
        errors.push(...(await scanRepo(deps, gh, repo, at())));
      } catch (e) {
        if (e instanceof RateLimitError) throw e;
        if (e instanceof HttpError && e.status === 409) {
          // GitHub answers 409 for the tree of an empty repository.
          replaceRepoUsages(db, repo.fullName, []);
          setRepoStatus(db, repo.fullName, 'no-manifest', null, at());
          continue;
        }
        setRepoStatus(db, repo.fullName, 'error', (e as Error).message, at());
        errors.push(`${repo.fullName}: ${(e as Error).message}`);
      }
    }
    pruneRepos(db, repos.map((r) => r.fullName));

    // NOTE: sequential on purpose; a daily run of a few hundred packages takes minutes.
    for (const pkg of packagesToCheck(db)) {
      try {
        const releases = (await fetchReleases(pkg, gh, f))
          .filter((r) => parseVersion(r.version) && compareVersions(r.version, pkg.minVersion) > 0)
          .sort((a, b) => compareVersions(b.version, a.version))
          .slice(0, MAX_RELEASES);
        saveReleases(db, pkg.id, releases);
        checked++;
      } catch (e) {
        if (e instanceof RateLimitError) throw e;
        errors.push(`${pkg.ecosystem} ${pkg.name}: ${(e as Error).message}`);
      }
    }
  } catch (e) {
    errors.push((e as Error).message);
  } finally {
    finishRun(db, runId, at(), checked, errors);
    console.log(`check finished: ${checked} packages checked, ${errors.length} errors`);
  }
}

export function createChecker(deps: CheckDeps): Checker {
  let current: Promise<void> | null = null;
  return {
    get running() {
      return current !== null;
    },
    start() {
      if (current) return false;
      current = runCheck(deps)
        .catch((e) => console.error('check failed:', (e as Error).message))
        .finally(() => {
          current = null;
        });
      return true;
    },
    async idle() {
      await current;
    },
  };
}

// First check when the interval since the last one runs out (immediately if never),
// then every interval. A restart therefore never pushes a due check further away.
export function scheduleChecks(checker: Checker, lastFinishedAt: string | null, intervalMs: number, now = Date.now()): void {
  const wait = lastFinishedAt ? Math.max(0, Date.parse(lastFinishedAt) + intervalMs - now) : 0;
  setTimeout(() => {
    checker.start();
    setInterval(() => checker.start(), intervalMs);
  }, wait);
}
