import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Logger } from 'pino';
import type { Pool } from './pool';
import { withClient } from './tx';

// Arbitrary constant: only one migration runner may hold this advisory lock at a time.
const MIGRATION_LOCK_KEY = 726_382_001;
const FILE_RE = /^\d{4}_[a-z0-9_]+\.sql$/;

export interface MigrationResult {
  applied: string[];
  alreadyApplied: number;
}

export class MigrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MigrationError';
  }
}

function checksum(sql: string): string {
  // Normalise line endings so a git checkout with CRLF does not look like an edit.
  return createHash('sha256').update(sql.replace(/\r\n/g, '\n')).digest('hex');
}

/**
 * Applies db/migrations/NNNN_name.sql forward-only, each file in its own transaction
 * (database-standards §2). An already-applied file whose content changed is fatal.
 */
export async function runMigrations(pool: Pool, dir: string, logger?: Logger): Promise<MigrationResult> {
  const files = (await readdir(dir)).filter((f) => FILE_RE.test(f)).sort();

  return withClient(pool, async (db) => {
    await db.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_KEY]);
    try {
      await db.query(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
          name        text PRIMARY KEY,
          checksum    text NOT NULL,
          applied_at  timestamptz NOT NULL DEFAULT now()
        )`);
      const { rows } = await db.query<{ name: string; checksum: string }>('SELECT name, checksum FROM schema_migrations');
      const done = new Map(rows.map((r) => [r.name, r.checksum]));

      const applied: string[] = [];
      for (const file of files) {
        const sql = await readFile(join(dir, file), 'utf8');
        const sum = checksum(sql);
        const previous = done.get(file);
        if (previous !== undefined) {
          if (previous !== sum) {
            throw new MigrationError(
              `Migrasi ${file} sudah diterapkan tetapi isinya berubah. Jangan ubah migrasi lama — buat file migrasi baru.`,
            );
          }
          continue;
        }
        logger?.info({ file }, 'applying migration');
        await db.query('BEGIN');
        try {
          await db.query(sql);
          await db.query('INSERT INTO schema_migrations (name, checksum) VALUES ($1, $2)', [file, sum]);
          await db.query('COMMIT');
        } catch (err) {
          await db.query('ROLLBACK');
          throw new MigrationError(`Migrasi ${file} gagal: ${(err as Error).message}`);
        }
        applied.push(file);
      }
      return { applied, alreadyApplied: done.size };
    } finally {
      await db.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_KEY]);
    }
  });
}
