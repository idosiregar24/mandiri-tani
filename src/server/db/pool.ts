import pg from 'pg';

// NUMERIC (1700) and INT8 (20) already arrive as strings in node-postgres — keep it
// that way (database-standards §1: money/qty never become JS floats).
// DATE (1082) stays 'YYYY-MM-DD' so due dates never shift with the timezone.
pg.types.setTypeParser(1082, (value: string) => value);

export interface DbConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
}

export type Pool = pg.Pool;
export type PoolClient = pg.PoolClient;
/** Anything repos can run SQL on: the pool or a transaction client. */
export type Queryable = pg.Pool | pg.PoolClient;

export function createPool(config: DbConfig, onError?: (err: Error) => void): pg.Pool {
  const pool = new pg.Pool({
    ...config,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    statement_timeout: 15_000,
    application_name: 'mandiri-tani-pos',
  });
  // A broken idle connection (e.g. after laptop sleep) must not crash the process;
  // the pool discards it and opens a new one on demand (NFR-DB-03).
  pool.on('error', (err) => onError?.(err));
  return pool;
}

export function poolStats(pool: pg.Pool): { total: number; idle: number; waiting: number } {
  return { total: pool.totalCount, idle: pool.idleCount, waiting: pool.waitingCount };
}
