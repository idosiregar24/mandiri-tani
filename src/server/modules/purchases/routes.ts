import { Router } from 'express';
import type { Pool } from '../../db/pool';
import { idempotencyKey, parseId, sendPage } from '../../lib/http';
import { requirePermission } from '../../middleware/auth';
import * as purchases from './service';

/** /purchases — Owner only (S8-6): read purchases.read, write purchases.write. */
export function purchaseRoutes({ pool }: { pool: Pool }): Router {
  const router = Router();
  const read = requirePermission('purchases.read');
  const write = requirePermission('purchases.write');

  router.get('/purchases/price-history', read, async (req, res) => {
    res.json({ data: await purchases.priceHistory(pool, parseId(req.query.productId, 'Barang')) });
  });
  router.get('/purchases', read, async (req, res) => {
    sendPage(res, await purchases.list(pool, req.query));
  });
  router.post('/purchases', write, async (req, res) => {
    res.status(201).json({ data: await purchases.create(pool, req.ctx, req.body, idempotencyKey(req)) });
  });
  router.get('/purchases/:id', read, async (req, res) => {
    res.json({ data: await purchases.get(pool, parseId(req.params.id, 'Faktur pembelian')) });
  });
  router.post('/purchases/:id/returns', write, async (req, res) => {
    const id = parseId(req.params.id, 'Faktur pembelian');
    res.status(201).json({ data: await purchases.createReturn(pool, req.ctx, id, req.body, idempotencyKey(req)) });
  });
  return router;
}
