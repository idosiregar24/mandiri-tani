import { cpSync, mkdtempSync, rmSync, writeFileSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDatabase, type TestDatabase } from '../../../test/pg';
import { migrationsDir } from '../../../test/paths';
import { ensureHubDevice } from './bootstrap';
import { runMigrations } from './migrate';
import { createPool, type Pool } from './pool';

let tdb: TestDatabase;
let pool: Pool;

beforeAll(async () => {
  tdb = await createTestDatabase();
  pool = createPool(tdb.config);
});

afterAll(async () => {
  await pool?.end();
  await tdb?.drop();
});

describe('runMigrations', () => {
  it('applies 0001_system and records it', async () => {
    const r = await runMigrations(pool, migrationsDir);
    expect(r.applied).toContain('0001_system.sql');
    const { rows } = await pool.query<{ table_name: string }>(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY 1",
    );
    expect(rows.map((t) => t.table_name)).toEqual(
      expect.arrayContaining(['settings', 'users', 'devices', 'sessions', 'audit_logs', 'doc_sequences', 'sync_ops', 'import_batches', 'legacy_refs', 'schema_migrations']),
    );
  });

  it('is idempotent', async () => {
    const r = await runMigrations(pool, migrationsDir);
    expect(r.applied).toEqual([]);
    expect(r.alreadyApplied).toBeGreaterThanOrEqual(1);
  });

  it('refuses when an applied migration file was edited', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mtpos-mig-'));
    try {
      cpSync(migrationsDir, dir, { recursive: true });
      appendFileSync(join(dir, '0001_system.sql'), '\n-- edited after being applied\n');
      await expect(runMigrations(pool, dir)).rejects.toThrow(/sudah diterapkan tetapi isinya berubah/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('rolls back a failing migration completely', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mtpos-mig-'));
    try {
      cpSync(migrationsDir, dir, { recursive: true });
      writeFileSync(join(dir, '9999_broken.sql'), 'CREATE TABLE half_made (id int); SELECT * FROM table_that_does_not_exist;');
      await expect(runMigrations(pool, dir)).rejects.toThrow(/9999_broken\.sql gagal/);
      const { rowCount } = await pool.query("SELECT 1 FROM information_schema.tables WHERE table_name = 'half_made'");
      expect(rowCount).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('sets updated_at by trigger with the server clock', async () => {
    await pool.query("INSERT INTO settings (key, value) VALUES ('t', '{}')");
    const before = await pool.query<{ updated_at: Date }>("SELECT updated_at FROM settings WHERE key = 't'");
    await pool.query("UPDATE settings SET value = '{\"a\":1}', updated_at = '2000-01-01' WHERE key = 't'");
    const after = await pool.query<{ updated_at: Date }>("SELECT updated_at FROM settings WHERE key = 't'");
    expect(after.rows[0]!.updated_at.getTime()).toBeGreaterThanOrEqual(before.rows[0]!.updated_at.getTime());
  });

  it('keeps audit_logs append-only', async () => {
    await pool.query("INSERT INTO audit_logs (action) VALUES ('test.action')");
    await expect(pool.query("UPDATE audit_logs SET action = 'x'")).rejects.toThrow(/append-only/);
    await expect(pool.query('DELETE FROM audit_logs')).rejects.toThrow(/append-only/);
  });

  it('seeds the hub device K01 exactly once', async () => {
    await ensureHubDevice(pool);
    await ensureHubDevice(pool);
    const { rows } = await pool.query("SELECT code, kind FROM devices WHERE code = 'K01'");
    expect(rows).toEqual([{ code: 'K01', kind: 'HUB' }]);
  });
});
