// Authentication + permission checks (security-standards §1–2, sprint-2 S2-1…S2-6).
//
// Every business endpoint needs a SESSION token (Authorization: Bearer). The LOCAL ACCESS KEY
// (a random key the main process creates at every start and hands only to its own window) no
// longer acts as a user: it only proves "this request comes from the hub PC's window" and opens
// the few routes needed before anyone is logged in (setup wizard, login screen). There is
// deliberately no IP/localhost exception anywhere.
import { createHash, timingSafeEqual } from 'node:crypto';
import type { RequestHandler } from 'express';
import { hasPermission, OWNER_AUTHORIZABLE, type Permission, type Role } from '@shared/permissions';
import type { LoginMethod } from '@shared/schemas/auth';
import type { Pool } from '../db/pool';
import { AppError } from '../lib/errors';
import { resolveSession, useGrant } from '../modules/auth/service';

export interface RequestCtx {
  role: Role;
  userId: string;
  username: string;
  fullName: string;
  deviceId: string;
  sessionId: string;
  loginMethod: LoginMethod;
  via: 'SESSION';
  requestId: string;
  ip: string | null;
  /** Set when an Owner-PIN grant authorized this request (FR-POS-20) → audit_logs.approved_by. */
  approvedBy: string | null;
}

declare module 'express-serve-static-core' {
  interface Request {
    ctx: RequestCtx;
    /** Set by requireLocalAccess(): the hub device (K01) this window runs on. */
    hubDeviceId?: string;
  }
}

export const LOCAL_ACCESS_HEADER = 'x-local-access-key';
export const GRANT_HEADER = 'x-authorization-grant';

const digest = (value: string) => createHash('sha256').update(value).digest();

/** Constant-time check of the local access key; false when no key is configured. */
function localKeyMatches(expected: Buffer | null, given: string | undefined): boolean {
  if (!expected || !given) return false;
  return timingSafeEqual(digest(given), expected);
}

/** Only for routes the hub window needs before login (S2-1). Sets req.hubDeviceId. */
export function requireLocalAccess(opts: {
  localAccessKey?: string;
  hubDeviceId: () => Promise<string | null>;
}): RequestHandler {
  const expected = opts.localAccessKey ? digest(opts.localAccessKey) : null;
  return async (req, _res, next) => {
    if (!localKeyMatches(expected, req.header(LOCAL_ACCESS_HEADER))) {
      throw new AppError(
        'DEVICE_NOT_ALLOWED',
        'Halaman ini hanya bisa dibuka dari aplikasi di komputer kasir toko.',
        401,
      );
    }
    const hub = await opts.hubDeviceId();
    if (!hub) throw new AppError('DB_UNAVAILABLE', 'Data perangkat belum siap. Tutup lalu buka lagi aplikasinya.', 503);
    req.hubDeviceId = hub;
    next();
  };
}

/** Bearer session token → req.ctx (S2-3). */
export function authenticate(opts: { pool: Pool }): RequestHandler {
  return async (req, _res, next) => {
    const token = /^Bearer\s+(\S+)$/i.exec(req.header('authorization') ?? '')?.[1];
    if (!token) throw new AppError('UNAUTHENTICATED', 'Belum masuk. Silakan masuk dulu.', 401);
    const session = await resolveSession(opts.pool, token);
    if (!session) throw new AppError('UNAUTHENTICATED', 'Sesi berakhir. Silakan masuk lagi.', 401);
    req.ctx = {
      role: session.user.role,
      userId: session.user.id,
      username: session.user.username,
      fullName: session.user.fullName,
      deviceId: session.deviceId,
      sessionId: session.sessionId,
      loginMethod: session.method,
      via: 'SESSION',
      requestId: req.id,
      ip: req.ip ?? null,
      approvedBy: null,
    };
    next();
  };
}

/**
 * Route guard. A KASIR asking for an Owner-authorizable permission (PRD §4.2 "⛔ otorisasi")
 * gets 423 AUTHORIZATION_REQUIRED, then retries with X-Authorization-Grant (S2-6).
 */
export function requirePermission(permission: Permission): RequestHandler {
  return async (req, _res, next) => {
    if (!req.ctx) throw new AppError('UNAUTHENTICATED', 'Belum masuk.', 401);
    if (hasPermission(req.ctx.role, permission)) return next();
    if (OWNER_AUTHORIZABLE.includes(permission)) {
      const grant = req.header(GRANT_HEADER);
      if (!grant) {
        throw new AppError('AUTHORIZATION_REQUIRED', 'Aksi ini butuh PIN Owner.', 423, { permission });
      }
      // createApp() puts the pool in app.locals, so no route has to remember to pass it.
      const pool = req.app.locals.pool as Pool;
      req.ctx.approvedBy = await useGrant(pool, grant, {
        permission,
        userId: req.ctx.userId,
        deviceId: req.ctx.deviceId,
      });
      return next();
    }
    throw new AppError('FORBIDDEN', 'Anda tidak punya hak untuk aksi ini.', 403, { permission });
  };
}
