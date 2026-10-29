import { Router } from 'express';
import { PosSettings, StoreSettings } from '@shared/schemas/settings';
import type { Pool } from '../../db/pool';
import { requirePermission } from '../../middleware/auth';

/** Settings the cashier screen needs to print (receipt header) and to warn early (limits). */
export function settingsRoutes({ pool }: { pool: Pool }): Router {
  const router = Router();
  router.get('/settings/receipt', requirePermission('sales.create'), async (_req, res) => {
    const r = await pool.query<{ key: string; value: unknown }>(
      `SELECT key, value FROM settings WHERE key IN ('store','pos')`,
    );
    const byKey = new Map(r.rows.map((x) => [x.key, x.value]));
    const store = StoreSettings.safeParse(byKey.get('store'));
    res.json({
      data: {
        store: store.success ? store.data : { name: 'Toko', address: null, phone: null },
        pos: PosSettings.parse(byKey.get('pos') ?? {}),
      },
    });
  });
  return router;
}
