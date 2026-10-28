// Login, sessions and Owner-PIN authorization (FR-SYS-03, FR-POS-20; sprint-2 S2-2…S2-6).
import { createHash, randomBytes } from 'node:crypto';
import { hasPermission, OWNER_AUTHORIZABLE, type Permission } from '@shared/permissions';
import {
  AuthorizeInput,
  LoginInput,
  type AuthorizationGrantResult,
  type LoginMethod,
  type LoginResult,
  type LoginUserCard,
  type SessionUser,
} from '@shared/schemas/auth';
import { uuidv7 } from '@shared/uuid';
import type { Pool } from '../../db/pool';
import { withClient, withTransaction } from '../../db/tx';
import { recordAudit } from '../../lib/audit';
import { clock } from '../../lib/clock';
import { AppError } from '../../lib/errors';
import { burnVerify, verifySecret } from '../../lib/passwords';
import * as repo from './repo';

const MINUTE = 60_000;
export const MAX_FAILED_ATTEMPTS = 5;
export const LOCK_MS = 5 * MINUTE;
/** Idle timeout per login method (security-standards §1): cashier 12 h, back office 8 h. */
export const IDLE_MS: Record<LoginMethod, number> = { PIN: 12 * 60 * MINUTE, PASSWORD: 8 * 60 * MINUTE };
/** last_used_at / expires_at are written at most this often per session. */
const TOUCH_EVERY_MS = MINUTE;
export const GRANT_TTL_MS = 2 * MINUTE;

const sha256 = (v: string) => createHash('sha256').update(v).digest('hex');
const newToken = () => randomBytes(32).toString('base64url');

export interface ClientInfo {
  deviceId: string;
  ip: string | null;
  requestId: string;
}

const badCredentials = (method: LoginMethod) =>
  new AppError(
    'INVALID_CREDENTIALS',
    method === 'PIN' ? 'Username atau PIN salah.' : 'Username atau password salah.',
    401,
  );

function lockedError(until: Date, now: Date): AppError {
  const minutes = Math.max(1, Math.ceil((until.getTime() - now.getTime()) / MINUTE));
  return new AppError(
    'ACCOUNT_LOCKED',
    `Akun dikunci sementara karena salah ${MAX_FAILED_ATTEMPTS} kali. Coba lagi dalam ${minutes} menit.`,
    429,
    { lockedUntil: until.toISOString(), minutes },
  );
}

type Checked =
  | { ok: true; user: repo.CredentialRow }
  | { ok: false; error: AppError; user: repo.CredentialRow | null; lockedNow: Date | null };

/**
 * Verifies username + secret with the lockout rules (S2-4), inside `tx`. A failure is returned,
 * not thrown, so the caller can commit the failure counter and its audit row before replying.
 */
async function checkSecret(
  tx: Parameters<typeof repo.findCredentials>[0],
  username: string,
  method: LoginMethod,
  secret: string,
  now: Date,
): Promise<Checked> {
  const user = await repo.findCredentials(tx, username);
  const hashed = user ? (method === 'PIN' ? user.pinHash : user.passwordHash) : null;
  if (!user || !user.isActive || !hashed) {
    await burnVerify(secret); // same cost as a real check: the reply time does not reveal the username
    return { ok: false, error: badCredentials(method), user: user?.isActive ? user : null, lockedNow: null };
  }
  if (user.lockedUntil && user.lockedUntil > now) {
    return { ok: false, error: lockedError(user.lockedUntil, now), user, lockedNow: null };
  }
  if (!(await verifySecret(hashed, secret))) {
    const lockedNow = await repo.recordFailure(tx, user.id, MAX_FAILED_ATTEMPTS, new Date(now.getTime() + LOCK_MS));
    return { ok: false, error: lockedNow ? lockedError(lockedNow, now) : badCredentials(method), user, lockedNow };
  }
  return { ok: true, user };
}

export async function login(pool: Pool, body: unknown, client: ClientInfo): Promise<LoginResult> {
  const input = LoginInput.parse(body);
  const now = clock.now();
  const outcome = await withTransaction(pool, async (tx) => {
    const checked = await checkSecret(tx, input.username, input.method, input.secret, now);
    const actor = {
      userId: checked.user?.id ?? null,
      deviceId: client.deviceId,
      requestId: client.requestId,
      ip: client.ip,
    };
    if (!checked.ok) {
      // Committed before replying: the counter and the trail must survive the error (NFR-SEC-05).
      await recordAudit(tx, actor, {
        action: 'auth.login_failed',
        entity: 'user',
        entityId: checked.user?.id ?? null,
        after: { username: input.username, method: input.method, reason: checked.error.code },
      });
      if (checked.lockedNow) {
        await recordAudit(tx, actor, {
          action: 'auth.locked',
          entity: 'user',
          entityId: checked.user!.id,
          after: { lockedUntil: checked.lockedNow.toISOString() },
        });
      }
      return { error: checked.error } as const;
    }
    const user = checked.user;
    await repo.recordSuccess(tx, user.id, now);
    const token = newToken();
    const expiresAt = new Date(now.getTime() + IDLE_MS[input.method]);
    const sessionId = uuidv7();
    await repo.insertSession(tx, {
      id: sessionId,
      userId: user.id,
      deviceId: client.deviceId,
      tokenHash: sha256(token),
      method: input.method,
      ip: client.ip,
      expiresAt,
      now,
    });
    await recordAudit(tx, actor, {
      action: 'auth.login',
      entity: 'session',
      entityId: sessionId,
      after: { method: input.method },
    });
    const result: LoginResult = {
      token,
      expiresAt: expiresAt.toISOString(),
      method: input.method,
      user: { id: user.id, username: user.username, fullName: user.fullName, role: user.role },
    };
    return { result } as const;
  });
  if ('error' in outcome) throw outcome.error;
  return outcome.result;
}

