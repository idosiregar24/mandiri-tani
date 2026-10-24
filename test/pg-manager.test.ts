// PgManager against the real portable binaries, on its own cluster (ports 5450+), covering
// sprint-1 C5–C8: initdb, stop/start, adopting an orphaned cluster, stale postmaster.pid,
// port fallback.
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PgManager, generatePassword } from '../src/main/pg/PgManager';
import { pgBinDir } from './paths';

const root = mkdtempSync(join(tmpdir(), 'mtpos-pgm-'));
const opts = {
  binDir: pgBinDir(),
  dataDir: join(root, 'pgdata'),
  logDir: join(root, 'logs'),
  port: 5450,
  maxPort: 5459,
  superuserPassword: generatePassword(),
  appUser: 'pos_app',
  appPassword: generatePassword(),
  database: 'mandiri_tani',
};
let manager: PgManager;

async function appQuery(port: number, sql: string) {
  const c = new pg.Client({ host: '127.0.0.1', port, user: opts.appUser, password: opts.appPassword, database: opts.database });
  await c.connect();
  try {
    return await c.query(sql);
  } finally {
    await c.end();
  }
}

beforeAll(async () => {
  manager = new PgManager(opts);
  await manager.initCluster();
});

afterAll(async () => {
  await manager?.stop(10).catch(() => undefined);
  rmSync(root, { recursive: true, force: true });
});

describe('PgManager', () => {
  it('initdb creates a running cluster with the app role, database, UTF8 and loopback-only config', async () => {
    expect(await manager.status()).toBe('running');
    const { rows } = await appQuery(
      manager.port,
      "SELECT current_user AS u, current_database() AS d, pg_encoding_to_char(encoding) AS enc, current_setting('listen_addresses') AS listen, current_setting('fsync') AS fsync FROM pg_database WHERE datname = current_database()",
    );
    expect(rows[0]).toEqual({ u: 'pos_app', d: 'mandiri_tani', enc: 'UTF8', listen: '127.0.0.1', fsync: 'on' });
    expect(readFileSync(join(opts.dataDir, 'pg_hba.conf'), 'utf8')).not.toMatch(/trust/);
  });

  it('rejects a wrong password (scram, no trust)', async () => {
    const c = new pg.Client({ host: '127.0.0.1', port: manager.port, user: 'pos_app', password: 'salah', database: 'mandiri_tani' });
    await expect(c.connect()).rejects.toThrow(/password/i);
  });

  it('stops and starts again, keeping committed data', async () => {
    await appQuery(manager.port, 'CREATE TABLE IF NOT EXISTS t_keep (v int); INSERT INTO t_keep VALUES (42);');
    await manager.stop();
    expect(await manager.status()).toBe('stopped');
    const r = await manager.start();
    expect(r.reused).toBe(false);
    const { rows } = await appQuery(manager.port, 'SELECT v FROM t_keep');
    expect(rows).toEqual([{ v: 42 }]);
  });

  it('adopts a cluster left running by a previous session instead of starting a second one', async () => {
    const nextSession = new PgManager(opts);
    const r = await nextSession.start();
    expect(r.reused).toBe(true);
    expect(nextSession.port).toBe(manager.port);
  });

  it('removes a stale postmaster.pid (e.g. after a power cut) and starts', async () => {
    await manager.stop();
    // Simulate a crash leftover: pid file pointing at a process that is not postgres.
    writeFileSync(join(opts.dataDir, 'postmaster.pid'), `${process.pid}\n${opts.dataDir}\n0\n${manager.port}\n`);
    const r = await manager.start();
    expect(r.port).toBeGreaterThan(0);
    expect(await manager.status()).toBe('running');
    await appQuery(manager.port, 'SELECT 1');
  });

  it('moves to the next free port when the preferred one is taken by another program', async () => {
    await manager.stop();
    const blocker: Server = createServer();
    await new Promise<void>((res) => blocker.listen(opts.port, '127.0.0.1', () => res()));
    try {
      const r = await manager.start();
      expect(r.port).toBeGreaterThan(opts.port);
      await appQuery(r.port, 'SELECT 1');
    } finally {
      await new Promise<void>((res) => blocker.close(() => res()));
    }
  });

  it('refuses to re-run initdb on an existing cluster', async () => {
    await expect(manager.initCluster()).rejects.toThrow(/sudah ada/);
    expect(existsSync(join(opts.dataDir, 'PG_VERSION'))).toBe(true);
  });

  it('keeps a complete cluster, discards one whose first run was interrupted, and re-initialises', async () => {
    expect(manager.isComplete()).toBe(true);
    expect(await manager.discardIncompleteCluster()).toBe(false);

    // Simulate a first run killed after initdb but before the app role was created.
    rmSync(join(opts.dataDir, 'mandiri_tani.initialized'));
    expect(await manager.discardIncompleteCluster()).toBe(true);
    expect(existsSync(opts.dataDir)).toBe(false); // moved aside, not deleted
    expect(readdirSync(root).some((d) => d.startsWith('pgdata.incomplete-'))).toBe(true);

    await manager.initCluster();
    expect(manager.isComplete()).toBe(true);
    await appQuery(manager.port, 'SELECT 1');
  });
});
