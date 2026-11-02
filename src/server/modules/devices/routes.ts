import { Router } from 'express';
import { PairDeviceInput, PairingCodeInput } from '@shared/schemas/devices';
import type { Pool } from '../../db/pool';
import { parseId } from '../../lib/http';
import { requirePermission } from '../../middleware/auth';
import * as service from './service';

export function devicePublicRoutes({ pool }: { pool: Pool }): Router {
  const router = Router();
  // Pairing is called by an unauthenticated mobile device that scanned or entered the code
  router.post('/devices/pair', async (req, res) => {
    const input = PairDeviceInput.parse(req.body);
    res.status(201).json({ data: await service.pair(pool, input) });
  });
  return router;
}

export function deviceProtectedRoutes({ pool }: { pool: Pool }): Router {
  const router = Router();
  const manage = requirePermission('devices.manage');

  router.get('/devices', manage, async (_req, res) => {
    res.json({ data: await service.list(pool) });
  });

  router.get('/devices/network-info', manage, async (_req, res) => {
    res.json({ data: service.getNetworkInfo() });
  });

  router.post('/devices/pairing-codes', manage, async (req, res) => {
    const input = PairingCodeInput.parse(req.body);
    res.status(201).json({ data: await service.createPairingCode(pool, req.ctx, input) });
  });

  router.post('/devices/:id/revoke', manage, async (req, res) => {
    const id = parseId(req.params.id, 'Perangkat');
    await service.revoke(pool, req.ctx, id);
    res.status(204).end();
  });

  return router;
}

