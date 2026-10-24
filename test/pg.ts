// Per-test-file database on the shared test cluster: fresh, owned by the app role
// (like production), migrated on request, dropped afterwards.
import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { inject } from 'vitest';
import type { DbConfig } from '../src/server/db/pool';

async function asSuperuser<T>(fn: (c: pg.Client) => Promise<T>): Promise<T> {
  const info = inject('pg');
  const client = new pg.Client({
    host: info.host,
    port: info.port,
    user: info.superuser,
    password: info.superuserPassword,
    database: 'postgres',
  });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

export interface TestDatabase {
  config: DbConfig;
  drop(): Promise<void>;
}

export async function createTestDatabase(): Promise<TestDatabase> {
  const info = inject('pg');
  const name = `t_${randomBytes(6).toString('hex')}`;
  await asSuperuser((c) => c.query(`CREATE DATABASE ${name} OWNER ${info.appUser}`));
  return {
    config: { host: info.host, port: info.port, database: name, user: info.appUser, password: info.appPassword },
    drop: () => asSuperuser((c) => c.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`)).then(() => undefined),
  };
}
