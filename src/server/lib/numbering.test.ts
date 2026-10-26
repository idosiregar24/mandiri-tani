import pino from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDatabase, type TestDatabase } from '../../../test/pg';
import { migrationsDir } from '../../../test/paths';
import { createPool, type Pool } from '../db/pool';
import { runMigrations } from '../db/migrate';
import { withTransaction } from '../db/tx';
import { formatDocNumber, nextDocNumber } from './numbering';

describe('formatDocNumber (iPOS format)', () => {
  it('builds URUT/TIPE/DEPT/BLNTHN with 7 digits for KSR/JL/BL and 4 otherwise', () => {
    const oct = new Date('2026-10-26T03:00:00Z');
    expect(formatDocNumber(1789, 'JL', 'UTM', oct)).toBe('0001789/JL/UTM/1026');
    expect(formatDocNumber(2061, 'KSR', 'utm', oct)).toBe('0002061/KSR/UTM/1026');
    expect(formatDocNumber(1, 'PS', 'UTM', oct)).toBe('0001/PS/UTM/1026');
    expect(formatDocNumber(12, 'OP', 'UTM', new Date('2027-03-01T00:00:00Z'))).toBe('0012/OP/UTM/0327');
  });

  it('uses the Asia/Jakarta date (31 Dec 18:00 UTC is already January in WIB)', () => {
    expect(formatDocNumber(1, 'PS', 'UTM', new Date('2026-12-31T18:00:00Z'))).toBe('0001/PS/UTM/0127');
  });
});

describe('nextDocNumber', () => {
  let tdb: TestDatabase;
  let pool: Pool;
  beforeAll(async () => {
    tdb = await createTestDatabase();
    pool = createPool(tdb.config);
    await runMigrations(pool, migrationsDir, pino({ level: 'silent' }));
  });
  afterAll(async () => {
    await pool?.end();
    await tdb?.drop();
  });

  const at = new Date('2026-10-26T03:00:00Z');

  it('counts per type, per warehouse and per year, and resets every year', async () => {
    const take = (type: 'PS' | 'OP', dept: string, d = at) =>
      withTransaction(pool, (tx) => nextDocNumber(tx, type, dept, d));
    expect(await take('PS', 'UTM')).toBe('0001/PS/UTM/1026');
    expect(await take('PS', 'UTM')).toBe('0002/PS/UTM/1026');
    expect(await take('OP', 'UTM')).toBe('0001/OP/UTM/1026');
    expect(await take('PS', 'GD2')).toBe('0001/PS/GD2/1026');
    expect(await take('PS', 'UTM', new Date('2027-01-02T03:00:00Z'))).toBe('0001/PS/UTM/0127');
  });

  it('gives the number back when the document transaction rolls back', async () => {
    await expect(
      withTransaction(pool, async (tx) => {
        await nextDocNumber(tx, 'RK', 'UTM', at);
        throw new Error('dokumen gagal');
      }),
    ).rejects.toThrow('dokumen gagal');
    expect(await withTransaction(pool, (tx) => nextDocNumber(tx, 'RK', 'UTM', at))).toBe('0001/RK/UTM/1026');
  });

  it('never hands out the same number to concurrent documents', async () => {
    const numbers = await Promise.all(
      Array.from({ length: 8 }, () => withTransaction(pool, (tx) => nextDocNumber(tx, 'TRF', 'UTM', at))),
    );
    expect(new Set(numbers).size).toBe(8);
    expect([...numbers].sort()).toEqual(Array.from({ length: 8 }, (_, i) => `000${i + 1}/TRF/UTM/1026`));
  });

  it('continues from a number seeded from iPOS at go-live (PRD §6.7)', async () => {
    await pool.query(
      "INSERT INTO doc_sequences (doc_type, dept_code, year, digits, last_no) VALUES ('JL', 'UTM', 2026, 7, 1788)",
    );
    expect(await withTransaction(pool, (tx) => nextDocNumber(tx, 'JL', 'UTM', at))).toBe('0001789/JL/UTM/1026');
  });
});
