// Schemas for backup and system diagnostics (sprint-13 S13-1, FR-SYS-10..12).
import { RequiredText, z } from './common';

export const BACKUP_KINDS = ['daily', 'manual', 'pre_reset', 'pre_migrate', 'other'] as const;
export type BackupKind = (typeof BACKUP_KINDS)[number];

export const BackupItem = z.object({
  filename: z.string(),
  sizeBytes: z.number(),
  sizeFormatted: z.string(),
  createdAt: z.string(),
  kind: z.enum(BACKUP_KINDS),
  verified: z.boolean(),
});
export type BackupItem = z.infer<typeof BackupItem>;

export const RestoreBackupInput = z.object({
  filename: z.string().min(1, 'Pilih file backup.'),
  confirmStoreName: RequiredText('Konfirmasi nama toko', 100),
});
export type RestoreBackupInput = z.infer<typeof RestoreBackupInput>;

export interface SystemDiagnostics {
  appVersion: string;
  uptimeSeconds: number;
  serverTime: string;
  database: {
    name: string;
    version: string;
    sizeBytes: number;
    sizeFormatted: string;
    activeConnections: number;
    poolStats: { total: number; idle: number; waiting: number };
  };
  storage: {
    backupCount: number;
    totalBackupSizeBytes: number;
    totalBackupSizeFormatted: string;
  };
  counts: {
    products: number;
    sales: number;
    customers: number;
    suppliers: number;
    stockLedgerEntries: number;
    auditLogs: number;
  };
  goLive: {
    isLive: boolean;
    goLiveAt: string | null;
  };
}

