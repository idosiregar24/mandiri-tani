import { Router } from 'express';
import type { Pool } from '../../db/pool';
import { hasPermission } from '@shared/permissions';
import { SyncPullQuery, SyncPushInput } from '@shared/schemas/sync';
import { pull } from './pull';
import { push } from './push';

export function syncRoutes(opts: { pool: Pool }): Router {
  const router = Router();

  // GET /sync/pull
  router.get('/sync/pull', async (req, res) => {
    const query = SyncPullQuery.parse(req.query);
    const canCost = req.ctx ? hasPermission(req.ctx.role, 'cost.read') : false;
    const data = await pull(opts.pool, query, canCost);
    res.json({ data });
  });

  // POST /sync/push
  router.post('/sync/push', async (req, res) => {
    const input = SyncPushInput.parse(req.body);
    const data = await push(opts.pool, req.ctx, input);
    res.json({ data });
  });

  return router;
}

