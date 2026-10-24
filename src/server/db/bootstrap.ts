import type { Queryable } from './pool';
import { uuidv7 } from '@shared/uuid';

/** The hub PC is always device K01 (sprint-1 D4). Idempotent. */
export async function ensureHubDevice(db: Queryable): Promise<void> {
  await db.query(
    `INSERT INTO devices (id, code, name, kind, paired_at)
     VALUES ($1, 'K01', 'PC Kasir Utama', 'HUB', now())
     ON CONFLICT (code) DO NOTHING`,
    [uuidv7()],
  );
}
