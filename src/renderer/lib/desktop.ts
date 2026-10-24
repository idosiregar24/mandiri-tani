import type { PosBridge } from '@shared/bridge';

/** True inside the Electron app; false in a plain browser or the mobile client (frontend-standards §7). */
export function isDesktop(): boolean {
  return window.pos !== undefined;
}

/** The desktop bridge, or null outside Electron — callers must handle null. */
export function desktopBridge(): PosBridge | null {
  return window.pos ?? null;
}
