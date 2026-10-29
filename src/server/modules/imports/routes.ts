import { Router } from 'express';
import { parseId } from '../../lib/http';
import { requirePermission } from '../../middleware/auth';
import * as arApImport from './arap-import';
import * as service from './service';
import * as stockImport from './stock-import';
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
  router.post('/imports/ipos/stock/inspect', ipos, async (_req, res) => {
    res.json({ data: await stockImport.inspectStock(deps) });
  });
  router.post('/imports/ipos/stock/commit', ipos, async (req, res) => {
    res.status(201).json({ data: await stockImport.commitStock(deps, req.ctx, req.body) });
  });
  router.post('/imports/ipos/receivables/inspect', ipos, async (_req, res) => {
    res.json({ data: await arApImport.inspectArAp(deps) });
  });
  router.post('/imports/ipos/receivables/commit', ipos, async (req, res) => {
    res.status(201).json({ data: await arApImport.commitArAp(deps, req.ctx, req.body) });
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
