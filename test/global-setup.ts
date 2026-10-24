// Starts ONE throwaway PostgreSQL cluster from the real portable binaries for the whole
// test run (backend-standards §6: tests use real PostgreSQL, never a mock).
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TestProject } from 'vitest/node';
import { PgManager, generatePassword } from '../src/main/pg/PgManager';
import { pgBinDir } from './paths';

export interface TestPgInfo {
  host: string;
  port: number;
  superuser: string;
  superuserPassword: string;
  appUser: string;
  appPassword: string;
}

declare module 'vitest' {
  export interface ProvidedContext {
    pg: TestPgInfo;
  }
}

export default async function setup(project: TestProject) {
  const root = mkdtempSync(join(tmpdir(), 'mtpos-test-'));
  const superuserPassword = generatePassword();
  const appPassword = generatePassword();
  const manager = new PgManager({
    binDir: pgBinDir(),
    dataDir: join(root, 'pgdata'),
    logDir: join(root, 'logs'),
    port: 5439,
    maxPort: 5449,
    superuserPassword,
    appUser: 'pos_app',
    appPassword,
    database: 'mandiri_tani',
  });
  await manager.initCluster();

  project.provide('pg', {
    host: '127.0.0.1',
    port: manager.port,
    superuser: 'postgres',
    superuserPassword,
    appUser: 'pos_app',
    appPassword,
  });

  return async () => {
    await manager.stop(10);
    rmSync(root, { recursive: true, force: true });
  };
}
