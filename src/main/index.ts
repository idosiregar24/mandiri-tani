// Electron entry: single instance, boot order, graceful shutdown (PRD §3.2, §3.6, §3.7).
import { app, powerMonitor, type BrowserWindow } from 'electron';
import { IPC } from '@shared/bridge';
import { registerIpc } from './ipc';
import { Lifecycle } from './lifecycle';
import { createLogger } from './logger';
import { configureUserData, resolvePaths } from './paths';
import { createMainWindow, DEV_RENDERER_URL, loadApp, loadBootScreen } from './window';

configureUserData();

if (!app.requestSingleInstanceLock()) {
  // Another instance owns PostgreSQL and port 3000 — just hand focus to it.
  app.quit();
} else {
  const paths = resolvePaths();
  const logger = createLogger(paths.logDir, !app.isPackaged);
  const lifecycle = new Lifecycle({
    paths,
    logger,
    appVersion: app.getVersion(),
    serveRenderer: !DEV_RENDERER_URL,
  });
  let win: BrowserWindow | null = null;
  let quitting = false;

  process.on('uncaughtException', (err) => logger.fatal({ err }, 'uncaught exception'));
  process.on('unhandledRejection', (err) => logger.error({ err }, 'unhandled rejection'));

  app.on('second-instance', () => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
  });

  lifecycle.on('change', (status) => {
    if (!win || win.isDestroyed()) return;
    win.webContents.send(IPC.lifecycleChanged, status);
    if (status.state === 'READY') void loadApp(win).catch((err) => logger.error({ err }, 'loading app failed'));
  });

  app.whenReady().then(async () => {
    logger.info({ version: app.getVersion(), packaged: app.isPackaged, dataDir: paths.dataDir }, 'app starting');
    registerIpc(lifecycle, paths, logger);
    win = createMainWindow();
    // Windows logoff/shutdown gives us seconds, not minutes: stop PostgreSQL right away.
    win.on('session-end', () => {
      logger.warn('Windows session ending — fast shutdown');
      void lifecycle.shutdown(10);
    });
    await loadBootScreen(win, paths.rendererDir);
    await lifecycle.boot();
  });

  powerMonitor.on('resume', () => {
    logger.info('system resumed from sleep');
    void lifecycle.healthCheck();
  });

  app.on('window-all-closed', () => app.quit());

  app.on('before-quit', (event) => {
    if (quitting) return;
    event.preventDefault();
    quitting = true;
    lifecycle
      .shutdown()
      .catch((err) => logger.error({ err }, 'shutdown failed'))
      .finally(() => {
        logger.flush();
        app.exit(0);
      });
  });
}
