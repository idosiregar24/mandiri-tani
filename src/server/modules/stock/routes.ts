import { Router, type Request } from 'express';
import { StockCardQuery, StockListQuery } from '@shared/schemas/stock';
import { Uuid, z } from '@shared/schemas/common';
import type { Pool } from '../../db/pool';
import { AppError } from '../../lib/errors';
import { parseId } from '../../lib/http';
import { requirePermission } from '../../middleware/auth';
import * as adjustments from './adjustments';
import * as inventory from './inventory';
import * as opnames from './opnames';

const PageQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});

/** Idempotency-Key header (backend-standards §3) — optional, but must be a UUID when sent. */
function idempotencyKey(req: Request): string | null {
  const raw = req.header('idempotency-key');
  if (!raw) return null;
  const r = Uuid.safeParse(raw);
  if (!r.success) throw new AppError('INVALID_IDEMPOTENCY_KEY', 'Idempotency-Key harus berupa UUID.', 400);
  return r.data;
}

/** /stock/… — read: stock.read (KASIR too, without cost); adjustments: stock.adjust; opname: stock.opname. */
export function stockRoutes({ pool }: { pool: Pool }): Router {
  const router = Router();
  const read = requirePermission('stock.read');
  const adjust = requirePermission('stock.adjust');
  const opname = requirePermission('stock.opname');

  router.get('/stock', read, async (req, res) => {
    const r = await inventory.list(pool, req.ctx, StockListQuery.parse(req.query));
    res.json({ data: r.rows, meta: { total: r.total, page: r.page, pageSize: r.pageSize, summary: r.summary } });
  });
  router.get('/stock/consistency', read, async (_req, res) => {
    res.json({ data: await inventory.consistency(pool) });
  });

  // Adjustments (FR-INV-06)
  router.get('/stock/adjustments', adjust, async (req, res) => {
    const q = PageQuery.parse(req.query);
    const r = await adjustments.list(pool, req.ctx, q.page, q.pageSize);
    res.json({ data: r.rows, meta: { total: r.total, page: r.page, pageSize: r.pageSize } });
  });
  router.post('/stock/adjustments', adjust, async (req, res) => {
    res.status(201).json({ data: await adjustments.create(pool, req.ctx, req.body, idempotencyKey(req)) });
  });
  router.get('/stock/adjustments/:id', adjust, async (req, res) => {
    res.json({ data: await adjustments.get(pool, req.ctx, parseId(req.params.id, 'Penyesuaian stok')) });
  });

  // Stock opname (FR-INV-05)
  router.get('/stock/opnames', opname, async (req, res) => {
    const q = PageQuery.parse(req.query);
    const r = await opnames.list(pool, q.page, q.pageSize);
    res.json({ data: r.rows, meta: { total: r.total, page: r.page, pageSize: r.pageSize } });
  });
  router.post('/stock/opnames', opname, async (req, res) => {
    res.status(201).json({ data: await opnames.create(pool, req.ctx, req.body) });
  });
  router.get('/stock/opnames/:id', opname, async (req, res) => {
    res.json({ data: await opnames.get(pool, req.ctx, parseId(req.params.id, 'Stok opname')) });
  });
  router.put('/stock/opnames/:id/lines', opname, async (req, res) => {
    res.json({ data: await opnames.count(pool, req.ctx, parseId(req.params.id, 'Stok opname'), req.body) });
  });
  router.delete('/stock/opnames/:id/lines/:lineId', opname, async (req, res) => {
    res.json({
      data: await opnames.removeLine(
        pool,
        req.ctx,
        parseId(req.params.id, 'Stok opname'),
        parseId(req.params.lineId, 'Baris hitungan'),
      ),
    });
  });
  router.post('/stock/opnames/:id/post', opname, async (req, res) => {
    res.json({ data: await opnames.post(pool, req.ctx, parseId(req.params.id, 'Stok opname')) });
  });
  router.post('/stock/opnames/:id/cancel', opname, async (req, res) => {
    res.json({ data: await opnames.cancel(pool, req.ctx, parseId(req.params.id, 'Stok opname')) });
  });

  // Per product (after the fixed paths above)
  router.get('/stock/:productId/card', read, async (req, res) => {
    res.json({
      data: await inventory.card(
        pool,
        req.ctx,
        parseId(req.params.productId, 'Barang'),
        StockCardQuery.parse(req.query),
      ),
    });
  });
  router.get('/stock/:productId/layers', requirePermission('cost.read'), async (req, res) => {
    res.json({ data: await inventory.layers(pool, parseId(req.params.productId, 'Barang')) });
  });

  return router;
}
