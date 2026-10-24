// Keeps the authoritative DDL (.claude/File Skema/.../mandiri_tani_schema.sql) honest:
// the whole file must execute on a fresh PostgreSQL database (sprint-1 D3).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDatabase, type TestDatabase } from './pg';
import { repoRoot } from './paths';

const schemaFile = join(repoRoot, '.claude', 'File Skema', 'Mandiri Tani v1.0', 'mandiri_tani_schema.sql');
let tdb: TestDatabase;
let client: pg.Client;

beforeAll(async () => {
  tdb = await createTestDatabase();
  client = new pg.Client(tdb.config);
  await client.connect();
});

afterAll(async () => {
  await client?.end();
  await tdb?.drop();
});

describe('mandiri_tani_schema.sql', () => {
  it('executes completely on a fresh database', async () => {
    await client.query(readFileSync(schemaFile, 'utf8'));
    const { rows } = await client.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'",
    );
    expect(rows[0]!.n).toBeGreaterThanOrEqual(50);
  });

  it('puts an updated_at trigger on every table that has updated_at', async () => {
    const { rows } = await client.query<{ table_name: string }>(`
      SELECT c.table_name FROM information_schema.columns c
      JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name
      WHERE c.table_schema = 'public' AND c.column_name = 'updated_at' AND t.table_type = 'BASE TABLE'
        AND NOT EXISTS (SELECT 1 FROM pg_trigger tg JOIN pg_class cl ON cl.oid = tg.tgrelid
                        WHERE cl.relname = c.table_name AND tg.tgname = c.table_name || '_set_updated_at')`);
    expect(rows).toEqual([]);
  });

  it('indexes every foreign key (database-standards §3)', async () => {
    const { rows } = await client.query<{ tbl: string; col: string }>(`
      SELECT conrelid::regclass::text AS tbl, a.attname AS col
      FROM pg_constraint c
      JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
      WHERE c.contype = 'f' AND c.connamespace = 'public'::regnamespace
        AND NOT EXISTS (
          SELECT 1 FROM pg_index i
          WHERE i.indrelid = c.conrelid AND i.indkey[0] = c.conkey[1]
        )`);
    expect(rows).toEqual([]);
  });

  it('keeps ledgers append-only', async () => {
    const { rows } = await client.query<{ tgname: string }>(
      "SELECT tgname FROM pg_trigger WHERE tgname LIKE '%append_only' ORDER BY 1",
    );
    expect(rows.map((r) => r.tgname)).toEqual([
      'audit_logs_append_only',
      'cash_transactions_append_only',
      'stock_layer_consumptions_append_only',
      'stock_movements_append_only',
    ]);
  });
});
