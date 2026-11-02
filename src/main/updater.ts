// Desktop auto-updater service via electron-updater and GitHub Releases.
import { app, type BrowserWindow } from 'electron';
import { autoUpdater, type ProgressInfo, type UpdateInfo } from 'electron-updater';
import type { Logger } from 'pino';
import { IPC } from '@shared/bridge';
import type { CheckUpdateResult, UpdaterStatus } from '@shared/updater';
import type { Lifecycle } from './lifecycle';

export class DesktopUpdater {
  private status: UpdaterStatus;
  private win: BrowserWindow | null = null;
  private readonly logger: Logger;

  constructor(
    private readonly lifecycle: Lifecycle,
    parentLogger: Logger,
  ) {
    this.logger = parentLogger.child({ component: 'updater' });
    this.status = {
      state: 'IDLE',
      currentVersion: app.getVersion(),
    };

    this.configure();
    this.setupEvents();
  }

  setWindow(win: BrowserWindow | null): void {
    this.win = win;
  }

  getStatus(): UpdaterStatus {
    return this.status;
  }

  private configure(): void {
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = false;
    autoUpdater.allowPrerelease = false;

    // Use pino logger adapter for electron-updater
    autoUpdater.logger = {
      info: (msg) => this.logger.info({ autoUpdater: msg }, 'electron-updater info'),
      warn: (msg) => this.logger.warn({ autoUpdater: msg }, 'electron-updater warn'),
      error: (msg) => this.logger.error({ autoUpdater: msg }, 'electron-updater error'),
      debug: (msg) => this.logger.debug({ autoUpdater: msg }, 'electron-updater debug'),
    };
  }

  private broadcast(newStatus: Partial<UpdaterStatus>): void {
    this.status = { ...this.status, ...newStatus };
    if (this.win && !this.win.isDestroyed()) {
      this.win.webContents.send(IPC.updaterStatusChanged, this.status);
    }
  }

  private setupEvents(): void {
    autoUpdater.on('checking-for-update', () => {
      this.logger.info('checking for desktop update');
      this.broadcast({ state: 'CHECKING', error: undefined });
    });

    autoUpdater.on('update-available', (info: UpdateInfo) => {
      this.logger.info({ version: info.version }, 'update available');
      let notes = '';
      if (typeof info.releaseNotes === 'string') {
        notes = info.releaseNotes;
      } else if (Array.isArray(info.releaseNotes)) {
        notes = info.releaseNotes.map((n) => (typeof n === 'string' ? n : n.note ?? '')).filter(Boolean).join('\n\n');
      }

      this.broadcast({
        state: 'AVAILABLE',
        availableVersion: info.version,
        releaseDate: info.releaseDate,
        releaseNotes: notes || undefined,
        lastCheckedAt: new Date().toISOString(),
        error: undefined,
      });
    });

    autoUpdater.on('update-not-available', (info: UpdateInfo) => {
      this.logger.info({ version: info?.version }, 'update not available; app is latest');
      this.broadcast({
        state: 'NOT_AVAILABLE',
        availableVersion: undefined,
        lastCheckedAt: new Date().toISOString(),
        error: undefined,
      });
    });

    autoUpdater.on('error', (err: Error) => {
      const message = err?.message || 'Gagal memeriksa pembaruan';
      this.logger.error({ err }, 'updater error');
      this.broadcast({
        state: 'ERROR',
        error: message,
        lastCheckedAt: new Date().toISOString(),
      });
    });

    autoUpdater.on('download-progress', (progress: ProgressInfo) => {
      this.broadcast({
        state: 'DOWNLOADING',
        progress: {
          percent: Math.min(100, Math.round(progress.percent)),
          bytesPerSecond: progress.bytesPerSecond,
          transferred: progress.transferred,
          total: progress.total,
        },
      });
    });

    autoUpdater.on('update-downloaded', (info: UpdateInfo) => {
      this.logger.info({ version: info.version }, 'update package downloaded successfully');
      this.broadcast({
        state: 'DOWNLOADED',
        availableVersion: info.version,
        progress: {
          percent: 100,
          bytesPerSecond: 0,
          transferred: this.status.progress?.total ?? 0,
          total: this.status.progress?.total ?? 0,
        },
      });
    });
  }

  async checkForUpdates(): Promise<CheckUpdateResult> {
    if (!app.isPackaged && process.env.TEST_UPDATER !== 'true') {
      this.logger.info('skipping update check in unpackaged dev environment');
      const devStatus: UpdaterStatus = {
        state: 'NOT_AVAILABLE',
        currentVersion: app.getVersion(),
        lastCheckedAt: new Date().toISOString(),
      };
      this.broadcast(devStatus);
      return {
        hasUpdate: false,
        version: app.getVersion(),
      };
    }

    try {
      this.broadcast({ state: 'CHECKING', error: undefined });
      const result = await autoUpdater.checkForUpdates();
      if (!result || !result.updateInfo) {
        return { hasUpdate: false };
      }

      const hasUpdate = result.updateInfo.version !== app.getVersion();
      return {
        hasUpdate,
        version: result.updateInfo.version,
        releaseNotes: typeof result.updateInfo.releaseNotes === 'string' ? result.updateInfo.releaseNotes : undefined,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.broadcast({ state: 'ERROR', error: message });
      return { hasUpdate: false, error: message };
    }
  }

  async downloadUpdate(): Promise<void> {
    if (!app.isPackaged && process.env.TEST_UPDATER !== 'true') {
      // In dev, simulate download progress for UI verification
      this.logger.info('simulating download progress in unpackaged dev environment');
      this.broadcast({
        state: 'DOWNLOADING',
        progress: { percent: 0, bytesPerSecond: 500_000, transferred: 0, total: 10_000_000 },
      });
      setTimeout(() => {
        this.broadcast({
          state: 'DOWNLOADING',
          progress: { percent: 50, bytesPerSecond: 500_000, transferred: 5_000_000, total: 10_000_000 },
        });
        setTimeout(() => {
          this.broadcast({
            state: 'DOWNLOADED',
            availableVersion: '0.2.0',
            progress: { percent: 100, bytesPerSecond: 0, transferred: 10_000_000, total: 10_000_000 },
          });
        }, 800);
      }, 800);
      return;
    }

    this.logger.info('triggering update download');
    this.broadcast({
      state: 'DOWNLOADING',
      progress: { percent: 0, bytesPerSecond: 0, transferred: 0, total: 0 },
    });
    await autoUpdater.downloadUpdate();
  }

  /**
   * Safe install: shuts down Express server and PostgreSQL portable cleanly
   * before invoking autoUpdater.quitAndInstall() to prevent data corruption.
   */
  async quitAndInstall(): Promise<void> {
    this.logger.info('quitAndInstall initiated — shutting down lifecycle first');
    try {
      await this.lifecycle.shutdown(15);
    } catch (err) {
      this.logger.error({ err }, 'error during lifecycle shutdown before update install');
    }

    if (!app.isPackaged && process.env.TEST_UPDATER !== 'true') {
      this.logger.info('dev environment: app.quit() instead of quitAndInstall()');
      app.quit();
      return;
    }

    autoUpdater.quitAndInstall(false, true);
  }
}

