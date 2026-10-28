// HTTP-level test harness for the embedded API on a fresh, migrated database.
// Two real accounts are created (Owner + Kasir) and logged in through POST /auth/login with the
// local access key, exactly like the hub window does (sprint-2 S2-1). `as: 'OWNER' | 'KASIR'`
// sends that user's session token; `as: 'ANONYMOUS'` sends none.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';
import pino from 'pino';
import type { Role } from '@shared/permissions';
import type { LoginResult } from '@shared/schemas/auth';
import { uuidv7 } from '@shared/uuid';
import { hashSecret } from '../src/server/lib/passwords';
import type { ImportHooks } from '../src/server/modules/imports/service';
import { createServer, type PosServer } from '../src/server/server';
import type { DbConfig, Pool } from '../src/server/db/pool';
import { migrationsDir, repoRoot } from './paths';
import { createTestDatabase, type TestDatabase } from './pg';

export const TEST_ACCESS_KEY = 'test-local-access-key';
/** Header the hub window sends on pre-login routes. */
export const HUB_HEADERS = { 'x-local-access-key': TEST_ACCESS_KEY };

/** Synthetic test accounts (never real store users). */
export const TEST_USERS = {
  OWNER: { username: 'pemilik', fullName: 'Pemilik Uji', password: 'rahasia-owner', pin: '135790' },
  KASIR: { username: 'kasir', fullName: 'Kasir Uji', password: null, pin: '246802' },
} as const;

export interface ApiResponse<T = unknown> {
  status: number;
  body: T;
  headers: Headers;
}

export interface CallOptions {
  as?: Role | 'ANONYMOUS';
  /** Use this session token instead of the role's default one. */
  token?: string;
  headers?: Record<string, string>;
}

export interface TestApi {
  pool: Pool;
  /** The synthetic "restored iPOS backup" database (startTestApi({ ipos: true })). */
  iposDb: DbConfig | null;
  users: Record<Role, { id: string; token: string }>;
  call<T = unknown>(method: string, path: string, body?: unknown, opts?: CallOptions): Promise<ApiResponse<T>>;
  /** POST /auth/login from the hub window. */
  login(username: string, method: 'PIN' | 'PASSWORD', secret: string): Promise<ApiResponse<Data<LoginResult>>>;
  close(): Promise<void>;
}

const logger = pino({ level: 'silent' });

export interface TestApiOptions {
  /** Load test/fixtures/ipos-mini.sql into a second database, as if the main process had restored a backup. */
  ipos?: boolean;
  hooks?: ImportHooks;
  /** Start with no user at all, like a fresh install before the setup wizard. */
  noUsers?: boolean;
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
       VALUES ('contoh.i5bu', repeat('ab', 32), 12345, '2026-10-24 12:01:26', 'i5_contoh', '9.5.3', 17)`,
    );
  } finally {
    await client.end();
  }
}

/** Inserts a user directly (the users module is tested separately). */
export async function insertUser(
  pool: Pool,
  u: { username: string; fullName: string; role: Role; password: string | null; pin: string | null },
): Promise<string> {
  const id = uuidv7();
  await pool.query(
    `INSERT INTO users (id, username, full_name, role, password_hash, pin_hash) VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      id,
      u.username,
      u.fullName,
      u.role,
      u.password ? await hashSecret(u.password) : null,
      u.pin ? await hashSecret(u.pin) : null,
    ],
  );
  return id;
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
  const base = `http://127.0.0.1:${port}/api/v1`;
  const pool = server.pool;

  async function call<T>(method: string, path: string, body?: unknown, o?: CallOptions): Promise<ApiResponse<T>> {
    const as = o?.as ?? 'OWNER';
    const headers: Record<string, string> = { accept: 'application/json', ...o?.headers };
    const token = o?.token ?? (as === 'ANONYMOUS' ? undefined : users[as].token);
    if (token) headers.authorization = `Bearer ${token}`;
    if (body !== undefined) headers['content-type'] = 'application/json';
    const res = await fetch(`${base}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    return { status: res.status, body: (text ? JSON.parse(text) : null) as T, headers: res.headers };
  }

  const login = (username: string, method: 'PIN' | 'PASSWORD', secret: string) =>
    call<Data<LoginResult>>(
      'POST',
      '/auth/login',
      { username, method, secret },
      { as: 'ANONYMOUS', headers: HUB_HEADERS },
    );

  const users = {} as Record<Role, { id: string; token: string }>;
  for (const role of opts.noUsers ? [] : (['OWNER', 'KASIR'] as const)) {
    const u = TEST_USERS[role];
    const id = await insertUser(pool, { ...u, role });
    const r = await login(u.username, 'PIN', u.pin);
    if (r.status !== 201) throw new Error(`test login ${role} failed: ${r.status} ${JSON.stringify(r.body)}`);
    users[role] = { id, token: r.body.data.token };
  }

  return {
    pool,
    iposDb: ipos?.config ?? null,
    users,
    call,
    login,
    async close() {
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
