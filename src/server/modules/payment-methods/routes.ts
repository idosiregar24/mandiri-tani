import { Router } from 'express';
import type { Pool } from '../../db/pool';
import { parseId } from '../../lib/http';
import { requirePermission } from '../../middleware/auth';
import * as service from './service';

/** /cash-accounts (bank accounts) and /payment-methods. Read: sales.create (cashier needs them), write: settings.write. */
export function paymentMethodRoutes({ pool }: { pool: Pool }): Router {
  const router = Router();
  const read = requirePermission('sales.create');
  const write = requirePermission('settings.write');

  router.get('/cash-accounts', read, async (_req, res) => {
    res.json({ data: await service.listAccounts(pool) });
  });
  router.post('/cash-accounts', write, async (req, res) => {
    res.status(201).json({ data: await service.createBankAccount(pool, req.body) });
  });
  router.put('/cash-accounts/:id', write, async (req, res) => {
    res.json({ data: await service.updateBankAccount(pool, parseId(req.params.id, 'Rekening'), req.body) });
  });
  router.delete('/cash-accounts/:id', write, async (req, res) => {
    await service.deleteBankAccount(pool, req.ctx, parseId(req.params.id, 'Rekening'));
    res.status(204).end();
  });

  router.get('/payment-methods', read, async (_req, res) => {
    res.json({ data: await service.listMethods(pool) });
  });
  router.post('/payment-methods', write, async (req, res) => {
    res.status(201).json({ data: await service.createMethod(pool, req.body) });
  });
  router.put('/payment-methods/:id', write, async (req, res) => {
    res.json({ data: await service.updateMethod(pool, parseId(req.params.id, 'Metode bayar'), req.body) });
  });
  router.delete('/payment-methods/:id', write, async (req, res) => {
    await service.deleteMethod(pool, req.ctx, parseId(req.params.id, 'Metode bayar'));
    res.status(204).end();
  });

  return router;
}
