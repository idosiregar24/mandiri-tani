// Machine-local settings that belong to THIS PC rather than the store database
// (PRD §3.1): the PostgreSQL port and the Windows printer queues.
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { DEFAULT_PRINTER_SETTINGS, PrinterSettings } from '@shared/printing';

export interface LocalConfig {
  /** Last port the cluster ran on; 5433 by default, may move to 5434–5440 (PRD §3.4). */
  pgPort: number;
  /** Printer per role (faktur = LX-310, struk = thermal); FR-SYS-05. */
  printers: PrinterSettings;
}

const DEFAULTS: LocalConfig = { pgPort: 5433, printers: DEFAULT_PRINTER_SETTINGS };

export function readConfig(file: string): LocalConfig {
  if (!existsSync(file)) return structuredClone(DEFAULTS);
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8')) as Partial<LocalConfig>;
    const printers = PrinterSettings.safeParse(raw.printers);
    return {
      pgPort: typeof raw.pgPort === 'number' ? raw.pgPort : DEFAULTS.pgPort,
      printers: printers.success ? printers.data : structuredClone(DEFAULT_PRINTER_SETTINGS),
    };
  } catch {
    return structuredClone(DEFAULTS);
  }
}

/** Atomic: a crash or power cut mid-write never leaves a half-written config.json. */
export function writeConfig(file: string, config: LocalConfig): void {
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(config, null, 2)}\n`);
  renameSync(tmp, file);
}

/** Read-modify-write of one part, so a save never overwrites what another part changed. */
export function updateConfig(file: string, patch: Partial<LocalConfig>): LocalConfig {
  const next = { ...readConfig(file), ...patch };
  writeConfig(file, next);
  return next;
}
