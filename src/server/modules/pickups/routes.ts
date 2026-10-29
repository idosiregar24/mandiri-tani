import { Router } from 'express';
import type { Pool } from '../../db/pool';
import { idempotencyKey, parseId, sendPage } from '../../lib/http';
import { requirePermission } from '../../middleware/auth';
import * as pickups from './service';

/** /pickups — goods sold earlier leave the warehouse (FR-PKP). Cancel needs pickups.cancel (Owner PIN for KASIR). */
export function pickupRoutes({ pool }: { pool: Pool }): Router {
  const router = Router();
  const read = requirePermission('pickups.read');

  router.get('/pickups/outstanding', read, async (req, res) => {
    res.json({ data: await pickups.outstanding(pool, req.query) });
  });
  router.get('/pickups', read, async (req, res) => {
    sendPage(res, await pickups.list(pool, req.query));
  });
  router.post('/pickups', requirePermission('pickups.create'), async (req, res) => {
    res.status(201).json({ data: await pickups.create(pool, req.ctx, req.body, idempotencyKey(req)) });
  });
  router.get('/pickups/:id', read, async (req, res) => {
    res.json({ data: await pickups.get(pool, parseId(req.params.id, 'Bukti pengambilan')) });
  });
  router.post('/pickups/:id/cancel', requirePermission('pickups.cancel'), async (req, res) => {
    res.json({ data: await pickups.cancel(pool, req.ctx, parseId(req.params.id, 'Bukti pengambilan'), req.body) });
  });
  return router;
}
