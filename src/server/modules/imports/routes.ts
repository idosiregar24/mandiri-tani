import { Router } from 'express';
import { parseId } from '../../lib/http';
import { requirePermission } from '../../middleware/auth';
import * as service from './service';
import type { ImportDeps } from './service';

/** /imports/… — Owner only: imports.ipos for the iPOS wizard, system.reset_preparation for the reset. */
export function importRoutes(deps: ImportDeps): Router {
  const router = Router();
  const ipos = requirePermission('imports.ipos');

  router.post('/imports/ipos/inspect', ipos, async (_req, res) => {
    res.json({ data: await service.inspect(deps) });
  });
  router.post('/imports/ipos/commit', ipos, async (req, res) => {
    res.status(201).json({ data: await service.commit(deps, req.ctx, req.body) });
  });
  router.get('/imports/batches', ipos, async (_req, res) => {
    res.json({ data: await service.listBatches(deps.pool) });
  });
  router.get('/imports/batches/:id', ipos, async (req, res) => {
    res.json({ data: await service.getBatch(deps.pool, parseId(req.params.id, 'Riwayat impor')) });
  });
  router.post('/imports/reset', requirePermission('system.reset_preparation'), async (req, res) => {
    res.json({ data: await service.resetPreparation(deps, req.ctx, req.body) });
  });

  return router;
}
