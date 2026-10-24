import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDatabase, type TestDatabase } from '../../../test/pg';
import { createPool, type Pool } from './pool';
import { withTransaction } from './tx';

let tdb: TestDatabase;
let pool: Pool;

beforeAll(async () => {
  tdb = await createTestDatabase();
  pool = createPool(tdb.config);
  await pool.query('CREATE TABLE t (v int)');
});

afterAll(async () => {
  await pool?.end();
  await tdb?.drop();
});

describe('withTransaction', () => {
  it('commits on success', async () => {
    await withTransaction(pool, (tx) => tx.query('INSERT INTO t VALUES (1)'));
    const { rows } = await pool.query('SELECT count(*)::int AS n FROM t WHERE v = 1');
    expect(rows[0].n).toBe(1);
  });

  it('rolls back everything on error', async () => {
    await expect(
      withTransaction(pool, async (tx) => {
        await tx.query('INSERT INTO t VALUES (2)');
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    const { rows } = await pool.query('SELECT count(*)::int AS n FROM t WHERE v = 2');
    expect(rows[0].n).toBe(0);
  });

  it('retries deadlock / serialization failures and then succeeds', async () => {
    let attempts = 0;
    await withTransaction(pool, async (tx) => {
      attempts++;
      await tx.query('INSERT INTO t VALUES (3)');
      if (attempts < 3) throw Object.assign(new Error('deadlock detected'), { code: '40P01' });
    });
    expect(attempts).toBe(3);
    const { rows } = await pool.query('SELECT count(*)::int AS n FROM t WHERE v = 3');
    expect(rows[0].n).toBe(1); // the two failed attempts were rolled back
  });

  it('gives up after 3 attempts', async () => {
    let attempts = 0;
    await expect(
      withTransaction(pool, async () => {
        attempts++;
        throw Object.assign(new Error('could not serialize access'), { code: '40001' });
      }),
    ).rejects.toThrow(/serialize/);
    expect(attempts).toBe(3);
  });

  it('does not retry other errors', async () => {
    let attempts = 0;
    await expect(
      withTransaction(pool, async (tx) => {
        attempts++;
        await tx.query('SELECT * FROM missing_table');
      }),
    ).rejects.toThrow();
    expect(attempts).toBe(1);
  });

  it('returns connections to the pool', async () => {
    for (let i = 0; i < 20; i++) await withTransaction(pool, (tx) => tx.query('SELECT 1'));
    expect(pool.totalCount).toBeLessThanOrEqual(10);
    expect(pool.waitingCount).toBe(0);
  });
});
