import type { PosBridge } from '@shared/bridge';
import { DEFAULT_PRINTER_SETTINGS, type PrinterSettings } from '@shared/printing';

/** True inside the Electron app; false in a plain browser or the mobile client (frontend-standards §7). */
export function isDesktop(): boolean {
  return window.pos !== undefined;
}

/** The desktop bridge, or null outside Electron — callers must handle null. */
export function desktopBridge(): PosBridge | null {
  return window.pos ?? null;
}

/** This PC's printer settings; the defaults outside Electron or when the bridge fails. */
export async function loadPrinterSettings(): Promise<PrinterSettings> {
  return (await window.pos?.getPrinterSettings().catch(() => null)) ?? DEFAULT_PRINTER_SETTINGS;
}