export interface ResolvedSession {
  sessionId: string;
  deviceId: string;
  method: LoginMethod;
  user: SessionUser;
}

/** Bearer token → live session, sliding its idle timeout (S2-3). Null = 401. */
export async function resolveSession(pool: Pool, token: string): Promise<ResolvedSession | null> {
  const now = clock.now();
  const s = await repo.findSession(pool, sha256(token), now);
  if (!s) return null;
  if (!s.lastUsedAt || now.getTime() - s.lastUsedAt.getTime() >= TOUCH_EVERY_MS) {
    await repo.touchSession(pool, s.sessionId, now, new Date(now.getTime() + IDLE_MS[s.method]));
  }
  return {
    sessionId: s.sessionId,
    deviceId: s.deviceId,
    method: s.method,
    user: { id: s.userId, username: s.username, fullName: s.fullName, role: s.role },
  };
}

export async function logout(
  pool: Pool,
  ctx: { sessionId: string; userId: string; deviceId: string; requestId: string; ip?: string | null },
): Promise<void> {
  await withTransaction(pool, async (tx) => {
    await repo.revokeSession(tx, ctx.sessionId, clock.now());
    await recordAudit(tx, ctx, { action: 'auth.logout', entity: 'session', entityId: ctx.sessionId });
  });
}

export async function loginUsers(pool: Pool): Promise<LoginUserCard[]> {
  const rows = await withClient(pool, (db) => repo.listLoginUsers(db));
  return rows.map((u) => ({
    id: u.id,
    username: u.username,
    fullName: u.fullName,
    role: u.role,
    // Cashiers use the PIN pad first; the Owner's back office starts with the password.
    methods: (u.role === 'KASIR' ? (['PIN', 'PASSWORD'] as const) : (['PASSWORD', 'PIN'] as const)).filter((m) =>
      m === 'PIN' ? u.hasPin : u.hasPassword,
    ),
  }));
}

/**
 * POST /auth/authorize — the Owner types username + PIN on the cashier's screen. Returns a
 * one-shot grant bound to the permission, the device and the requesting user (S2-6).
 */
export async function authorize(
  pool: Pool,
  body: unknown,
  ctx: { userId: string; deviceId: string; requestId: string; ip?: string | null },
): Promise<AuthorizationGrantResult> {
  const input = AuthorizeInput.parse(body);
  const now = clock.now();
  const outcome = await withTransaction(pool, async (tx) => {
    const checked = await checkSecret(tx, input.username, 'PIN', input.pin, now);
    if (!checked.ok) {
      await recordAudit(tx, ctx, {
        action: 'auth.authorize_failed',
        entity: 'user',
        entityId: checked.user?.id ?? null,
        after: { username: input.username, permission: input.permission, reason: checked.error.code },
      });
      if (checked.lockedNow) {
        await recordAudit(tx, ctx, {
          action: 'auth.locked',
          entity: 'user',
          entityId: checked.user!.id,
          after: { lockedUntil: checked.lockedNow.toISOString() },
        });
      }
      return { error: checked.error } as const;
    }
    const granter = checked.user;
    if (!hasPermission(granter.role, input.permission)) {
      return {
        error: new AppError('FORBIDDEN', 'Otorisasi harus dari Owner.', 403, { permission: input.permission }),
      } as const;
    }
    await repo.recordSuccess(tx, granter.id, now);
    const grant = newToken();
    const expiresAt = new Date(now.getTime() + GRANT_TTL_MS);
    const grantId = uuidv7();
    await repo.insertGrant(tx, {
      id: grantId,
      tokenHash: sha256(grant),
      permission: input.permission,
      grantedBy: granter.id,
      requestedBy: ctx.userId,
      deviceId: ctx.deviceId,
      expiresAt,
    });
    await recordAudit(
      tx,
      { ...ctx, approvedBy: granter.id },
      {
        action: 'auth.authorize',
        entity: 'authorization_grant',
        entityId: grantId,
        after: { permission: input.permission },
      },
    );
    const result: AuthorizationGrantResult = {
      grant,
      permission: input.permission,
      expiresAt: expiresAt.toISOString(),
      grantedBy: { id: granter.id, fullName: granter.fullName },
    };
    return { result } as const;
  });
  if ('error' in outcome) throw outcome.error;
  return outcome.result;
}

/**
 * Validates AND uses up an X-Authorization-Grant for one request (S2-6). Used atomically when the
 * request arrives: a grant can never serve two requests, even if the first one then fails.
 * Returns the granting Owner's id (→ audit_logs.approved_by).
 */
export async function useGrant(
  pool: Pool,
  grant: string,
  need: { permission: Permission; userId: string; deviceId: string },
): Promise<string> {
  const now = clock.now();
  const g = await repo.findGrant(pool, sha256(grant));
  const invalid = new AppError(
    'AUTHORIZATION_INVALID',
    'Otorisasi Owner sudah dipakai atau kedaluwarsa. Minta PIN Owner lagi.',
    401,
  );
  if (!g || g.usedAt || g.expiresAt <= now) throw invalid;
  if (g.permission !== need.permission || g.requestedBy !== need.userId || g.deviceId !== need.deviceId) {
    throw new AppError('FORBIDDEN', 'Otorisasi ini untuk aksi lain. Minta PIN Owner untuk aksi ini.', 403, {
      permission: need.permission,
    });
  }
  if (!OWNER_AUTHORIZABLE.includes(need.permission)) throw invalid;
  if (!(await repo.consumeGrant(pool, g.id, now))) throw invalid;
  return g.grantedBy;
}
