import { Router } from 'express';
import type { Pool } from '../../db/pool';
import * as setup from './service';

/** /setup — only from the hub window (mounted behind requireLocalAccess(), sprint-2 S2-1). */
export function setupRoutes({ pool }: { pool: Pool }): Router {
  const router = Router();
  router.get('/setup/status', async (_req, res) => {
    res.json({ data: await setup.status(pool) });
  });
  router.post('/setup', async (req, res) => {
    const result = await setup.setup(pool, req.body, {
      deviceId: req.hubDeviceId!,
      ip: req.ip ?? null,
      requestId: req.id,
    });
    res.status(201).json({ data: result });
  });
  return router;
}
