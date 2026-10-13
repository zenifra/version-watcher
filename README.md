# Version Watcher

A self-hosted dashboard that finds what your GitHub repositories depend on and tells you, every day, what is behind — by patch, minor or major — with the release notes next to it.

It reads the manifests straight from GitHub, so there is nothing to install in your repositories and no list to maintain. Infrastructure that does not live in a manifest (Kubernetes, Longhorn, Rancher…) can be added by hand.

## What it watches

| Ecosystem | Read from | New versions from |
|---|---|---|
| npm / Bun | `package.json` (`dependencies` + `devDependencies`), versions resolved from `package-lock.json` or `bun.lock` | npm registry |
| PyPI | `requirements*.txt`, `pyproject.toml` (`[project].dependencies`) | PyPI |
| GitHub Actions | `uses:` in `.github/workflows/*.yml` | GitHub releases (tags as a fallback) |
| Docker base images | `FROM` lines in `Dockerfile*` | Docker Hub tags |
| Infra | Manual entries, e.g. `kubernetes/kubernetes`, `longhorn/longhorn`, `rancher/rke2` | GitHub releases |

Every non-archived repository the token can see is scanned (optionally limited to some owners). A check runs on start-up when the last one is older than the interval, then on that interval, and whenever you press **Check now**.

## Quick start

```bash
docker build -t version-watcher .
docker run -d -p 3000:3000 -v version-watcher-data:/data \
  -e GITHUB_TOKEN=github_pat_... \
  -e GITHUB_OWNERS=my-org \
  -e AUTH_PASSWORD=change-me \
  version-watcher
```

Open http://localhost:3000 and sign in with `AUTH_PASSWORD`. Without Docker: `npm ci && npm run build && npm start` (Node.js 24+).

## Configuration

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | The only port the app listens on (API and UI). |
| `GITHUB_TOKEN` | — (required) | Read-only token, see below. |
| `GITHUB_OWNERS` | empty = all | Comma-separated orgs/users to scan. |
| `AUTH_PASSWORD` | — | Password for the dashboard. |
| `AUTH_DISABLED` | `false` | `true` turns the login off. Only for private networks: the dashboard lists dependencies of private repositories. |
| `DATA_DIR` | `./data` | Where the SQLite database lives. Must be writable and persistent. |
| `CHECK_INTERVAL_HOURS` | `24` | Hours between checks (max 576). |
| `IGNORE_PATHS` | `node_modules/,test/fixtures/,examples/` | Path fragments to skip inside repositories. |

The app refuses to start without `GITHUB_TOKEN`, without `AUTH_PASSWORD` (unless `AUTH_DISABLED=true`), or when `DATA_DIR` is not writable.

## GitHub token

Create a [fine-grained personal access token](https://github.com/settings/personal-access-tokens/new):

- **Resource owner:** the organization (or user) to scan
- **Repository access:** All repositories
- **Permissions:** *Contents* → Read-only, *Metadata* → Read-only

A fine-grained token covers a single owner. To watch several owners, run one instance per owner or use a classic token with the `repo` scope (which grants more than read access).

## How versions are compared

- Only stable versions count: `1`, `1.2` or `1.2.3`, with an optional `v` prefix and `+build` suffix. Prereleases (`-rc.1`, `2.0b1`, `.dev`) are ignored.
- The version in use sets the precision. `actions/checkout@v4` and `node:24-alpine` follow a major line, so only a new major (`v5`, `node:26-alpine`) is reported; `express 4.19.2` is behind on `4.19.3`.
- Docker tags are compared only with tags of the same variant (`-alpine`, `-bookworm-slim`). A variant with a version inside it (`alpine3.22`) does not see the next one (`alpine3.23`).
- Actions pinned to a commit SHA, floating tags (`latest`, `alpine`) and images outside Docker Hub are listed but not compared.
- Ranges without a lockfile use their lowest version (`^4.19.2` → `4.19.2`).

## Deploy on Zenifra

1. Create an **HTTP project** from this GitHub repository.
2. Runtime **Node.js 24**, build command `npm run build`, start command `npm start`.
3. Port `3000`, health check path `/api/health`.
4. Enable **persistent storage** mounted at `/data` and set `DATA_DIR=/data`.
5. Add the environment variables `GITHUB_TOKEN`, `GITHUB_OWNERS` and `AUTH_PASSWORD`.

## Development

```bash
npm ci
npm run dev        # API on :3000, restarts on change (needs the env vars above)
npm run dev:web    # Vite dev server with /api proxied to :3000
npm test
npm run typecheck
```

The server is plain TypeScript run by Node's type stripping; there is no server build step.

## Limitations

- One instance per database (SQLite).
- Docker Hub is the only image registry supported.
- No Poetry/uv lockfiles, Helm charts or notifications yet.

## License

[MIT](LICENSE)
