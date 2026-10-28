// In-memory sliding-window rate limiter (security-standards §4, sprint-2 S2-9). The API runs in
// one process, so no shared store is needed. Keys are chosen by the caller: per IP for login and
// authorize, per device for the general API.
import type { Request, RequestHandler } from 'express';
import { AppError } from './errors';
import { clock } from './clock';

export interface RateLimitOptions {
  /** Requests allowed inside one window. */
  limit: number;
  windowMs: number;
  key: (req: Request) => string | null;
  message?: string;
}

export function rateLimit({ limit, windowMs, key, message }: RateLimitOptions): RequestHandler {
  const hits = new Map<string, number[]>();
  let lastSweep = 0;
  return (req, res, next) => {
    const k = key(req);
    if (k === null) return next();
    const now = clock.now().getTime();
    const since = now - windowMs;
    if (now - lastSweep > windowMs) {
      // Drop idle keys so the map cannot grow without bound.
      for (const [key, times] of hits) if ((times.at(-1) ?? 0) <= since) hits.delete(key);
      lastSweep = now;
    }
    const times = (hits.get(k) ?? []).filter((t) => t > since);
    if (times.length >= limit) {
      const retryAfter = Math.max(1, Math.ceil((times[0]! + windowMs - now) / 1000));
      res.setHeader('Retry-After', String(retryAfter));
      throw new AppError(
        'RATE_LIMITED',
        message ?? `Terlalu banyak permintaan. Tunggu ${retryAfter} detik lalu coba lagi.`,
        429,
        { retryAfterSeconds: retryAfter },
      );
    }
    times.push(now);
    hits.set(k, times);
    next();
  };
}
