import { existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import type { Logger } from 'pino';
import type { BackupKind } from '@shared/schemas/backups';

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(1)} MB`;
  const gb = mb / 1024;
  return `${gb.toFixed(2)} GB`;
}

export function classifyBackup(filename: string, dirName: string): BackupKind {
  const lower = filename.toLowerCase();
  if (dirName.includes('daily') || lower.startsWith('daily') || lower.includes('_daily-')) return 'daily';
  if (lower.startsWith('manual')) return 'manual';
  if (lower.startsWith('pre-reset')) return 'pre_reset';
  if (lower.startsWith('pre-migrate')) return 'pre_migrate';
  return 'other';
}

export interface BackupScanEntry {
  filename: string;
  fullPath: string;
  sizeBytes: number;
  sizeFormatted: string;
  createdAt: string;
  kind: BackupKind;
  verified: boolean;
}

export async function listBackups(
  backupDir: string,
  verifyFn?: (file: string) => Promise<boolean>,
): Promise<BackupScanEntry[]> {
  if (!existsSync(backupDir)) return [];

  const entries: BackupScanEntry[] = [];
  const dirsToScan = [{ dir: backupDir, isDaily: false }];
  const dailyDir = join(backupDir, 'daily');
  if (existsSync(dailyDir)) {
    dirsToScan.push({ dir: dailyDir, isDaily: true });
  }

  for (const { dir, isDaily } of dirsToScan) {
    try {
      const files = readdirSync(dir);
      for (const file of files) {
        if (!file.endsWith('.dump') && !file.endsWith('.sql')) continue;
        const fullPath = join(dir, file);
        try {
          const st = statSync(fullPath);
          if (!st.isFile()) continue;

          let verified = st.size > 1024;
          if (verifyFn && st.size > 0) {
            try {
              verified = await verifyFn(fullPath);
            } catch {
              verified = false;
            }
          }

          entries.push({
            filename: file,
            fullPath,
            sizeBytes: st.size,
            sizeFormatted: formatBytes(st.size),
            createdAt: st.mtime.toISOString(),
            kind: classifyBackup(file, isDaily ? 'daily' : ''),
            verified,
          });
        } catch {
          /* ignore unreadable file */
        }
      }
    } catch {
      /* ignore unreadable directory */
    }
  }

  // Sort newest first
  return entries.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

/**
 * FR-SYS-10: Retention policy.
 * Keeps 14 daily backups + 8 weekly backups (Sunday backups). Older files are purged.
 */
export function cleanRetention(dailyDir: string, logger?: Logger): number {
  if (!existsSync(dailyDir)) return 0;

  try {
    const files = readdirSync(dailyDir)
      .filter((f) => f.endsWith('.dump') || f.endsWith('.sql'))
      .map((f) => {
        const fullPath = join(dailyDir, f);
        const st = statSync(fullPath);
        return { filename: f, fullPath, mtime: st.mtime };
      })
      .sort((a, b) => b.mtime.getTime() - a.mtime.getTime());

    if (files.length <= 14) return 0;

    const older = files.slice(14);

    // Keep up to 8 weekly backups from older (day 0 = Sunday)
    const keptWeekly = new Set<string>();
    let weeklyCount = 0;
    for (const f of older) {
      if (weeklyCount < 8 && f.mtime.getDay() === 0) {
        keptWeekly.add(f.filename);
        weeklyCount++;
      }
    }

    let deleted = 0;
    for (const f of older) {
      if (!keptWeekly.has(f.filename)) {
        try {
          unlinkSync(f.fullPath);
          deleted++;
          logger?.info({ file: f.filename }, 'purged old backup due to retention policy');
        } catch (err) {
          logger?.warn({ file: f.filename, err }, 'failed to purge old backup');
        }
      }
    }

    return deleted;
  } catch (err) {
    logger?.warn({ err }, 'cleanRetention error');
    return 0;
  }
}

/**
 * Checks if a daily backup already exists for today; if not, triggers one.
 */
export async function createDailyBackupIfNeeded(
  backupDir: string,
  backupFn: (dir: string, label: string) => Promise<string>,
  logger?: Logger,
): Promise<string | null> {
  const dailyDir = join(backupDir, 'daily');
  mkdirSync(dailyDir, { recursive: true });

  const todayStr = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date()).replace(/-/g, '');
  const existing = readdirSync(dailyDir);
  const alreadyHasToday = existing.some((f) => f.includes(todayStr));

  if (alreadyHasToday) {
    logger?.debug('daily backup for today already exists');
    return null;
  }

  logger?.info('creating daily backup');
  const file = await backupFn(dailyDir, `mandiri_tani_daily-${todayStr}`);
  cleanRetention(dailyDir, logger);
  return file;
}

