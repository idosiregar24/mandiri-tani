// Boot/shutdown state machine shared by the Electron main process (owner) and the
// renderer boot screen (viewer). PRD §3.2.
export const LIFECYCLE_STATES = [
  'BOOTING',
  'DB_INIT',
  'DB_STARTING',
  'MIGRATING',
  'SERVER_STARTING',
  'READY',
  'SHUTTING_DOWN',
  'FATAL',
] as const;

export type LifecycleState = (typeof LIFECYCLE_STATES)[number];

export interface LifecycleStatus {
  state: LifecycleState;
  /** User-facing message in Bahasa Indonesia. */
  message: string;
  /** Technical detail for FATAL (shown collapsed, also written to the log). */
  detail?: string;
  /** ISO timestamp of the transition. */
  at: string;
}

export const LIFECYCLE_MESSAGES: Record<LifecycleState, string> = {
  BOOTING: 'Menyiapkan aplikasi…',
  DB_INIT: 'Menyiapkan database untuk pertama kali (sekali saja, ±1 menit)…',
  DB_STARTING: 'Menyalakan database…',
  MIGRATING: 'Memperbarui struktur database…',
  SERVER_STARTING: 'Menyalakan server toko…',
  READY: 'Siap.',
  SHUTTING_DOWN: 'Menutup aplikasi dengan aman…',
  FATAL: 'Aplikasi tidak bisa dijalankan.',
};
