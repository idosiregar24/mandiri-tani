// HTTP-level test harness for the embedded API on a fresh, migrated database.
// `as: 'OWNER'` goes through the real server + local access key (sprint-3 S3-1);
// `as: 'KASIR'` uses the same routes behind a stub authenticator, because no KASIR
// credential exists before Sprint 2 — it proves requirePermission answers 403.
import { readFileSync } from 'node:fs';
import { createServer as createHttpServer, type Server } from 'node:http';
import { join } from 'node:path';
import express from 'express';
import pg from 'pg';
import pino from 'pino';
import type { Role } from '@shared/permissions';
import { errorHandler, notFound } from '../src/server/middleware/error-handler';
import { requestContext } from '../src/server/middleware/request-id';
import { customerRoutes } from '../src/server/modules/customers/routes';
import { importRoutes } from '../src/server/modules/imports/routes';
import type { ImportHooks } from '../src/server/modules/imports/service';
import { masterRoutes } from '../src/server/modules/masters/routes';
import { paymentMethodRoutes } from '../src/server/modules/payment-methods/routes';
import { productRoutes } from '../src/server/modules/products/routes';
import { supplierRoutes } from '../src/server/modules/suppliers/routes';
import { createServer, type PosServer } from '../src/server/server';
import type { DbConfig, Pool } from '../src/server/db/pool';
import { migrationsDir, repoRoot } from './paths';
import { createTestDatabase, type TestDatabase } from './pg';

export const TEST_ACCESS_KEY = 'test-local-access-key';

export interface ApiResponse<T = unknown> {
  status: number;
  body: T;
}

export interface TestApi {
  pool: Pool;
  /** The synthetic "restored iPOS backup" database (startTestApi({ ipos: true })). */
  iposDb: DbConfig | null;
  call<T = unknown>(
    method: string,
    path: string,
    body?: unknown,
    opts?: { as?: Role | 'ANONYMOUS' },
  ): Promise<ApiResponse<T>>;
  close(): Promise<void>;
}

const logger = pino({ level: 'silent' });

function listen(server: Server): Promise<string> {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const a = server.address();
      resolve(`http://127.0.0.1:${typeof a === 'object' && a ? a.port : 0}/api/v1`);
    });
  });
}

export interface TestApiOptions {
  /** Load test/fixtures/ipos-mini.sql into a second database, as if the main process had restored a backup. */
  ipos?: boolean;
  hooks?: ImportHooks;
}

/** What PgManager.restoreIposBackup() writes next to the iPOS tables. */
async function loadIposFixture(config: DbConfig): Promise<void> {
  const client = new pg.Client(config);
  await client.connect();
  try {
    await client.query(readFileSync(join(repoRoot, 'test', 'fixtures', 'ipos-mini.sql'), 'utf8'));
    await client.query(`CREATE TABLE _mtpos_source (
      file_name text NOT NULL, sha256 text NOT NULL, size_bytes bigint NOT NULL, dump_created_at text,
      source_database text, source_version text, tables integer NOT NULL, restored_at timestamptz NOT NULL DEFAULT now())`);
    await client.query(
      `INSERT INTO _mtpos_source (file_name, sha256, size_bytes, dump_created_at, source_database, source_version, tables)
       VALUES ('contoh.i5bu', repeat('ab', 32), 12345, '2026-10-24 12:01:26', 'i5_contoh', '9.5.3', 15)`,
    );
  } finally {
    await client.end();
  }
}

export async function startTestApi(opts: TestApiOptions = {}): Promise<TestApi> {
  const tdb: TestDatabase = await createTestDatabase();
  const ipos: TestDatabase | null = opts.ipos ? await createTestDatabase() : null;
  if (ipos) await loadIposFixture(ipos.config);
  const server: PosServer = createServer({
    host: '127.0.0.1',
    port: 0,
    db: tdb.config,
    appVersion: '0.0.0-test',
    logger,
    migrationsDir,
    localAccessKey: TEST_ACCESS_KEY,
    // No fixture → a database name that does not exist, like before the owner picks a file.
    iposDatabase: ipos?.config.database ?? 'ipos_tidak_ada',
    hooks: opts.hooks,
  });
  await server.migrate();
  const { port } = await server.start();
  const ownerBase = `http://127.0.0.1:${port}/api/v1`;

  const kasir = express();
  kasir.use(requestContext(logger));
  kasir.use(express.json());
  kasir.use((req, _res, next) => {
    req.ctx = { role: 'KASIR', userId: null, deviceId: null, via: 'LOCAL_ACCESS_KEY', requestId: req.id };
    next();
  });
  const pool = server.pool;
  const api = express.Router();
  for (const r of [masterRoutes, customerRoutes, supplierRoutes, paymentMethodRoutes, productRoutes])
    api.use(r({ pool }));
  api.use(
    importRoutes({ pool, iposDb: ipos?.config ?? { ...tdb.config, database: 'ipos_tidak_ada' }, hooks: opts.hooks }),
  );
  api.use(notFound);
  kasir.use('/api/v1', api);
  kasir.use(errorHandler);
  const kasirHttp = createHttpServer(kasir);
  const kasirBase = await listen(kasirHttp);

  return {
    pool,
    iposDb: ipos?.config ?? null,
    async call<T>(method: string, path: string, body?: unknown, opts?: { as?: Role | 'ANONYMOUS' }) {
      const as = opts?.as ?? 'OWNER';
      const headers: Record<string, string> = { accept: 'application/json' };
      if (as === 'OWNER') headers.authorization = `Bearer ${TEST_ACCESS_KEY}`;
      if (body !== undefined) headers['content-type'] = 'application/json';
      const res = await fetch(`${as === 'KASIR' ? kasirBase : ownerBase}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const text = await res.text();
      return { status: res.status, body: (text ? JSON.parse(text) : null) as T };
    },
    async close() {
      await new Promise<void>((resolve) => kasirHttp.close(() => resolve()));
      await server.stop(500);
      await tdb.drop();
      await ipos?.drop();
    },
  };
}

/** Narrow helpers for response bodies. */
export type Data<T> = { data: T };
export type ListBody<T> = { data: T[]; meta: { total: number; page: number; pageSize: number } };
export type ErrBody = { error: { code: string; message: string; details?: { fieldErrors?: Record<string, string> } } };
