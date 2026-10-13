import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import express, { type NextFunction, type Request, type Response } from 'express';
import { issueSession, passwordMatches, readCookie, sessionValid } from './auth.ts';
import type { Checker } from './check.ts';
import type { Config } from './config.ts';
import { deletePackage, ensurePackage, listRepos, listRuns, setCurrentVersion, setIgnored } from './db.ts';
import { listPackages, listUpdates, packageDetail } from './updates.ts';
import { parseVersion } from './version.ts';

export interface AppDeps {
  db: DatabaseSync;
  config: Config;
  checker: Checker;
  webDir: string;
  now?: () => number;
  loginDelayMs?: number;
}

const SESSION_MAX_AGE_MS = 30 * 24 * 3600 * 1000;
const isText = (v: unknown, max: number): v is string => typeof v === 'string' && v.trim().length > 0 && v.length <= max;
const isVersion = (v: unknown): v is string => isText(v, 50) && parseVersion(v) !== null;
const OWNER_REPO = /^[\w.-]+\/[\w.-]+$/;

export function createApp({ db, config, checker, webDir, now = Date.now, loginDelayMs = 1000 }: AppDeps) {
  const app = express();
  app.set('trust proxy', true);
  app.disable('x-powered-by');
  app.use(express.json({ limit: '10kb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });

  app.post('/api/login', async (req, res) => {
    if (config.authDisabled) {
      res.json({ ok: true });
      return;
    }
    if (!passwordMatches(req.body?.password, config.authPassword!)) {
      await new Promise((r) => setTimeout(r, loginDelayMs));
      res.status(401).json({ error: 'invalid password' });
      return;
    }
    res.cookie('session', issueSession(config.authPassword!, now()), {
      httpOnly: true, sameSite: 'lax', secure: req.secure, maxAge: SESSION_MAX_AGE_MS, path: '/',
    });
    res.json({ ok: true });
  });

  app.post('/api/logout', (_req, res) => {
    res.clearCookie('session', { path: '/' });
    res.json({ ok: true });
  });

  app.use('/api', (req, res, next) => {
    if (!config.authDisabled && !sessionValid(config.authPassword!, readCookie(req.headers.cookie, 'session'), now())) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
    if ((req.method === 'POST' || req.method === 'PATCH') && !req.is('application/json')) {
      res.status(415).json({ error: 'expected application/json' });
      return;
    }
    next();
  });

  app.get('/api/session', (_req, res) => {
    res.json({ ok: true, authDisabled: config.authDisabled });
  });

  app.get('/api/updates', (req, res) => {
    const s = (k: string) => (typeof req.query[k] === 'string' && req.query[k] ? (req.query[k] as string) : undefined);
    res.json(listUpdates(db, { ecosystem: s('ecosystem'), bump: s('bump'), repo: s('repo'), q: s('q'), all: req.query.all === '1' }));
  });

  app.get('/api/packages', (_req, res) => {
    res.json(listPackages(db));
  });

  app.get('/api/packages/:id', (req, res) => {
    const detail = packageDetail(db, Number(req.params.id));
    if (detail) res.json(detail);
    else res.status(404).json({ error: 'not found' });
  });

  app.post('/api/packages', (req, res) => {
    const { label, name, currentVersion } = req.body ?? {};
    if (!isText(label, 100) || typeof name !== 'string' || !OWNER_REPO.test(name) || !isVersion(currentVersion)) {
      res.status(400).json({ error: 'label (1-100 chars), name (owner/repo) and a numeric currentVersion are required' });
      return;
    }
    if (db.prepare("select 1 from packages where ecosystem = 'infra' and name = ?").get(name)) {
      res.status(409).json({ error: `${name} is already registered` });
      return;
    }
    const id = ensurePackage(db, { ecosystem: 'infra', name, label: label.trim(), source: 'manual', currentVersion: currentVersion.trim() });
    res.status(201).json({ id });
  });

  app.patch('/api/packages/:id', (req, res) => {
    const id = Number(req.params.id);
    const pkg = db.prepare('select source from packages where id = ?').get(id) as { source: string } | undefined;
    if (!pkg) {
      res.status(404).json({ error: 'not found' });
      return;
    }
    const { ignored, currentVersion } = req.body ?? {};
    if (ignored !== undefined && typeof ignored !== 'boolean') {
      res.status(400).json({ error: 'ignored must be a boolean' });
      return;
    }
    if (currentVersion !== undefined && (pkg.source !== 'manual' || !isVersion(currentVersion))) {
      res.status(400).json({ error: 'currentVersion must be numeric and only applies to manual entries' });
      return;
    }
    if (ignored !== undefined) setIgnored(db, id, ignored);
    if (currentVersion !== undefined) setCurrentVersion(db, id, currentVersion.trim());
    res.json(packageDetail(db, id));
  });

  app.delete('/api/packages/:id', (req, res) => {
    const id = Number(req.params.id);
    const pkg = db.prepare('select source from packages where id = ?').get(id) as { source: string } | undefined;
    if (!pkg || pkg.source !== 'manual') {
      res.status(404).json({ error: 'not found' });
      return;
    }
    deletePackage(db, id);
    res.status(204).end();
  });

  app.get('/api/repos', (_req, res) => {
    res.json(listRepos(db));
  });

  app.get('/api/runs', (_req, res) => {
    res.json({ running: checker.running, runs: listRuns(db, 30) });
  });

  app.post('/api/runs', (_req, res) => {
    if (checker.start()) res.status(202).json({ started: true });
    else res.status(409).json({ error: 'a check is already running' });
  });

  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'not found' });
  });

  app.use(express.static(webDir));
  app.get('/{*path}', (_req, res) => {
    res.sendFile(join(webDir, 'index.html'));
  });

  app.use((err: Error & { status?: number }, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status && err.status < 500 ? err.status : 500;
    if (status === 500) console.error(err);
    res.status(status).json({ error: status === 500 ? 'internal error' : err.message });
  });

  return app;
}
