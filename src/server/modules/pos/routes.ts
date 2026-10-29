import { Router } from 'express';
import { LastPriceQuery, PosLookupQuery, PosSearchQuery } from '@shared/schemas/pos';
import type { Pool } from '../../db/pool';
import { AppError } from '../../lib/errors';
import { requirePermission } from '../../middleware/auth';
import * as repo from './repo';

/** /pos/… — cashier-screen lookups (sprint-5 S5-2). KASIR and OWNER; never any cost field. */
export function posRoutes({ pool }: { pool: Pool }): Router {
  const router = Router();
  const read = requirePermission('products.read');

  router.get('/pos/products', read, async (req, res) => {
    const { q } = PosSearchQuery.parse(req.query);
    res.json({ data: await repo.search(pool, q) });
  });

  router.get('/pos/lookup', read, async (req, res) => {
    const { code } = PosLookupQuery.parse(req.query);
    const hit = await repo.lookup(pool, code);
    if (!hit) {
      throw new AppError(
        'PRODUCT_NOT_FOUND',
        `Barang dengan kode "${code}" tidak ditemukan. Cari dengan nama barang.`,
        404,
        {
          code,
        },
      );
    }
    res.json({ data: hit });
  });

  // FR-POS-27: what this customer paid last time (Faktur price negotiation).
  router.get('/pos/last-prices', read, async (req, res) => {
    const q = LastPriceQuery.parse(req.query);
    res.json({ data: await repo.lastPrices(pool, q.customerId, q.productUnitId) });
  });

  return router;
}
