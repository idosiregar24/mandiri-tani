// Exercises the real PowerShell + winspool helper (compiles the C#, calls OpenPrinter)
// without needing a physical printer.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { listWindowsPrinters, RawPrintError, sendRaw } from './windows-raw';

const helperDir = mkdtempSync(join(tmpdir(), 'mtpos-raw-'));
afterAll(() => rmSync(helperDir, { recursive: true, force: true }));

describe('sendRaw (windows-raw transport)', () => {
  it('reports a missing printer with a clear Indonesian message', async () => {
    const err = await sendRaw('Printer Yang Tidak Ada 123', new Uint8Array([0x1b, 0x40]), { helperDir }).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(RawPrintError);
    expect((err as RawPrintError).message).toMatch(/Printer tidak ditemukan/);
    expect((err as RawPrintError).detail).toMatch(/OpenPrinter/);
  });

  it('lists Windows printer queues with port and status', async () => {
    const printers = await listWindowsPrinters();
    const pdf = printers.find((p) => p.name === 'Microsoft Print to PDF');
    expect(pdf).toMatchObject({ port: 'PORTPROMPT:', status: expect.any(String) });
  });

  it('treats the printer name as data, never as a command', async () => {
    const err = await sendRaw('x"; Remove-Item C:\\nope; "', new Uint8Array([0x40]), { helperDir }).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(RawPrintError);
    expect((err as RawPrintError).detail).toMatch(/OpenPrinter/);
  });
});
