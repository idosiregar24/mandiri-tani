// The narrow API the preload script exposes as `window.pos` (security-standards §5).
// Business data never goes through here — only lifecycle, app info and hardware.
import type { LifecycleStatus } from './lifecycle';
import type { PrintDocument, PrinterInfo, PrinterSettings, PrintResult, PrintTestRequest } from './printing';

export const IPC = {
  lifecycleGet: 'pos:lifecycle:get',
  lifecycleChanged: 'pos:lifecycle:changed',
  lifecycleRetry: 'pos:lifecycle:retry',
  appInfo: 'pos:app:info',
  appAccessToken: 'pos:app:access-token',
  appOpenLogs: 'pos:app:open-logs',
  printerList: 'pos:printer:list',
  printerTest: 'pos:printer:test',
  printerDocument: 'pos:printer:document',
  printerSettingsGet: 'pos:printer:settings-get',
  printerSettingsSave: 'pos:printer:settings-save',
  importChooseIpos: 'pos:import:choose-ipos',
  importCleanup: 'pos:import:cleanup',
} as const;

/** Result of picking + restoring an iPOS backup (FR-MIG-01). Errors come back as data, not as thrown IPC errors. */
export type IposPickResult =
  | { status: 'RESTORED'; fileName: string; tables: number }
  | { status: 'CANCELED' }
  | { status: 'FAILED'; message: string; detail?: string };

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
  /** Local access key for the REST API (sprint-3 S3-1) — replaced by a login session in Sprint 2. */
  accessToken(): Promise<string>;
  openLogFolder(): Promise<void>;
  listPrinters(): Promise<PrinterInfo[]>;
  printTest(request: PrintTestRequest): Promise<PrintResult>;
  /** Prints a receipt/faktur on the printer of its role — only after the API saved the document. */
  printDocument(doc: PrintDocument): Promise<PrintResult>;
  getPrinterSettings(): Promise<PrinterSettings>;
  /** Saves this PC's printer settings; resolves with what was stored. */
  savePrinterSettings(settings: PrinterSettings): Promise<PrinterSettings>;
  /** Owner picks an iPOS backup (.i5bu); the main process restores it into the temporary import database. */
  chooseIposBackup(): Promise<IposPickResult>;
  /** Drops the temporary import database (after an import or when leaving the wizard). */
  cleanupIposImport(): Promise<void>;
}

declare global {
  interface Window {
    /** Present only inside the Electron desktop app (absent in a plain browser / mobile). */
    pos?: PosBridge;
  }
}
