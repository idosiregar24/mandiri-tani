import { Router } from 'express';
import { ListQuery } from '@shared/schemas/common';
import type { Pool } from '../../db/pool';
import { parseId, sendPage } from '../../lib/http';
import { requirePermission } from '../../middleware/auth';
import * as service from './service';

export function supplierRoutes({ pool }: { pool: Pool }): Router {
  const router = Router();

  router.get('/suppliers', requirePermission('suppliers.read'), async (req, res) => {
    sendPage(res, await service.list(pool, ListQuery.parse(req.query)));
  });
  router.get('/suppliers/:id', requirePermission('suppliers.read'), async (req, res) => {
    res.json({ data: await service.get(pool, parseId(req.params.id, 'Supplier')) });
  });
  router.post('/suppliers', requirePermission('suppliers.write'), async (req, res) => {
    res.status(201).json({ data: await service.create(pool, req.body) });
  });
  router.put('/suppliers/:id', requirePermission('suppliers.write'), async (req, res) => {
    res.json({ data: await service.update(pool, parseId(req.params.id, 'Supplier'), req.body) });
  });
  router.delete('/suppliers/:id', requirePermission('suppliers.write'), async (req, res) => {
    await service.remove(pool, req.ctx, parseId(req.params.id, 'Supplier'));
    res.status(204).end();
  });

  return router;
}
