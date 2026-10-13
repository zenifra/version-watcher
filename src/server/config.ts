export interface Config {
  port: number;
  githubToken: string;
  owners: string[];
  authPassword: string | null;
  authDisabled: boolean;
  dataDir: string;
  intervalHours: number;
  ignorePaths: string[];
}

export class ConfigError extends Error {}

// setInterval cannot wait longer than ~24.8 days.
const MAX_INTERVAL_HOURS = 576;

export function loadConfig(env: NodeJS.ProcessEnv): Config {
  const num = (key: string, fallback: number, max = Infinity) => {
    const raw = env[key]?.trim();
    if (!raw) return fallback;
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0 || n > max) throw new ConfigError(`${key} must be a number between 0 and ${max}`);
    return n;
  };
  const list = (raw: string | undefined) => (raw ?? '').split(',').map((s) => s.trim()).filter(Boolean);

  const githubToken = env.GITHUB_TOKEN?.trim();
  if (!githubToken) throw new ConfigError('GITHUB_TOKEN is required');
  const authPassword = env.AUTH_PASSWORD || null;
  const authDisabled = env.AUTH_DISABLED === 'true';
  if (!authPassword && !authDisabled) {
    throw new ConfigError('set AUTH_PASSWORD (or AUTH_DISABLED=true, only on private networks)');
  }
  return {
    port: num('PORT', 3000, 65535),
    githubToken,
    owners: list(env.GITHUB_OWNERS).map((o) => o.toLowerCase()),
    authPassword,
    authDisabled,
    dataDir: env.DATA_DIR?.trim() || './data',
    intervalHours: num('CHECK_INTERVAL_HOURS', 24, MAX_INTERVAL_HOURS),
    ignorePaths: env.IGNORE_PATHS === undefined ? ['node_modules/', 'test/fixtures/', 'examples/'] : list(env.IGNORE_PATHS),
  };
}
