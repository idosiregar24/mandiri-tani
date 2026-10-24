import { Router } from 'express';
import { poolStats, type Pool } from '../../db/pool';

export interface HealthDeps {
  pool: Pool;
  appVersion: string;
}

/** GET /api/v1/health — no auth (FR-SRV-02): lets clients find the hub and see DB state. */
export function healthRoutes({ pool, appVersion }: HealthDeps): Router {
  const router = Router();
  router.get('/health', async (_req, res) => {
    let db: { ok: boolean; latency_ms?: number; version?: string; error?: string };
    const started = Date.now();
    try {
      const { rows } = await pool.query<{ v: string }>("SELECT current_setting('server_version') AS v");
      db = { ok: true, latency_ms: Date.now() - started, version: rows[0]?.v };
    } catch (err) {
      db = { ok: false, error: (err as Error).message };
    }
    res.status(db.ok ? 200 : 503).json({
      data: {
        app: 'mandiri-tani-pos',
        version: appVersion,
        server_time: new Date().toISOString(),
        db,
        pool: poolStats(pool),
      },
    });
  });
  return router;
}
