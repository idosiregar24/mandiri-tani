import type { DeviceItem, DeviceKind } from '@shared/schemas/devices';
import type { Queryable } from '../../db/pool';

export async function list(db: Queryable): Promise<DeviceItem[]> {
  const r = await db.query<DeviceItem>(
    `SELECT id, code, name, kind, app_version AS "appVersion",
            paired_at AS "pairedAt", last_seen_at AS "lastSeenAt",
            last_clock_skew_ms AS "lastClockSkewMs", revoked_at AS "revokedAt",
            created_at AS "createdAt", updated_at AS "updatedAt"
     FROM devices
     ORDER BY code ASC`,
  );
  return r.rows;
}

export async function get(db: Queryable, id: string): Promise<DeviceItem | null> {
  const r = await db.query<DeviceItem>(
    `SELECT id, code, name, kind, app_version AS "appVersion",
            paired_at AS "pairedAt", last_seen_at AS "lastSeenAt",
            last_clock_skew_ms AS "lastClockSkewMs", revoked_at AS "revokedAt",
            created_at AS "createdAt", updated_at AS "updatedAt"
     FROM devices
     WHERE id = $1`,
    [id],
  );
  return r.rows[0] ?? null;
}

export async function getByTokenHash(db: Queryable, tokenHash: string): Promise<DeviceItem | null> {
  const r = await db.query<DeviceItem>(
    `SELECT id, code, name, kind, app_version AS "appVersion",
            paired_at AS "pairedAt", last_seen_at AS "lastSeenAt",
            last_clock_skew_ms AS "lastClockSkewMs", revoked_at AS "revokedAt",
            created_at AS "createdAt", updated_at AS "updatedAt"
     FROM devices
     WHERE token_hash = $1 AND revoked_at IS NULL`,
    [tokenHash],
  );
  return r.rows[0] ?? null;
}

export async function updateLastSeen(db: Queryable, deviceId: string, skewMs?: number | null): Promise<void> {
  await db.query(
    `UPDATE devices
     SET last_seen_at = now(),
         last_clock_skew_ms = coalesce($2, last_clock_skew_ms)
     WHERE id = $1`,
    [deviceId, skewMs ?? null],
  );
}

export async function createPairingCode(
  db: Queryable,
  input: { id: string; codeHash: string; kind: 'TERMINAL' | 'MOBILE'; expiresAt: Date; createdBy: string },
): Promise<void> {
  await db.query(
    `INSERT INTO device_pairing_codes (id, code_hash, kind, expires_at, created_by)
     VALUES ($1, $2, $3, $4, $5)`,
    [input.id, input.codeHash, input.kind, input.expiresAt, input.createdBy],
  );
}

export async function findValidPairingCode(
  db: Queryable,
  codeHash: string,
): Promise<{ id: string; kind: 'TERMINAL' | 'MOBILE'; createdBy: string } | null> {
  const r = await db.query<{ id: string; kind: 'TERMINAL' | 'MOBILE'; createdBy: string }>(
    `SELECT id, kind, created_by AS "createdBy"
     FROM device_pairing_codes
     WHERE code_hash = $1 AND expires_at > now() AND used_at IS NULL
     ORDER BY created_at DESC
     LIMIT 1
     FOR UPDATE`,
  [codeHash],
  );
  return r.rows[0] ?? null;
}

export async function markPairingCodeUsed(db: Queryable, id: string, deviceId: string): Promise<void> {
  await db.query(
    `UPDATE device_pairing_codes
     SET used_at = now(), used_by_device_id = $2
     WHERE id = $1`,
    [id, deviceId],
  );
}

export async function nextDeviceCode(db: Queryable, kind: 'TERMINAL' | 'MOBILE'): Promise<string> {
  const prefix = kind === 'MOBILE' ? 'H' : 'T';
  const r = await db.query<{ next: number }>(
    `SELECT coalesce(max(substring(code from 2)::int), 0) + 1 AS next
     FROM devices
     WHERE code LIKE $1`,
    [`${prefix}%`],
  );
  const num = r.rows[0]?.next ?? 1;
  return `${prefix}${String(num).padStart(2, '0')}`;
}

export async function insertDevice(
  db: Queryable,
  device: {
    id: string;
    code: string;
    name: string;
    kind: DeviceKind;
    tokenHash: string;
    appVersion?: string | null;
    pairedAt: Date;
    skewMs?: number | null;
  },
): Promise<void> {
  await db.query(
    `INSERT INTO devices (id, code, name, kind, token_hash, app_version, paired_at, last_seen_at, last_clock_skew_ms)
     VALUES ($1, $2, $3, $4, $5, $6, $7, now(), $8)`,
    [
      device.id,
      device.code,
      device.name,
      device.kind,
      device.tokenHash,
      device.appVersion ?? null,
      device.pairedAt,
      device.skewMs ?? null,
    ],
  );
}

export async function revokeDevice(db: Queryable, id: string): Promise<void> {
  await db.query(`UPDATE devices SET revoked_at = now() WHERE id = $1`, [id]);
  await db.query(`UPDATE sessions SET revoked_at = now() WHERE device_id = $1 AND revoked_at IS NULL`, [id]);
}

