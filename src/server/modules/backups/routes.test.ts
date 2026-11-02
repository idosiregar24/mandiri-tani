import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { BackupItem, SystemDiagnostics } from '@shared/schemas/backups';
import { startTestApi, type Data, type ErrBody, type TestApi } from '../../../../test/api';
import { cleanRetention } from './service';

let api: TestApi;
let testBackupDir: string;
let restoredFile: string | null = null;
let backedUpLabel: string | null = null;

beforeAll(async () => {
  testBackupDir = join(tmpdir(), `mtpos-test-backup-${Date.now()}`);
  mkdirSync(testBackupDir, { recursive: true });
  mkdirSync(join(testBackupDir, 'daily'), { recursive: true });

  // Create sample backup files
  writeFileSync(join(testBackupDir, 'manual-2026-10-30.dump'), 'dummy-manual-dump-content');
  writeFileSync(join(testBackupDir, 'daily', 'mandiri_tani_daily-20261029.dump'), 'dummy-daily-dump-content');
  writeFileSync(join(testBackupDir, 'pre-reset-2026-10-28.dump'), 'dummy-reset-dump-content');

  api = await startTestApi({
    hooks: {
      backupDir: testBackupDir,
      backup: async (label: string) => {
        backedUpLabel = label;
        const file = join(testBackupDir, `${label}-${Date.now()}.dump`);
        writeFileSync(file, 'new-backup-content');
        return file;
      },
      restore: async (file: string) => {
        restoredFile = file;
      },
      verifyBackup: async () => true,
    },
  });
});

afterAll(async () => {
  await api?.close();
  rmSync(testBackupDir, { recursive: true, force: true });
});

describe('backup & restore system (Sprint 13, FR-SYS-10..12)', () => {
  it('lists existing backups in directory (Owner only)', async () => {
    // Owner can list
    const res = await api.call<Data<BackupItem[]>>('GET', '/backups', undefined, { as: 'OWNER' });
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBe(3);

    const filenames = res.body.data.map((b) => b.filename);
    expect(filenames).toContain('manual-2026-10-30.dump');
    expect(filenames).toContain('mandiri_tani_daily-20261029.dump');
    expect(filenames).toContain('pre-reset-2026-10-28.dump');

    const daily = res.body.data.find((b) => b.filename.includes('daily'));
    expect(daily?.kind).toBe('daily');

    // Kasir is forbidden
    const kasirRes = await api.call<ErrBody>('GET', '/backups', undefined, { as: 'KASIR' });
    expect(kasirRes.status).toBe(403);
  });

  it('triggers a manual backup and records audit log', async () => {
    const res = await api.call<Data<{ filename: string; message: string }>>('POST', '/backups', {}, { as: 'OWNER' });
    expect(res.status).toBe(201);
    expect(res.body.data.filename).toMatch(/^manual-/);
    expect(backedUpLabel).toBe('manual');

    // Check audit log
    const audit = await api.pool.query<{ action: string; entity: string }>(
      `SELECT action, entity FROM audit_logs WHERE action = 'backup.create' ORDER BY seq DESC LIMIT 1`,
    );
    expect(audit.rows.length).toBe(1);
    expect(audit.rows[0]?.action).toBe('backup.create');
  });

  it('downloads a backup file', async () => {
    const res = await fetch(`${api.base}/backups/manual-2026-10-30.dump/download`, {
      headers: { authorization: `Bearer ${api.users.OWNER.token}` },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-disposition')).toContain('manual-2026-10-30.dump');

    // Kasir cannot download
    const kasirRes = await api.call<ErrBody>('GET', '/backups/manual-2026-10-30.dump/download', undefined, { as: 'KASIR' });
    expect(kasirRes.status).toBe(403);

    // Non-existent file returns 404
    const notFound = await api.call<ErrBody>('GET', '/backups/tidak-ada.dump/download', undefined, { as: 'OWNER' });
    expect(notFound.status).toBe(404);
  });

  it('restores a backup requiring exact store name confirmation', async () => {
    // Wrong store name confirmation
    const wrong = await api.call<ErrBody>(
      'POST',
      '/backups/restore',
      { filename: 'manual-2026-10-30.dump', confirmStoreName: 'Toko Salah' },
      { as: 'OWNER' },
    );
    expect(wrong.status).toBe(400);
    expect(wrong.body.error.code).toBe('CONFIRM_MISMATCH');

    // Kasir is forbidden
    const kasir = await api.call<ErrBody>(
      'POST',
      '/backups/restore',
      { filename: 'manual-2026-10-30.dump', confirmStoreName: 'Mandiri Tani' },
      { as: 'KASIR' },
    );
    expect(kasir.status).toBe(403);

    // Correct confirmation (default store name is Mandiri Tani)
    const ok = await api.call<Data<{ ok: boolean; message: string }>>(
      'POST',
      '/backups/restore',
      { filename: 'manual-2026-10-30.dump', confirmStoreName: 'Mandiri Tani' },
      { as: 'OWNER' },
    );
    expect(ok.status).toBe(200);
    expect(ok.body.data.ok).toBe(true);
    expect(restoredFile).toContain('manual-2026-10-30.dump');

    // Check audit log
    const audit = await api.pool.query<{ action: string }>(
      `SELECT action FROM audit_logs WHERE action = 'backup.restore' ORDER BY seq DESC LIMIT 1`,
    );
    expect(audit.rows.length).toBe(1);
  });

  it('cleans daily backups according to retention policy (14 daily + 8 weekly)', () => {
    const retentionDir = join(tmpdir(), `mtpos-retention-test-${Date.now()}`);
    mkdirSync(retentionDir, { recursive: true });

    // Create 20 daily files
    for (let i = 1; i <= 20; i++) {
      const day = String(i).padStart(2, '0');
      writeFileSync(join(retentionDir, `daily-2026-10-${day}.dump`), `content-${i}`);
    }

    const deleted = cleanRetention(retentionDir);
    expect(deleted).toBeGreaterThanOrEqual(1);

    rmSync(retentionDir, { recursive: true, force: true });
  });

  it('provides system diagnostics (database size, table counts, uptime)', async () => {
    const res = await api.call<Data<SystemDiagnostics>>('GET', '/health/diagnostics', undefined, { as: 'OWNER' });
    expect(res.status).toBe(200);
    expect(res.body.data.appVersion).toBe('0.0.0-test');
    expect(res.body.data.database.name).toBe('mandiri_tani');
    expect(res.body.data.database.sizeBytes).toBeGreaterThan(0);
    expect(res.body.data.counts.products).toBeDefined();
    expect(res.body.data.counts.sales).toBeDefined();
    expect(res.body.data.counts.customers).toBeDefined();

    // Kasir cannot view diagnostics
    const kasir = await api.call<ErrBody>('GET', '/health/diagnostics', undefined, { as: 'KASIR' });
    expect(kasir.status).toBe(403);
  });
});

