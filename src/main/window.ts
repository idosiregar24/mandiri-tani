// Main window with locked-down web preferences (security-standards §5).
import { BrowserWindow, shell } from 'electron';
import { join } from 'node:path';
import { SERVER_PORT } from './lifecycle';

export const DEV_RENDERER_URL = process.env.ELECTRON_RENDERER_URL;
export const APP_URL = `http://127.0.0.1:${SERVER_PORT}/`;

/** Origins the window may show: the Vite dev server (dev) or the embedded server (prod). */
export function isAllowedUrl(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.protocol === 'file:') return true; // packaged boot screen (out/renderer/index.html)
    if (u.origin === new URL(APP_URL).origin) return true;
    return Boolean(DEV_RENDERER_URL) && u.origin === new URL(DEV_RENDERER_URL!).origin;
  } catch {
    return false;
  }
}

export function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1366,
    height: 768,
    minWidth: 1024,
    minHeight: 640,
    show: false,
    title: 'Mandiri Tani POS',
    backgroundColor: '#FAF8F3',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: false,
    },
  });

  win.once('ready-to-show', () => {
    win.maximize();
    win.show();
  });

  win.webContents.on('will-navigate', (event, url) => {
    if (!isAllowedUrl(url)) event.preventDefault();
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    // Only https links may open — in the system browser, never inside the app.
    if (url.startsWith('https://')) void shell.openExternal(url);
    return { action: 'deny' };
  });

  return win;
}

/** Dev: Vite dev server. Prod: the built boot screen from disk until the server is READY. */
export async function loadBootScreen(win: BrowserWindow, rendererDir: string): Promise<void> {
  if (DEV_RENDERER_URL) await win.loadURL(DEV_RENDERER_URL);
  else await win.loadFile(join(rendererDir, 'index.html'));
}

/** Prod: once READY, reload the UI from the embedded server so UI and API share one origin (ADR-01). */
export async function loadApp(win: BrowserWindow): Promise<void> {
  if (DEV_RENDERER_URL) return; // Vite proxies /api to the embedded server already
  await win.loadURL(APP_URL);
}
