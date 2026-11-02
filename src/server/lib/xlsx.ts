// Excel export for reports (FR-FIN-10, sprint-10 S10-9): one sheet, title + period on top, a
// header row, the rows and an optional totals row. Money and quantities become NUMBER cells so the
// Owner can sum and filter in Excel; the decimal strings are only turned into numbers here, at the
// file boundary — no arithmetic is done on them.
import ExcelJS from 'exceljs';

export type XlsxType = 'text' | 'money' | 'qty' | 'int' | 'percent' | 'date';

export interface XlsxColumn {
  key: string;
  header: string;
  type?: XlsxType;
  /** Width in characters; a sensible default per type otherwise. */
  width?: number;
}

/** Report rows are passed as they are; keys without a column (ids, flags) are simply not written. */
export type XlsxValue = string | number | boolean | null | undefined;

export interface XlsxReport {
  title: string;
  /** e.g. "Periode 1 Okt 2026 – 31 Okt 2026". */
  subtitle?: string;
  columns: XlsxColumn[];
  rows: Record<string, XlsxValue>[];
  /** Shown bold under the rows; keys not present stay empty. */
  totals?: Record<string, XlsxValue>;
  /** Footnotes under the table (e.g. "12 baris tanpa HPP"). */
  notes?: string[];
}

const FORMAT: Record<XlsxType, string | undefined> = {
  text: undefined,
  money: '#,##0',
  qty: '#,##0.####;-#,##0.####;0',
  int: '#,##0',
  percent: '0.0%',
  date: 'dd/mm/yyyy',
};
const WIDTH: Record<XlsxType, number> = { text: 24, money: 16, qty: 12, int: 10, percent: 10, date: 12 };

function cellValue(type: XlsxType, v: XlsxValue): ExcelJS.CellValue {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'boolean') return v ? 'Ya' : 'Tidak';
  if (type === 'text') return String(v);
  if (type === 'date') {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v));
    return m ? new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))) : String(v);
  }
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return String(v);
  return type === 'percent' ? n / 100 : n; // percent columns carry "12.5" meaning 12,5 %
}

export async function buildReportXlsx(report: XlsxReport): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Mandiri Tani POS';
  wb.created = new Date();
  const ws = wb.addWorksheet(report.title.slice(0, 31).replace(/[\\/?*[\]:]/g, ' '));
  const cols = report.columns.map((c) => ({ ...c, type: c.type ?? ('text' as XlsxType) }));

  ws.addRow([report.title]).font = { bold: true, size: 14 };
  if (report.subtitle) ws.addRow([report.subtitle]);
  ws.addRow([]);

  const header = ws.addRow(cols.map((c) => c.header));
  header.font = { bold: true };
  header.eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF2F2F0' } };
    cell.border = { bottom: { style: 'thin' } };
  });
  const headerRow = header.number;

  for (const row of report.rows) ws.addRow(cols.map((c) => cellValue(c.type, row[c.key])));
  if (report.totals) {
    const t = ws.addRow(cols.map((c) => cellValue(c.type, report.totals![c.key])));
    t.font = { bold: true };
    t.eachCell((cell) => (cell.border = { top: { style: 'thin' } }));
  }
  for (const note of report.notes ?? []) ws.addRow([note]).font = { italic: true };

  cols.forEach((c, i) => {
    const col = ws.getColumn(i + 1);
    col.width = c.width ?? WIDTH[c.type];
    const fmt = FORMAT[c.type];
    if (fmt) col.numFmt = fmt;
    if (c.type !== 'text') col.alignment = { horizontal: 'right' };
  });
  ws.views = [{ state: 'frozen', ySplit: headerRow }];
  ws.pageSetup = {
    paperSize: 9,
    orientation: cols.length > 7 ? 'landscape' : 'portrait',
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
  };

  return Buffer.from(await wb.xlsx.writeBuffer());
}
