import { existsSync } from 'node:fs';
import { basename, join } from 'node:path';
import { Router } from 'express';
import { RestoreBackupInput } from '@shared/schemas/backups';
import type { Pool } from '../../db/pool';
import { recordAudit } from '../../lib/audit';
import { requirePermission } from '../../middleware/auth';
import { listBackups } from './service';

export interface BackupHooks {
  backupDir?: string;
  backup?: (label: string) => Promise<string>;
  restore?: (file: string) => Promise<void>;
  verifyBackup?: (file: string) => Promise<boolean>;
}

export function backupRoutes({ pool, hooks }: { pool: Pool; hooks?: BackupHooks }): Router {
  const router = Router();
  const guardCreate = requirePermission('backup.create');
  const guardRestore = requirePermission('backup.restore');

  const getBackupDir = () => hooks?.backupDir ?? null;

  router.get('/backups', guardCreate, async (_req, res) => {
    const dir = getBackupDir();
    if (!dir) {
      res.json({ data: [] });
      return;
    }

    const items = await listBackups(dir, hooks?.verifyBackup);
    res.json({
      data: items.map(({ fullPath: _p, ...rest }) => rest),
    });
  });

  router.post('/backups', guardCreate, async (req, res) => {
    if (!hooks?.backup) {
      res.status(501).json({
        error: { code: 'UNSUPPORTED', message: 'Fungsi pencadangan database tidak tersedia pada mode ini.' },
      });
      return;
    }

    try {
      const filePath = await hooks.backup('manual');
      const filename = basename(filePath);

      await recordAudit(pool, req.ctx, {
        action: 'backup.create',
        entity: 'backups',
        entityId: null,
        after: { filename },
      });

      res.status(201).json({
        data: {
          filename,
          message: 'Pencadangan database berhasil dibuat.',
        },
      });
    } catch (err) {
      res.status(500).json({
        error: { code: 'BACKUP_FAILED', message: err instanceof Error ? err.message : 'Gagal membuat cadangan database.' },
      });
    }
  });

  router.get('/backups/:filename/download', guardCreate, async (req, res) => {
    const dir = getBackupDir();
    if (!dir) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Direktori backup tidak ditemukan.' } });
      return;
    }

    const filename = basename(req.params.filename as string);
    // Search in root backupDir and daily/
    let fullPath = join(dir, filename);
    if (!existsSync(fullPath)) {
      fullPath = join(dir, 'daily', filename);
    }

    if (!existsSync(fullPath)) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'File backup tidak ditemukan.' } });
      return;
    }

    res.download(fullPath, filename);
  });

  router.post('/backups/restore', guardRestore, async (req, res) => {
    if (!hooks?.restore) {
      res.status(501).json({
        error: { code: 'UNSUPPORTED', message: 'Fungsi pemulihan database tidak tersedia pada mode ini.' },
      });
      return;
    }

    const parsed = RestoreBackupInput.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: { code: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message ?? 'Data tidak valid.' },
      });
      return;
    }

    const { filename, confirmStoreName } = parsed.data;

    // Verify confirmation with current store name
    const storeRow = await pool.query<{ value: { name: string } }>(`SELECT value FROM settings WHERE key = 'store'`);
    const storeName = storeRow.rows[0]?.value?.name ?? 'Mandiri Tani';
    if (confirmStoreName.trim().toLowerCase() !== storeName.trim().toLowerCase()) {
      res.status(400).json({
        error: {
          code: 'CONFIRM_MISMATCH',
          message: `Konfirmasi nama toko tidak sesuai. Ketik persis "${storeName}" untuk melanjutkan.`,
        },
      });
      return;
    }

    const dir = getBackupDir();
    if (!dir) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Direktori backup tidak ditemukan.' } });
      return;
    }

    const safeFilename = basename(filename);
    let fullPath = join(dir, safeFilename);
    if (!existsSync(fullPath)) {
      fullPath = join(dir, 'daily', safeFilename);
    }

    if (!existsSync(fullPath)) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'File backup tidak ditemukan.' } });
      return;
    }

    try {
      await hooks.restore(fullPath);

      await recordAudit(pool, req.ctx, {
        action: 'backup.restore',
        entity: 'backups',
        entityId: null,
        after: { filename: safeFilename },
      });

      res.json({
        data: {
          ok: true,
          message: 'Database berhasil dipulihkan dari cadangan.',
        },
      });
    } catch (err) {
      res.status(500).json({
        error: { code: 'RESTORE_FAILED', message: err instanceof Error ? err.message : 'Gagal memulihkan database.' },
      });
    }
  });

  return router;
}

