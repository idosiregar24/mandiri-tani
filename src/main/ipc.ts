// IPC for lifecycle, app info and hardware only — business data goes through the REST API (ADR-01).
import { app, ipcMain, shell, type IpcMainInvokeEvent } from 'electron';
import { join } from 'node:path';
import type { Logger } from 'pino';
import { IPC, type AppInfo } from '@shared/bridge';
import { PrinterSettings } from '@shared/printing';
import { readConfig, updateConfig } from './config';
import type { Lifecycle } from './lifecycle';
import { SERVER_PORT } from './lifecycle';
import type { AppPaths } from './paths';
import { listPrinters, printTest } from './printing';
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

  // Printer settings are per PC and only writable from this machine's own window (IPC),
  // never over the LAN API — there is no login yet (Sprint 2).
  ipcMain.handle(IPC.printerSettingsGet, (event) => {
    assertTrustedSender(event);
    return readConfig(paths.configFile).printers;
  });

  ipcMain.handle(IPC.printerSettingsSave, (event, payload: unknown) => {
    assertTrustedSender(event);
    const settings = PrinterSettings.parse(payload);
    const saved = updateConfig(paths.configFile, { printers: settings }).printers;
    logger.info({ printers: saved }, 'printer settings saved');
    return saved;
  });
}
