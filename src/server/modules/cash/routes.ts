import { Router } from 'express';
import type { Pool } from '../../db/pool';
import { parseId, sendPage } from '../../lib/http';
import { requirePermission } from '../../middleware/auth';
import * as cash from './service';

/**
 * Cash book (sprint-10 S10-7). Both roles record cash in/out (cash.in / cash.out — the cashier only
 * in the drawer, enforced in the service); expense categories are managed by the Owner.
 */
export function cashRoutes({ pool }: { pool: Pool }): Router {
  const router = Router();
  const read = requirePermission('cash.in');
  const cashIn = requirePermission('cash.in');
  const cashOut = requirePermission('cash.out');

  router.get('/cash/balances', read, async (req, res) => {
    res.json({ data: await cash.balances(pool, req.ctx) });
  });
  router.get('/cash-transactions', read, async (req, res) => {
    sendPage(res, await cash.list(pool, req.ctx, req.query));
  });
  router.get('/cash-transactions/:id', read, async (req, res) => {
    res.json({ data: await cash.get(pool, parseId(req.params.id, 'Transaksi kas')) });
  });
  router.post(
    '/cash-transactions',
    (req, res, next) => ((req.body as { direction?: string })?.direction === 'OUT' ? cashOut : cashIn)(req, res, next),
    async (req, res) => {
      res.status(201).json({ data: await cash.addEntry(pool, req.ctx, req.body) });
    },
  );
  router.post('/cash-transfers', cashOut, async (req, res) => {
    res.status(201).json({ data: await cash.transfer(pool, req.ctx, req.body) });
  });

  router.get('/cash-categories', read, async (_req, res) => {
    res.json({ data: await cash.categories(pool) });
  });
  router.post('/cash-categories', requirePermission('masters.write'), async (req, res) => {
    res.status(201).json({ data: await cash.addCategory(pool, req.ctx, req.body) });
  });
  router.put('/cash-categories/:id', requirePermission('masters.write'), async (req, res) => {
    res.json({ data: await cash.updateCategory(pool, req.ctx, parseId(req.params.id, 'Kategori kas'), req.body) });
  });
  return router;
}
