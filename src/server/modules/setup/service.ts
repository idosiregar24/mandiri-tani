// First-run wizard (PRD FR-SYS-01, sprint-2 C3): store profile + first Owner + default warehouse
// name, in ONE transaction, accepted only while no user exists. Answers with a logged-in session
// so the Owner lands straight in the app.
import type { LoginResult } from '@shared/schemas/auth';
import { SetupInput, type SetupStatus } from '@shared/schemas/settings';
import { uuidv7 } from '@shared/uuid';
import type { Pool, Queryable } from '../../db/pool';
import { withTransaction } from '../../db/tx';
import { recordAudit } from '../../lib/audit';
import { AppError } from '../../lib/errors';
import { hashSecret } from '../../lib/passwords';
import { login, type ClientInfo } from '../auth/service';

// Any constant works: it only serialises concurrent POST /setup calls.
const SETUP_LOCK = 0x4d54_0001;

async function defaultWarehouse(db: Queryable) {
  const r = await db.query<{ id: string; code: string; name: string }>(
    `SELECT id, code, name FROM warehouses WHERE is_default AND deleted_at IS NULL`,
  );
  return r.rows[0] ?? null;
}

export async function status(pool: Pool): Promise<SetupStatus> {
  const users = await pool.query<{ n: number }>(`SELECT count(*)::int AS n FROM users`);
  const wh = await defaultWarehouse(pool);
  return { needsSetup: users.rows[0]!.n === 0, warehouse: wh ? { code: wh.code, name: wh.name } : null };
}

export async function setup(pool: Pool, body: unknown, client: ClientInfo): Promise<LoginResult> {
  const input = SetupInput.parse(body);
  // Hash before the transaction: argon2 is slow and needs no lock.
  const [passwordHash, pinHash] = await Promise.all([hashSecret(input.owner.password), hashSecret(input.owner.pin)]);
  await withTransaction(pool, async (tx) => {
    await tx.query('SELECT pg_advisory_xact_lock($1)', [SETUP_LOCK]);
    const users = await tx.query<{ n: number }>(`SELECT count(*)::int AS n FROM users`);
    if (users.rows[0]!.n > 0) {
      throw new AppError('ALREADY_SET_UP', 'Aplikasi sudah disiapkan. Silakan masuk dengan akun yang ada.', 409);
    }
    const ownerId = uuidv7();
    await tx.query(
      `INSERT INTO users (id, username, full_name, role, password_hash, pin_hash) VALUES ($1, $2, $3, 'OWNER', $4, $5)`,
      [ownerId, input.owner.username, input.owner.fullName, passwordHash, pinHash],
    );
    await tx.query(
      `INSERT INTO settings (key, value) VALUES ('store', $1)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [JSON.stringify(input.store)],
    );
    const wh = await defaultWarehouse(tx);
    if (!wh) throw new AppError('NO_WAREHOUSE', 'Gudang utama tidak ditemukan. Hubungi admin.', 500);
    await tx.query(`UPDATE warehouses SET name = $2 WHERE id = $1`, [wh.id, input.warehouseName]);
    await recordAudit(
      tx,
      { userId: ownerId, deviceId: client.deviceId, requestId: client.requestId, ip: client.ip },
      {
        action: 'system.setup',
        entity: 'user',
        entityId: ownerId,
        after: {
          store: input.store,
          owner: { username: input.owner.username, fullName: input.owner.fullName },
          warehouse: { code: wh.code, name: input.warehouseName },
        },
      },
    );
  });
  return login(pool, { username: input.owner.username, method: 'PASSWORD', secret: input.owner.password }, client);
}
