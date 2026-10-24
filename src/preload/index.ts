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
  openLogFolder: () => ipcRenderer.invoke(IPC.appOpenLogs),
  listPrinters: () => ipcRenderer.invoke(IPC.printerList),
  printTest: (request) => ipcRenderer.invoke(IPC.printerTest, request),
  getPrinterSettings: () => ipcRenderer.invoke(IPC.printerSettingsGet),
  savePrinterSettings: (settings) => ipcRenderer.invoke(IPC.printerSettingsSave, settings),
};

contextBridge.exposeInMainWorld('pos', bridge);
