// Authentication + permission checks (security-standards §1–2).
//
// Until Sprint 2 (login & sessions) the only credential is the LOCAL ACCESS KEY
// (sprint-3 decision S3-1): a random token the main process creates at every start and
// hands only to its own window over IPC. It acts as OWNER on the hub device. Anything
// else on the network gets 401 — there is deliberately no IP/localhost exception.
import { createHash, timingSafeEqual } from 'node:crypto';
import type { RequestHandler } from 'express';
import { hasPermission, type Permission, type Role } from '@shared/permissions';
import { AppError } from '../lib/errors';

export interface RequestCtx {
  role: Role;
  /** null while acting through the local access key (no accounts before Sprint 2). */
  userId: string | null;
  deviceId: string | null;
  via: 'LOCAL_ACCESS_KEY';
  requestId: string;
}

declare module 'express-serve-static-core' {
  interface Request {
    ctx: RequestCtx;
  }
}

const digest = (value: string) => createHash('sha256').update(value).digest();

export function authenticate(opts: {
  localAccessKey?: string;
  hubDeviceId: () => Promise<string | null>;
}): RequestHandler {
  const expected = opts.localAccessKey ? digest(opts.localAccessKey) : null;
  return async (req, _res, next) => {
    const header = req.header('authorization') ?? '';
    const token = /^Bearer\s+(\S+)$/i.exec(header)?.[1];
    if (!token) throw new AppError('UNAUTHENTICATED', 'Belum masuk. Buka aplikasi kasir di komputer toko.', 401);
    // Compare digests so the comparison is constant-time regardless of token length.
    if (!expected || !timingSafeEqual(digest(token), expected)) {
      throw new AppError('UNAUTHENTICATED', 'Kunci akses tidak berlaku. Muat ulang aplikasi.', 401);
    }
    req.ctx = {
      role: 'OWNER',
      userId: null,
      deviceId: await opts.hubDeviceId(),
      via: 'LOCAL_ACCESS_KEY',
      requestId: req.id,
    };
    next();
  };
}

export function requirePermission(permission: Permission): RequestHandler {
  return (req, _res, next) => {
    if (!req.ctx) throw new AppError('UNAUTHENTICATED', 'Belum masuk.', 401);
    if (!hasPermission(req.ctx.role, permission)) {
      throw new AppError('FORBIDDEN', 'Anda tidak punya hak untuk aksi ini.', 403, { permission });
    }
    next();
  };
}
