import { Router } from 'express';
import { ListQuery, Uuid } from '@shared/schemas/common';
import type { Pool } from '../../db/pool';
import { parseId, sendPage } from '../../lib/http';
import { requirePermission } from '../../middleware/auth';
import * as service from './service';

const CustomerListQuery = ListQuery.extend({ groupId: Uuid.optional() });

export function customerRoutes({ pool }: { pool: Pool }): Router {
  const router = Router();

  router.get('/customers', requirePermission('customers.read'), async (req, res) => {
    sendPage(res, await service.list(pool, CustomerListQuery.parse(req.query)));
  });
  router.get('/customers/:id', requirePermission('customers.read'), async (req, res) => {
    res.json({ data: await service.get(pool, parseId(req.params.id, 'Pelanggan')) });
  });
  router.post('/customers', requirePermission('customers.write'), async (req, res) => {
    res.status(201).json({ data: await service.create(pool, req.ctx, req.body) });
  });
  router.put('/customers/:id', requirePermission('customers.write'), async (req, res) => {
    res.json({ data: await service.update(pool, req.ctx, parseId(req.params.id, 'Pelanggan'), req.body) });
  });
  router.delete('/customers/:id', requirePermission('customers.write'), async (req, res) => {
    await service.remove(pool, req.ctx, parseId(req.params.id, 'Pelanggan'));
    res.status(204).end();
  });

  return router;
}
