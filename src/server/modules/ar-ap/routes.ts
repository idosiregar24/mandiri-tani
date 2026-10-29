import { Router } from 'express';
import type { Pool } from '../../db/pool';
import { idempotencyKey, parseId } from '../../lib/http';
import { requirePermission } from '../../middleware/auth';
import * as arAp from './service';

/**
 * Receivables (ar.payment — KASIR collects at the counter too) and payables (ap.payment, Owner).
 * Opening balances: customers.write / purchases.write (Owner).
 */
export function arApRoutes({ pool }: { pool: Pool }): Router {
  const router = Router();
  const ar = requirePermission('ar.payment');
  const ap = requirePermission('ap.payment');

  router.get('/receivables/summary', ar, async (req, res) => {
    const { rows, totals, ...meta } = await arAp.aging(pool, 'AR', req.query);
    res.json({ data: rows, meta: { ...meta, totals } });
  });
  router.get('/receivables', ar, async (req, res) => {
    res.json({ data: await arAp.openDocs(pool, 'AR', parseId(req.query.customerId, 'Pelanggan')) });
  });
  router.post('/receivables/opening', requirePermission('customers.write'), async (req, res) => {
    res.status(201).json({ data: await arAp.addOpening(pool, req.ctx, 'AR', req.body) });
  });
  router.get('/receivable-payments', ar, async (req, res) => {
    res.json({ data: await arAp.listPayments(pool, 'AR', parseId(req.query.customerId, 'Pelanggan')) });
  });
  router.post('/receivable-payments', ar, async (req, res) => {
    res.status(201).json({ data: await arAp.pay(pool, req.ctx, 'AR', req.body, idempotencyKey(req)) });
  });
  router.get('/receivable-payments/:id', ar, async (req, res) => {
    res.json({ data: await arAp.getPayment(pool, 'AR', parseId(req.params.id, 'Pembayaran piutang')) });
  });

  router.get('/payables/summary', ap, async (req, res) => {
    const { rows, totals, ...meta } = await arAp.aging(pool, 'AP', req.query);
    res.json({ data: rows, meta: { ...meta, totals } });
  });
  router.get('/payables', ap, async (req, res) => {
    res.json({ data: await arAp.openDocs(pool, 'AP', parseId(req.query.supplierId, 'Supplier')) });
  });
  router.post('/payables/opening', requirePermission('purchases.write'), async (req, res) => {
    res.status(201).json({ data: await arAp.addOpening(pool, req.ctx, 'AP', req.body) });
  });
  router.get('/payable-payments', ap, async (req, res) => {
    res.json({ data: await arAp.listPayments(pool, 'AP', parseId(req.query.supplierId, 'Supplier')) });
  });
  // payable_payments has no client_op_id in the schema: no Idempotency-Key here (sprint-9 S9-3).
  router.post('/payable-payments', ap, async (req, res) => {
    res.status(201).json({ data: await arAp.pay(pool, req.ctx, 'AP', req.body, null) });
  });
  router.get('/payable-payments/:id', ap, async (req, res) => {
    res.json({ data: await arAp.getPayment(pool, 'AP', parseId(req.params.id, 'Pembayaran hutang')) });
  });
  return router;
}
