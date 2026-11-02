import { Router } from 'express';
import type { SystemDiagnostics } from '@shared/schemas/backups';
import { poolStats, type Pool } from '../../db/pool';
import { requirePermission } from '../../middleware/auth';
import { formatBytes, listBackups } from '../backups/service';

export interface HealthDeps {
  pool: Pool;
  appVersion: string;
  backupDir?: string;
}

/** GET /api/v1/health — no auth (FR-SRV-02): lets clients find the hub and see DB state. */
export function publicHealthRoutes({ pool, appVersion }: { pool: Pool; appVersion: string }): Router {
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

/** GET /api/v1/health/diagnostics — authenticated (Owner/Settings). */
export function diagnosticsRoutes({ pool, appVersion, backupDir }: HealthDeps): Router {
  const router = Router();

  router.get('/health/diagnostics', requirePermission('settings.write'), async (_req, res) => {
    const [dbSize, dbVer, connCount, counts, goLiveRes] = await Promise.all([
      pool.query<{ size: string }>(`SELECT pg_database_size(current_database())::text AS size`),
      pool.query<{ v: string }>(`SELECT version() AS v`),
      pool.query<{ count: number }>(`SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname = current_database()`),
      pool.query<{
        products: number;
        sales: number;
        customers: number;
        suppliers: number;
        stock: number;
        audit: number;
      }>(`
        SELECT
          (SELECT count(*)::int FROM products) AS products,
          (SELECT count(*)::int FROM sales) AS sales,
          (SELECT count(*)::int FROM customers) AS customers,
          (SELECT count(*)::int FROM suppliers) AS suppliers,
          (SELECT count(*)::int FROM stock_movements) AS stock,
          (SELECT count(*)::int FROM audit_logs) AS audit
      `),
      pool.query<{ value: { goLiveAt?: string | null } }>(`SELECT value FROM settings WHERE key = 'system'`),
    ]);

    const sizeBytes = Number(dbSize.rows[0]?.size || 0);
    const goLive = goLiveRes.rows[0]?.value?.goLiveAt ?? null;

    let backupCount = 0;
    let totalBackupBytes = 0;
    if (backupDir) {
      const backups = await listBackups(backupDir);
      backupCount = backups.length;
      totalBackupBytes = backups.reduce((sum, b) => sum + b.sizeBytes, 0);
    }

    const data: SystemDiagnostics = {
      appVersion,
      uptimeSeconds: Math.floor(process.uptime()),
      serverTime: new Date().toISOString(),
      database: {
        name: 'mandiri_tani',
        version: dbVer.rows[0]?.v?.split(' ')?.[1] ?? 'PostgreSQL 18',
        sizeBytes,
        sizeFormatted: formatBytes(sizeBytes),
        activeConnections: connCount.rows[0]?.count ?? 1,
        poolStats: poolStats(pool),
      },
      storage: {
        backupCount,
        totalBackupSizeBytes: totalBackupBytes,
        totalBackupSizeFormatted: formatBytes(totalBackupBytes),
      },
      counts: {
        products: counts.rows[0]?.products ?? 0,
        sales: counts.rows[0]?.sales ?? 0,
        customers: counts.rows[0]?.customers ?? 0,
        suppliers: counts.rows[0]?.suppliers ?? 0,
        stockLedgerEntries: counts.rows[0]?.stock ?? 0,
        auditLogs: counts.rows[0]?.audit ?? 0,
      },
      goLive: {
        isLive: Boolean(goLive),
        goLiveAt: goLive,
      },
    };

    res.json({ data });
  });

  return router;
}

export function healthRoutes(deps: HealthDeps): Router {
  const router = Router();
  router.use(publicHealthRoutes(deps));
  router.use(diagnosticsRoutes(deps));
  return router;
}
