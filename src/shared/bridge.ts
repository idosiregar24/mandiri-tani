// The narrow API the preload script exposes as `window.pos` (security-standards §5).
// Business data never goes through here — only lifecycle, app info and hardware.
import type { LifecycleStatus } from './lifecycle';
import type { PrinterInfo, PrinterSettings, PrintResult, PrintTestRequest } from './printing';

export const IPC = {
  lifecycleGet: 'pos:lifecycle:get',
  lifecycleChanged: 'pos:lifecycle:changed',
  lifecycleRetry: 'pos:lifecycle:retry',
  appInfo: 'pos:app:info',
  appOpenLogs: 'pos:app:open-logs',
  printerList: 'pos:printer:list',
  printerTest: 'pos:printer:test',
  printerSettingsGet: 'pos:printer:settings-get',
  printerSettingsSave: 'pos:printer:settings-save',
} as const;

export interface AppInfo {
  name: string;
  version: string;
  dataDir: string;
  logDir: string;
  serverPort: number;
  dbPort: number | null;
}

export interface PosBridge {
  getLifecycle(): Promise<LifecycleStatus>;
  /** Subscribes to lifecycle changes; returns an unsubscribe function. */
  onLifecycle(listener: (status: LifecycleStatus) => void): () => void;
  retryBoot(): Promise<void>;
  appInfo(): Promise<AppInfo>;
  openLogFolder(): Promise<void>;
  listPrinters(): Promise<PrinterInfo[]>;
  printTest(request: PrintTestRequest): Promise<PrintResult>;
  getPrinterSettings(): Promise<PrinterSettings>;
  /** Saves this PC's printer settings; resolves with what was stored. */
  savePrinterSettings(settings: PrinterSettings): Promise<PrinterSettings>;
}

declare global {
  interface Window {
    /** Present only inside the Electron desktop app (absent in a plain browser / mobile). */
    pos?: PosBridge;
  }
}
