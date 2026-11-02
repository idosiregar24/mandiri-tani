// Exposes the narrow `window.pos` bridge (security-standards §5). Never expose ipcRenderer itself.
import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import { IPC, type PosBridge } from '@shared/bridge';
import type { LifecycleStatus } from '@shared/lifecycle';
import type { UpdaterStatus } from '@shared/updater';

const bridge: PosBridge = {
  getLifecycle: () => ipcRenderer.invoke(IPC.lifecycleGet),
  onLifecycle(listener) {
    const handler = (_event: IpcRendererEvent, status: LifecycleStatus) => listener(status);
    ipcRenderer.on(IPC.lifecycleChanged, handler);
    return () => ipcRenderer.removeListener(IPC.lifecycleChanged, handler);
  },
  retryBoot: () => ipcRenderer.invoke(IPC.lifecycleRetry),
  appInfo: () => ipcRenderer.invoke(IPC.appInfo),
  accessToken: () => ipcRenderer.invoke(IPC.appAccessToken),
  openLogFolder: () => ipcRenderer.invoke(IPC.appOpenLogs),
  listPrinters: () => ipcRenderer.invoke(IPC.printerList),
  printTest: (request) => ipcRenderer.invoke(IPC.printerTest, request),
  printDocument: (doc) => ipcRenderer.invoke(IPC.printerDocument, doc),
  getPrinterSettings: () => ipcRenderer.invoke(IPC.printerSettingsGet),
  savePrinterSettings: (settings) => ipcRenderer.invoke(IPC.printerSettingsSave, settings),
  chooseIposBackup: () => ipcRenderer.invoke(IPC.importChooseIpos),
  cleanupIposImport: () => ipcRenderer.invoke(IPC.importCleanup),
  saveReportPdf: (request) => ipcRenderer.invoke(IPC.reportSavePdf, request),
  updater: {
    getStatus: () => ipcRenderer.invoke(IPC.updaterGetStatus),
    check: () => ipcRenderer.invoke(IPC.updaterCheck),
    download: () => ipcRenderer.invoke(IPC.updaterDownload),
    install: () => ipcRenderer.invoke(IPC.updaterInstall),
    onStatusChange(listener) {
      const handler = (_event: IpcRendererEvent, status: UpdaterStatus) => listener(status);
      ipcRenderer.on(IPC.updaterStatusChanged, handler);
      return () => ipcRenderer.removeListener(IPC.updaterStatusChanged, handler);
    },
  },
};

contextBridge.exposeInMainWorld('pos', bridge);
