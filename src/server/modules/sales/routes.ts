import { Router } from 'express';
import type { Pool } from '../../db/pool';
import { idempotencyKey, parseId, sendPage } from '../../lib/http';
import { GRANT_HEADER, requirePermission } from '../../middleware/auth';
import * as held from './held';
import * as returns from './returns';
import * as sales from './service';

/** /sales — complete (sales.create), history, void (sales.void → Owner PIN for KASIR). */
export function salesRoutes({ pool }: { pool: Pool }): Router {
  const router = Router();

  router.post('/sales', requirePermission('sales.create'), async (req, res) => {
    const sale = await sales.complete(pool, req.ctx, req.body, {
      idempotencyKey: idempotencyKey(req),
      grant: req.header(GRANT_HEADER) ?? null,
    });
    res.status(201).json({ data: sale });
  });

  // Held notes (FR-POS-08) — before /sales/:id so "held" is not read as an id.
  router.post('/sales/held', requirePermission('sales.hold'), async (req, res) => {
    res.status(201).json({ data: await held.hold(pool, req.ctx, req.body) });
  });
  router.get('/sales/held', requirePermission('sales.hold'), async (_req, res) => {
    res.json({ data: await held.listHeld(pool) });
  });
  router.post('/sales/held/:id/recall', requirePermission('sales.hold'), async (req, res) => {
    res.json({ data: await held.recall(pool, parseId(req.params.id, 'Nota tertahan')) });
  });

  router.get('/sales', requirePermission('sales.create'), async (req, res) => {
    sendPage(res, await sales.list(pool, req.ctx, req.query));
  });

  router.get('/sales/:id', requirePermission('sales.create'), async (req, res) => {
    res.json({ data: await sales.get(pool, req.ctx, parseId(req.params.id, 'Nota')) });
  });

  router.post('/sales/:id/returns', requirePermission('sales.return'), async (req, res) => {
    const id = parseId(req.params.id, 'Nota');
    res.status(201).json({ data: await returns.createReturn(pool, req.ctx, id, req.body, idempotencyKey(req)) });
  });

  router.post('/sales/:id/void', requirePermission('sales.void'), async (req, res) => {
    res.json({ data: await sales.voidSale(pool, req.ctx, parseId(req.params.id, 'Nota'), req.body) });
  });

  return router;
}
