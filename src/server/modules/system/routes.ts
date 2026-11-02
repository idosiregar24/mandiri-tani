import { basename } from 'node:path';
import { Router } from 'express';
import { z } from 'zod';
import type { Pool } from '../../db/pool';
import { recordAudit } from '../../lib/audit';
import { requirePermission } from '../../middleware/auth';
import type { BackupHooks } from '../backups/routes';

export const GoLiveInput = z.object({
  confirm: z.string().trim(),
});

export function systemRoutes({ pool, hooks }: { pool: Pool; hooks?: BackupHooks }): Router {
  const router = Router();

  router.get('/system/status', async (_req, res) => {
    const r = await pool.query<{ value: { go_live_at?: string | null; goLiveAt?: string | null } }>(
      `SELECT value FROM settings WHERE key = 'system'`,
    );
    const raw = r.rows[0]?.value;
    const goLiveAt = raw?.go_live_at ?? raw?.goLiveAt ?? null;
    res.json({
      data: {
        isLive: Boolean(goLiveAt),
        goLiveAt,
      },
    });
  });

  router.post('/system/go-live', requirePermission('system.go_live'), async (req, res) => {
    const parsed = GoLiveInput.safeParse(req.body);
    if (!parsed.success || parsed.data.confirm !== 'GO LIVE') {
      res.status(400).json({
        error: {
          code: 'CONFIRMATION_MISMATCH',
          message: 'Ketik persis "GO LIVE" untuk mengonfirmasi pengalihan ke Mode Produksi.',
        },
      });
      return;
    }

    const check = await pool.query<{ value: { go_live_at?: string | null; goLiveAt?: string | null } }>(
      `SELECT value FROM settings WHERE key = 'system'`,
    );
    const existing = check.rows[0]?.value;
    if (existing?.go_live_at || existing?.goLiveAt) {
      res.status(409).json({
        error: {
          code: 'ALREADY_LIVE',
          message: 'Toko sudah dalam Mode Produksi (Go-Live).',
        },
      });
      return;
    }

    let backupFile: string | null = null;
    if (hooks?.backup) {
      try {
        const full = await hooks.backup('go-live');
        backupFile = basename(full);
      } catch (err) {
        // Backup failure blocks go-live to preserve safety
        res.status(500).json({
          error: {
            code: 'BACKUP_FAILED',
            message: 'Pencadangan otomatis sebelum Go-Live gagal. Periksa ruang disk lalu coba lagi.',
            detail: err instanceof Error ? err.message : String(err),
          },
        });
        return;
      }
    }

    const now = new Date().toISOString();
    const systemValue = {
      go_live_at: now,
      goLiveAt: now,
    };

    await pool.query(
      `INSERT INTO settings (key, value, updated_at) VALUES ('system', $1, now())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
      [JSON.stringify(systemValue)],
    );

    await recordAudit(pool, req.ctx, {
      action: 'system.go_live',
      entity: 'system',
      entityId: null,
      after: {
        goLiveAt: now,
        backupFile,
      },
    });

    res.json({
      data: {
        isLive: true,
        goLiveAt: now,
        backupFile,
        message: 'Toko telah resmi beralih ke Mode Produksi (Go-Live).',
      },
    });
  });

  return router;
}

