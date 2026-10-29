// IPC for lifecycle, app info and hardware only — business data goes through the REST API (ADR-01).
import { app, BrowserWindow, dialog, ipcMain, shell, type IpcMainInvokeEvent } from 'electron';
import { join } from 'node:path';
import type { Logger } from 'pino';
import { IPC, type AppInfo, type IposPickResult } from '@shared/bridge';
import { PrinterSettings } from '@shared/printing';
import { readConfig, updateConfig } from './config';
import type { Lifecycle } from './lifecycle';
import { SERVER_PORT } from './lifecycle';
import type { AppPaths } from './paths';
import { PgError } from './pg/PgManager';
import { listPrinters, printDocument, printTest } from './printing';
import { isAllowedUrl } from './window';

function assertTrustedSender(event: IpcMainInvokeEvent): void {
  const url = event.senderFrame?.url ?? '';
  if (!isAllowedUrl(url)) throw new Error(`IPC ditolak dari ${url || 'pengirim tidak dikenal'}`);
}

export function registerIpc(lifecycle: Lifecycle, paths: AppPaths, logger: Logger): void {
  ipcMain.handle(IPC.lifecycleGet, (event) => {
    assertTrustedSender(event);
    return lifecycle.status;
  });

  ipcMain.handle(IPC.lifecycleRetry, async (event) => {
    assertTrustedSender(event);
    if (lifecycle.status.state === 'FATAL') await lifecycle.boot();
  });

  ipcMain.handle(IPC.appInfo, (event): AppInfo => {
    assertTrustedSender(event);
    return {
      name: 'Mandiri Tani POS',
      version: app.getVersion(),
      dataDir: paths.dataDir,
      logDir: paths.logDir,
      serverPort: SERVER_PORT,
      dbPort: lifecycle.dbPort,
    };
  });

  // Only this machine's own window gets the API key; other devices on the Wi-Fi never see it.
  ipcMain.handle(IPC.appAccessToken, (event) => {
    assertTrustedSender(event);
    return lifecycle.localAccessKey;
  });

  ipcMain.handle(IPC.appOpenLogs, async (event) => {
    assertTrustedSender(event);
    await shell.openPath(paths.logDir);
  });

  ipcMain.handle(IPC.printerList, (event) => {
    assertTrustedSender(event);
    return listPrinters(event.sender);
  });

  ipcMain.handle(IPC.printerTest, (event, payload: unknown) => {
    assertTrustedSender(event);
    return printTest(event.sender, payload, join(paths.dataDir, 'print'), logger.child({ component: 'printer' }));
  });

  ipcMain.handle(IPC.printerDocument, (event, payload: unknown) => {
    assertTrustedSender(event);
    return printDocument(
      event.sender,
      payload,
      readConfig(paths.configFile).printers,
      join(paths.dataDir, 'print'),
      logger.child({ component: 'printer' }),
    );
  });

  // Printer settings are per PC and only writable from this machine's own window (IPC),
  // never over the LAN API — there is no login yet (Sprint 2).
  ipcMain.handle(IPC.printerSettingsGet, (event) => {
    assertTrustedSender(event);
    return readConfig(paths.configFile).printers;
  });

  // FR-MIG-01: the owner picks the backup in a native dialog — the renderer never sees or sends a path.
  ipcMain.handle(IPC.importChooseIpos, async (event): Promise<IposPickResult> => {
    assertTrustedSender(event);
    const win = BrowserWindow.fromWebContents(event.sender);
    const options = {
      title: 'Pilih file backup iPOS',
      filters: [
        { name: 'Backup iPOS 5', extensions: ['i5bu'] },
        { name: 'Semua file', extensions: ['*'] },
      ],
      properties: ['openFile' as const],
    };
    const picked = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
    const file = picked.filePaths[0];
    if (picked.canceled || !file) return { status: 'CANCELED' };
    try {
      const info = await lifecycle.restoreIposBackup(file);
      logger.info(
        { fileName: info.fileName, sha256: info.sha256, tables: info.tables },
        'iPOS backup restored for import',
      );
      return { status: 'RESTORED', fileName: info.fileName, tables: info.tables };
    } catch (err) {
      logger.error({ err }, 'iPOS backup restore failed');
      if (err instanceof PgError) return { status: 'FAILED', message: err.message, detail: err.detail };
      return { status: 'FAILED', message: 'Backup iPOS gagal dibuka. Lihat folder log untuk rinciannya.' };
    }
  });

  ipcMain.handle(IPC.importCleanup, async (event) => {
    assertTrustedSender(event);
    await lifecycle.dropIposImport();
  });

  ipcMain.handle(IPC.printerSettingsSave, (event, payload: unknown) => {
    assertTrustedSender(event);
    const settings = PrinterSettings.parse(payload);
    const saved = updateConfig(paths.configFile, { printers: settings }).printers;
    logger.info({ printers: saved }, 'printer settings saved');
    return saved;
  });
}
