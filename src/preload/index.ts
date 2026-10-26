// Exposes the narrow `window.pos` bridge (security-standards §5). Never expose ipcRenderer itself.
import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import { IPC, type PosBridge } from '@shared/bridge';
import type { LifecycleStatus } from '@shared/lifecycle';

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
  getPrinterSettings: () => ipcRenderer.invoke(IPC.printerSettingsGet),
  savePrinterSettings: (settings) => ipcRenderer.invoke(IPC.printerSettingsSave, settings),
  chooseIposBackup: () => ipcRenderer.invoke(IPC.importChooseIpos),
  cleanupIposImport: () => ipcRenderer.invoke(IPC.importCleanup),
};

contextBridge.exposeInMainWorld('pos', bridge);
