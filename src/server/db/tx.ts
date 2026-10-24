import type { Pool, PoolClient } from './pool';

// 40001 serialization_failure, 40P01 deadlock_detected — safe to retry the whole unit.
const RETRYABLE = new Set(['40001', '40P01']);
const MAX_ATTEMPTS = 3;

function isRetryable(err: unknown): boolean {
  return typeof err === 'object' && err !== null && RETRYABLE.has((err as { code?: string }).code ?? '');
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Borrow a client for read-only work; always released (NFR-DB-02). */
export async function withClient<T>(pool: Pool, fn: (db: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}

/**
 * One business document = one transaction (NFR-REL-02). Retries the whole callback on
 * deadlock/serialization errors with a short jittered backoff, so `fn` must not have
 * side effects outside the database (no printing, no IPC) — do those after it resolves.
 */
export async function withTransaction<T>(pool: Pool, fn: (tx: PoolClient) => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    const client = await pool.connect();
    let broken = false;
    try {
      await client.query('BEGIN');
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      try {
        await client.query('ROLLBACK');
      } catch {
        broken = true; // connection is unusable — destroy instead of returning it to the pool
      }
      if (attempt < MAX_ATTEMPTS && isRetryable(err)) {
        await sleep(50 * attempt + Math.floor(Math.random() * 50));
        continue;
      }
      throw err;
    } finally {
      client.release(broken);
    }
  }
}
