import { fileURLToPath } from 'node:url';
import { createApp } from './app.ts';
import { createChecker } from './check.ts';
import { type Config, ConfigError, loadConfig } from './config.ts';
import { lastFinishedAt, openDb } from './db.ts';

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

let config: Config;
try {
  config = loadConfig(process.env);
} catch (e) {
  if (e instanceof ConfigError) fail(`config error: ${e.message}`);
  throw e;
}

let db: ReturnType<typeof openDb>;
try {
  db = openDb(config.dataDir);
} catch (e) {
  fail(`cannot use DATA_DIR "${config.dataDir}": ${(e as Error).message}`);
}

const checker = createChecker({ db, config, fetch });
const webDir = fileURLToPath(new URL('../../dist/web', import.meta.url));
createApp({ db, config, checker, webDir }).listen(config.port, () => {
  console.log(`version-watcher listening on port ${config.port}`);
});

const intervalMs = config.intervalHours * 3600 * 1000;
const last = lastFinishedAt(db);
if (!last || Date.now() - Date.parse(last) >= intervalMs) checker.start();
setInterval(() => checker.start(), intervalMs);
