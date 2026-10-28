// SQL for users' credentials, sessions and Owner-PIN grants. Hashes never leave this module
// except to the service that verifies them (security-standards §4).
import type { Role } from '@shared/permissions';
import type { LoginMethod } from '@shared/schemas/auth';
import type { Queryable } from '../../db/pool';

export interface CredentialRow {
  id: string;
  username: string;
  fullName: string;
  role: Role;
  passwordHash: string | null;
  pinHash: string | null;
  failedAttempts: number;
  lockedUntil: Date | null;
  isActive: boolean;
}

export async function findCredentials(db: Queryable, username: string): Promise<CredentialRow | null> {
  const r = await db.query<CredentialRow>(
    `SELECT id, username, full_name AS "fullName", role, password_hash AS "passwordHash", pin_hash AS "pinHash",
            failed_attempts AS "failedAttempts", locked_until AS "lockedUntil", is_active AS "isActive"
       FROM users WHERE lower(username) = lower($1)
        FOR UPDATE`,
    [username],
  );
  return r.rows[0] ?? null;
}

/** Counts one failure; locks the account once `limit` is reached. Returns the new lock time, if any. */
export async function recordFailure(
  db: Queryable,
  userId: string,
  limit: number,
  lockUntil: Date,
): Promise<Date | null> {
  const r = await db.query<{ lockedUntil: Date | null }>(
    `UPDATE users
        SET failed_attempts = CASE WHEN failed_attempts + 1 >= $2 THEN 0 ELSE failed_attempts + 1 END,
            locked_until    = CASE WHEN failed_attempts + 1 >= $2 THEN $3::timestamptz ELSE locked_until END
      WHERE id = $1
      RETURNING CASE WHEN locked_until = $3::timestamptz THEN locked_until END AS "lockedUntil"`,
    [userId, limit, lockUntil],
  );
  return r.rows[0]?.lockedUntil ?? null;
}

export async function recordSuccess(db: Queryable, userId: string, now: Date): Promise<void> {
  await db.query(`UPDATE users SET failed_attempts = 0, locked_until = NULL, last_login_at = $2 WHERE id = $1`, [
    userId,
    now,
  ]);
}

export async function insertSession(
  db: Queryable,
  s: {
    id: string;
    userId: string;
    deviceId: string;
    tokenHash: string;
    method: LoginMethod;
    ip: string | null;
    expiresAt: Date;
    now: Date;
  },
): Promise<void> {
  await db.query(
    `INSERT INTO sessions (id, user_id, device_id, token_hash, login_method, ip, expires_at, last_used_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [s.id, s.userId, s.deviceId, s.tokenHash, s.method, s.ip, s.expiresAt, s.now],
  );
}

export interface SessionRow {
  sessionId: string;
  userId: string;
  deviceId: string;
  method: LoginMethod;
  lastUsedAt: Date | null;
  username: string;
  fullName: string;
  role: Role;
}

/** A live session: not revoked, not expired, user still active. */
export async function findSession(db: Queryable, tokenHash: string, now: Date): Promise<SessionRow | null> {
  const r = await db.query<SessionRow>(
    `SELECT s.id AS "sessionId", s.user_id AS "userId", s.device_id AS "deviceId", s.login_method AS method,
            s.last_used_at AS "lastUsedAt", u.username, u.full_name AS "fullName", u.role
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = $1 AND s.revoked_at IS NULL AND s.expires_at > $2 AND u.is_active`,
    [tokenHash, now],
  );
  return r.rows[0] ?? null;
}

export async function touchSession(db: Queryable, sessionId: string, now: Date, expiresAt: Date): Promise<void> {
  await db.query(`UPDATE sessions SET last_used_at = $2, expires_at = $3 WHERE id = $1 AND revoked_at IS NULL`, [
    sessionId,
    now,
    expiresAt,
  ]);
}

export async function revokeSession(db: Queryable, sessionId: string, now: Date): Promise<void> {
  await db.query(`UPDATE sessions SET revoked_at = $2 WHERE id = $1 AND revoked_at IS NULL`, [sessionId, now]);
}

export async function revokeUserSessions(db: Queryable, userId: string, now: Date): Promise<number> {
  const r = await db.query(`UPDATE sessions SET revoked_at = $2 WHERE user_id = $1 AND revoked_at IS NULL`, [
    userId,
    now,
  ]);
  return r.rowCount ?? 0;
}

export async function listLoginUsers(
  db: Queryable,
): Promise<{ id: string; username: string; fullName: string; role: Role; hasPassword: boolean; hasPin: boolean }[]> {
  const r = await db.query<{
    id: string;
    username: string;
    fullName: string;
    role: Role;
    hasPassword: boolean;
    hasPin: boolean;
  }>(
    `SELECT id, username, full_name AS "fullName", role,
            password_hash IS NOT NULL AS "hasPassword", pin_hash IS NOT NULL AS "hasPin"
       FROM users WHERE is_active ORDER BY role, lower(full_name)`,
  );
  return r.rows;
}

export async function insertGrant(
  db: Queryable,
  g: {
    id: string;
    tokenHash: string;
    permission: string;
    grantedBy: string;
    requestedBy: string;
    deviceId: string;
    expiresAt: Date;
  },
): Promise<void> {
  await db.query(
    `INSERT INTO authorization_grants (id, token_hash, permission, granted_by, requested_by, device_id, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [g.id, g.tokenHash, g.permission, g.grantedBy, g.requestedBy, g.deviceId, g.expiresAt],
  );
}

export interface GrantRow {
  id: string;
  permission: string;
  grantedBy: string;
  requestedBy: string;
  deviceId: string;
  expiresAt: Date;
  usedAt: Date | null;
}

export async function findGrant(db: Queryable, tokenHash: string): Promise<GrantRow | null> {
  const r = await db.query<GrantRow>(
    `SELECT id, permission, granted_by AS "grantedBy", requested_by AS "requestedBy", device_id AS "deviceId",
            expires_at AS "expiresAt", used_at AS "usedAt"
       FROM authorization_grants WHERE token_hash = $1`,
    [tokenHash],
  );
  return r.rows[0] ?? null;
}

/** Marks the grant used; false when another request used it first (one-shot). */
export async function consumeGrant(db: Queryable, grantId: string, now: Date): Promise<boolean> {
  const r = await db.query(`UPDATE authorization_grants SET used_at = $2 WHERE id = $1 AND used_at IS NULL`, [
    grantId,
    now,
  ]);
  return (r.rowCount ?? 0) === 1;
}
