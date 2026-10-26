import { Router } from 'express';
import { ProductListQuery } from '@shared/schemas/master';
import type { Pool } from '../../db/pool';
import { parseId, sendPage } from '../../lib/http';
import { requirePermission } from '../../middleware/auth';
import * as service from './service';

export function productRoutes({ pool }: { pool: Pool }): Router {
  const router = Router();

  router.get('/products', requirePermission('products.read'), async (req, res) => {
    sendPage(res, await service.list(pool, ProductListQuery.parse(req.query)));
  });
  router.get('/products/:id', requirePermission('products.read'), async (req, res) => {
    res.json({ data: await service.get(pool, parseId(req.params.id, 'Barang')) });
  });
  // Saving a product package also writes its prices → needs both permissions.
  router.post('/products', requirePermission('products.write'), requirePermission('prices.write'), async (req, res) => {
    res.status(201).json({ data: await service.create(pool, req.ctx, req.body) });
  });
  router.put(
    '/products/:id',
    requirePermission('products.write'),
    requirePermission('prices.write'),
    async (req, res) => {
      res.json({ data: await service.update(pool, req.ctx, parseId(req.params.id, 'Barang'), req.body) });
    },
  );
  router.delete('/products/:id', requirePermission('products.write'), async (req, res) => {
    await service.remove(pool, req.ctx, parseId(req.params.id, 'Barang'));
    res.status(204).end();
  });

  return router;
}
