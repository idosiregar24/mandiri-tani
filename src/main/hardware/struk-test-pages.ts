// Test pages for the cashier's thermal receipt printer (KSR struk). Layout copies the
// iPOS KSR receipt the store uses today (photo 2026-10-24), with fictitious data.
import type { StrukTestPage } from '@shared/printing';
import { fitLeft, fitRight, wrap } from './escp';
import { EscPosWriter } from './escpos';

export interface StrukTestOptions {
  /** Characters per line: 58 mm ≈ 32, 80 mm ≈ 48 (font A). */
  columns: number;
  cut: boolean;
  now?: Date;
}

export function buildStrukTestPages(page: StrukTestPage, opts: StrukTestOptions): Uint8Array {
  const w = new EscPosWriter();
  if (page === 'struk-pola') polaStruk(w, opts);
  if (page === 'struk-contoh') contohStruk(w, opts, opts.now ?? new Date());
  return w.bytes();
}

function finish(w: EscPosWriter, cut: boolean): void {
  w.feed(4);
  if (cut) w.cut();
}

/** A 48-column ruler with marks at 32 / 42 / 48: the last fully printed mark = paper width. */
function polaStruk(w: EscPosWriter, opts: StrukTestOptions): void {
  w.start().bold(true).line('POLA LEBAR STRUK').bold(false);
  let tens = '';
  let units = '';
  for (let i = 1; i <= 48; i++) {
    tens += i % 10 === 0 ? String(i / 10) : ' ';
    units += String(i % 10);
  }
  w.line(tens).line(units);
  for (const n of [32, 42, 48]) w.line(`${'-'.repeat(n - 3)}|${String(n).padStart(2)}`);
  w.line().line('Kolom terakhir yang tercetak utuh dalam satu baris');
  w.line('= lebar struk (32 = 58 mm, 48 = 80 mm).');
  w.line(`Setelan saat ini: ${opts.columns} kolom.`);
  finish(w, opts.cut);
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function contohStruk(w: EscPosWriter, opts: StrukTestOptions, now: Date): void {
  const width = opts.columns;
  const sep = '-'.repeat(width);
  const date = `${pad2(now.getDate())}-${pad2(now.getMonth() + 1)}-${now.getFullYear()}`;
  const time = `${pad2(now.getHours())}:${pad2(now.getMinutes())}:${pad2(now.getSeconds())}`;
  const both = (left: string, right: string) => fitLeft(left, width - right.length) + right;
  const amount = (label: string, value: string) => fitLeft(label, 14) + fitRight(value, width - 14);

  w.start();
  w.align('center').bold(true).size(2, 2).line('MANDIRI TANI').size(1, 1).bold(false).line();
  w.align('left');
  w.line('JL. POROS RAPP km. 72');
  w.line('BUKIT KESUMA, PELALAWAN');
  w.line('Telp: 0813-6144-1706').line();
  w.line(both('No.  : 0000000/KSR/UTM/UJI', date));
  w.line(both('Kasir: KASIR', time));
  w.line('Pel. : UMUM/CASH');
  w.line(sep);
  const items: [string, string, string, string, string][] = [
    ['NPK MUTIARA 16/16/16 1 KG', '22.000,00', '2,00', 'KG', '44.000,00'],
    ['METSULINDO 100 GR', '45.000,00', '1,00', 'BTL', '45.000,00'],
  ];
  for (const [name, price, qty, unit, total] of items) {
    w.line(name);
    // Compact on the left so it also fits 58 mm (32 columns); amount right-aligned.
    w.line(both(`${price} x ${qty} ${unit} =`, ` ${total}`));
  }
  w.line(sep);
  w.bold(true).line(amount('TOTAL', '89.000,00')).bold(false);
  w.line('BRS=2 , QTY=3,00');
  w.line(amount('Tunai       =', '100.000,00'));
  w.line(fitRight('-'.repeat(Math.min(18, width - 14)), width));
  w.line(amount('Kembali     =', '11.000,00')).line();
  for (const l of wrap('Barang yang telah dibeli tidak dapat dikembalikan kecuali ada perjanjian', width)) w.line(l);
  w.line('Terimakasih').line();
  w.align('center');
  for (const l of wrap('*** UJI CETAK - BUKAN TRANSAKSI ***', width)) w.line(l);
  finish(w, opts.cut);
}
