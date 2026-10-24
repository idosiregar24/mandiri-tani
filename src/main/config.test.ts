import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_PRINTER_SETTINGS, type PrinterSettings } from '@shared/printing';
import { readConfig, updateConfig, writeConfig } from './config';

const PRINTERS: PrinterSettings = {
  faktur: { printer: 'EPSON LX-310 ESC/P (Copy 1)', linesPerPage: 34, nlq: true },
  struk: { printer: 'POS-80', columns: 42, cut: false },
};

describe('config', () => {
  let dir: string;
  let file: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'mtpos-config-'));
    file = join(dir, 'config.json');
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('returns defaults when the file is missing or broken', () => {
    expect(readConfig(file)).toEqual({ pgPort: 5433, printers: DEFAULT_PRINTER_SETTINGS });
    writeFileSync(file, '{ not json');
    expect(readConfig(file)).toEqual({ pgPort: 5433, printers: DEFAULT_PRINTER_SETTINGS });
  });

  it('round-trips and leaves no temp file behind', () => {
    writeConfig(file, { pgPort: 5435, printers: PRINTERS });
    expect(readConfig(file)).toEqual({ pgPort: 5435, printers: PRINTERS });
    expect(existsSync(`${file}.tmp`)).toBe(false);
  });

  it('keeps pgPort when printer settings are invalid', () => {
    writeFileSync(file, JSON.stringify({ pgPort: 5436, printers: { faktur: { printer: 'X', linesPerPage: 3 } } }));
    expect(readConfig(file)).toEqual({ pgPort: 5436, printers: DEFAULT_PRINTER_SETTINGS });
  });

  it('updateConfig changes one part without clobbering the other', () => {
    updateConfig(file, { printers: PRINTERS });
    updateConfig(file, { pgPort: 5434 });
    expect(readConfig(file)).toEqual({ pgPort: 5434, printers: PRINTERS });
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ pgPort: 5434, printers: PRINTERS });
  });

  it('never hands out the shared defaults object', () => {
    readConfig(file).printers.faktur.linesPerPage = 50;
    expect(DEFAULT_PRINTER_SETTINGS.faktur.linesPerPage).toBe(33);
  });
});
