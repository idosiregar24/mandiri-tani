// Document numbers identical to iPOS (PRD §6.7, owner Q-16): {URUT}/{TIPE}/{DEPT}/{BLNTHN},
// e.g. 0001789/JL/UTM/1026. The ONLY place a document number string is built.
import type { Queryable } from '../db/pool';
import { jakartaDate } from './clock';

/** Document types and their iPOS codes. AB/BH/PS/SH/RK/PO are new; OP is iPOS's stock-opname code. */
export const DOC_TYPES = [
  'KSR',
  'JL',
  'RJ',
  'BL',
  'RB',
  'BP',
  'KASO',
  'KSIN',
  'PJ',
  'TRF',
  'AB',
  'BH',
  'PS',
  'SH',
  'RK',
  'PO',
  'OP',
] as const;
export type DocType = (typeof DOC_TYPES)[number];

/** 7 digits for KSR/JL/BL, 4 for every other type — as iPOS tbl_formatnotr.numdgt. */
export function digitsFor(docType: DocType): number {
  return docType === 'KSR' || docType === 'JL' || docType === 'BL' ? 7 : 4;
}

/** Pure formatter: (1789, 'JL', 'UTM', 26-10-2026 WIB) → "0001789/JL/UTM/1026". */
export function formatDocNumber(
  no: number,
  docType: DocType,
  deptCode: string,
  date: Date,
  digits = digitsFor(docType),
): string {
  const { year, month } = jakartaDate(date);
  const urut = String(no).padStart(digits, '0');
  return `${urut}/${docType}/${deptCode.toUpperCase()}/${String(month).padStart(2, '0')}${String(year % 100).padStart(2, '0')}`;
}

/**
 * Takes the next number for (type, warehouse, year) INSIDE the document's transaction: a
 * rollback gives the number back, and the row lock serialises concurrent documents.
 * The sequence restarts every year (Asia/Jakarta, 1 January); go-live seeds last_no from iPOS.
 */
export async function nextDocNumber(tx: Queryable, docType: DocType, deptCode: string, date: Date): Promise<string> {
  const { year } = jakartaDate(date);
  const r = await tx.query<{ last_no: number; digits: number }>(
    `INSERT INTO doc_sequences (doc_type, dept_code, year, digits, last_no) VALUES ($1, $2, $3, $4, 1)
     ON CONFLICT (doc_type, dept_code, year) DO UPDATE SET last_no = doc_sequences.last_no + 1
     RETURNING last_no, digits`,
    [docType, deptCode.toUpperCase(), year, digitsFor(docType)],
  );
  const row = r.rows[0]!;
  return formatDocNumber(row.last_no, docType, deptCode, date, row.digits);
}
