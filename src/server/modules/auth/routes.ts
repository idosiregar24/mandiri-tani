import { Router, type RequestHandler } from 'express';
import type { Pool } from '../../db/pool';
import { rateLimit } from '../../lib/rate-limit';
import * as auth from './service';

const MINUTE = 60_000;

/** Login & authorize: 10/minute/IP (security-standards §4). */
const perIp = (name: string): RequestHandler =>
  rateLimit({
    limit: 10,
    windowMs: MINUTE,
    key: (req) => `${name}:${req.ip ?? '-'}`,
    message: 'Terlalu sering mencoba. Tunggu 1 menit lalu coba lagi.',
  });

/**
 * Routes the hub window uses before anyone is logged in. Mounted behind requireLocalAccess(),
 * so they work only from this PC's own app window (S2-1).
 */
export function authHubRoutes({ pool }: { pool: Pool }): Router {
  const router = Router();
  router.get('/auth/login-users', async (_req, res) => {
    res.json({ data: await auth.loginUsers(pool) });
  });
  router.post('/auth/login', perIp('login'), async (req, res) => {
    const result = await auth.login(pool, req.body, {
      deviceId: req.hubDeviceId!,
      ip: req.ip ?? null,
      requestId: req.id,
    });
    res.status(201).json({ data: result });
  });
  return router;
}

/** Routes for a logged-in user (mounted after authenticate()). */
export function authSessionRoutes({ pool }: { pool: Pool }): Router {
  const router = Router();
  router.get('/auth/me', (req, res) => {
    const { userId, username, fullName, role, loginMethod } = req.ctx;
    res.json({ data: { user: { id: userId, username, fullName, role }, method: loginMethod } });
  });
  router.post('/auth/logout', async (req, res) => {
    await auth.logout(pool, req.ctx);
    res.status(204).end();
  });
  router.post('/auth/authorize', perIp('authorize'), async (req, res) => {
    res.status(201).json({ data: await auth.authorize(pool, req.body, req.ctx) });
  });
  return router;
}
