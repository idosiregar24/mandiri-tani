import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const repoRoot = fileURLToPath(new URL('..', import.meta.url));
export const migrationsDir = join(repoRoot, 'db', 'migrations');

export function pgBinDir(): string {
  const dir = join(repoRoot, 'resources', 'postgres', 'bin');
  if (!existsSync(join(dir, 'pg_ctl.exe'))) {
    throw new Error('PostgreSQL portable belum diunduh — jalankan `npm run fetch:postgres` dulu.');
  }
  return dir;
}
