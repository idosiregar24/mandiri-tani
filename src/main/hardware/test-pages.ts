// The three Sprint 0 test pages (same as tools/uji-cetak), built with the app's own
// ESC/P encoder so a good test print proves the real print path (sprint-0 plan).
import type { FakturTestPage } from '@shared/printing';
import { EscpWriter, fitLeft, fitRight, type PageSetup } from './escp';

const FAKTUR_COLUMNS = 96; // 12 cpi on the LX-310's 8" print width (PRD §8.1)

export interface TestPageOptions {
  linesPerPage: number;
  nlq: boolean;
  now?: Date;
}

export function buildTestPages(page: FakturTestPage, opts: TestPageOptions): Uint8Array {
  const w = new EscpWriter();
  const setup: PageSetup = { linesPerPage: opts.linesPerPage, nlq: opts.nlq, cpi: 12 };
  if (page === 'pola' || page === 'semua') polaPage(w, setup);
  if (page === 'font' || page === 'semua') fontPage(w, setup);
  if (page === 'faktur' || page === 'semua') fakturPage(w, setup, opts.now ?? new Date());
  return w.bytes();
}

/** Column ruler + numbered lines: proves 96 columns fit and N lines end at the perforation. */
function polaPage(w: EscpWriter, setup: PageSetup): void {
  const cols = setup.cpi === 12 ? 96 : 80;
  w.start(setup);
  let tens = '';
  let units = '';
  for (let i = 1; i <= cols; i++) {
    tens += i % 10 === 0 ? String((i / 10) % 10) : ' ';
    units += String(i % 10);
  }
  w.line(tens).line(units);
  for (let i = 3; i <= setup.linesPerPage; i++) {
    let label = `baris ${String(i).padStart(2)}`;
    if (i === 3)
      label = `baris  3  POLA POSISI - ${cols} kolom @ ${setup.cpi} cpi, ${setup.linesPerPage} baris/halaman`;
    if (i === setup.linesPerPage) label = `baris ${i}  TERAKHIR - perforasi harus tepat di bawah baris ini`;
    const text = `${fitLeft(label, cols - 1)}|`;
    if (i === setup.linesPerPage) w.text(text);
    else w.line(text);
  }
  w.formFeed();
}

function fontPage(w: EscpWriter, setup: PageSetup): void {
  const sample = 'NPK MUTIARA 16/16/16  50 KG   Rp 730.000,00';
  w.start(setup);
  w.bold(true).line('UJI FONT EPSON LX-310 - MANDIRI TANI POS').bold(false).line();
  w.quality(false).pitch(10).line(`DRAFT 10 cpi : ${sample}`);
  w.pitch(12).line(`DRAFT 12 cpi : ${sample}`);
  w.condensed(true).line(`DRAFT condensed (17 cpi) : ${sample}`).condensed(false);
  w.quality(true).typeface(0).pitch(12).line(`NLQ Roman 12 : ${sample}`);
  w.typeface(1).line(`NLQ Sans  12 : ${sample}`);
  w.quality(setup.nlq).pitch(setup.cpi).line();
  w.bold(true).line('TEBAL : TOTAL AKHIR   Rp 375.000,00').bold(false);
  w.doubleWidth(true).line('LEBAR GANDA : 0001789/JL').doubleWidth(false).line();
  w.line('Angka & tanda: 0123456789 ., : / - ( ) % Rp');
  w.line('Garis        : ------------------------------------------------').line();
  w.line('Catat mana yang paling mudah dibaca: DRAFT / NLQ Roman / NLQ Sans.');
  w.formFeed();
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** Faktur Penjualan in the iPOS layout (PRD §8.1) with fictitious data. Always 12 cpi. */
function fakturPage(w: EscpWriter, setup: PageSetup, now: Date): void {
  const width = FAKTUR_COLUMNS;
  const sep = '-'.repeat(width);
  const leftW = 35;
  const tgl = `${pad2(now.getDate())}/${pad2(now.getMonth() + 1)}/${now.getFullYear()} ${pad2(now.getHours())}.${pad2(now.getMinutes())}`;
  w.start({ ...setup, cpi: 12 });
  w.line();
  const header: [string, string, string][] = [
    ['FAKTUR PENJUALAN', 'No Transaksi : 0000000/JL/UTM/UJI', 'Dept : UTM'],
    ['MANDIRI TANI', `Tanggal      : ${tgl}`, 'User : KASIR'],
    ['JL. POROS RAPP km. 72', 'Pelanggan    : PELANGGAN CONTOH (UJI CETAK)', ''],
    ['0813-6144-1706', 'Alamat       : JL. CONTOH', ''],
  ];
  header.forEach(([left, mid, right], i) => {
    if (i === 0) w.bold(true);
    w.text(fitLeft(left, leftW));
    if (i === 0) w.bold(false);
    w.line((fitLeft(mid, width - leftW - 12) + fitLeft(right, 12)).trimEnd());
  });

  // Columns: No 2, Kode 14, Nama 30, Jml 6, Satuan 6, Harga 12, Pot% 5, Total 13 (+ spaces = 95).
  const row = (c: string[]) =>
    [
      fitRight(c[0]!, 2),
      fitLeft(c[1]!, 14),
      fitLeft(c[2]!, 30),
      fitRight(c[3]!, 6),
      fitLeft(c[4]!, 6),
      fitRight(c[5]!, 12),
      fitRight(c[6]!, 5),
      fitRight(c[7]!, 13),
    ].join(' ');
  w.line(sep);
  w.line(row(['No', 'Kode Item', 'Nama Item', 'Jml', 'Satuan', 'Harga', 'Pot%', 'Total']));
  w.line(sep);
  w.line(row(['1', 'NARA UP 5', 'NARA UP 5 LTR', '1,00', 'PAIL', '330.000,00', '0,00', '330.000,00']));
  w.line(row(['2', 'METSULINDO 100', 'METSULINDO 100 GR', '1,00', 'BTL', '45.000,00', '0,00', '45.000,00']));
  w.line(row(['3', 'NPK MUTIARA', 'NPK MUTIARA 16/16/16 1 KG', '2,00', 'ZAK', '730.000,00', '0,00', '1.460.000,00']));
  w.line(sep);

  const sumLeftW = 33;
  const midW = 25;
  const rightW = width - sumLeftW - midW;
  const summary: [string, string, string, string][] = [
    ['Keterangan :', 'Jml Item   :   4,00', 'Sub Total   :', '1.835.000,00'],
    ['', 'Potongan   :   0,00', 'Biaya Lain  :', '0,00'],
    ['      Penerima', 'Tanggal Jt : 03/11/2026', 'TOTAL AKHIR :', '1.835.000,00'],
    ['', '', 'Tunai       :', '835.000,00'],
    ['', '', 'Kredit      :', '1.000.000,00'],
    ['  (..............)', '', 'Kembali     :', '0,00'],
  ];
  for (const [left, mid, label, amount] of summary) {
    const isTotal = label.startsWith('TOTAL');
    w.text(fitLeft(left, sumLeftW) + fitLeft(mid, midW));
    if (isTotal) w.bold(true);
    w.text(fitLeft(label, 14) + fitRight(amount, rightW - 14));
    if (isTotal) w.bold(false);
    w.line();
  }
  w.line().line('Terbilang : satu juta delapan ratus tiga puluh lima ribu rupiah').line();
  w.line('*** UJI CETAK - BUKAN TRANSAKSI ***');
  w.formFeed();
}
