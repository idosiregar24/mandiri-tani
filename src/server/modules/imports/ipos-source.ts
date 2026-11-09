// Read-only access to the temporary `ipos_import` database the main process restored the
// iPOS backup into (sprint-3 S3-3/S3-4). Nothing here writes to it, and nothing is hard-coded
// from one particular backup — the fingerprint below is checked first (FR-MIG-09).
import type { FingerprintProblem, IposHistoryCounts, IposSourceInfo } from '@shared/schemas/imports';
import { createPool, type DbConfig, type Queryable } from '../../db/pool';
import { AppError } from '../../lib/errors';

/** Tables & columns the MASTER scope reads. A backup missing any of them is refused. */
export const MASTER_FINGERPRINT: Record<string, readonly string[]> = {
  tbl_itemsatuan: ['satuan', 'ketsatuan'],
  tbl_itemjenis: ['jenis', 'ketjenis'],
  tbl_item: [
    'kodeitem',
    'namaitem',
    'jenis',
    'tipe',
    'satuan',
    'stokmin',
    'sistemhargajual',
    'hargajual1',
    'statusjual',
    'statushapus',
  ],
  tbl_itemsatuanjml: ['kodeitem', 'satuan', 'jumlahkonv', 'kodebarcode', 'tipe'],
  tbl_itemhj: ['kodeitem', 'tipehj', 'jmlsampai', 'level', 'satuan', 'hargajual'],
  tbl_supelgrup: ['kgrup', 'grup', 'potongan'],
  tbl_supel: [
    'kode',
    'tipe',
    'nama',
    'alamat',
    'kota',
    'telepon',
    'kontak',
    'keterangan',
    'limitjmlhupi',
    'harijt',
    'kgrup',
    'stsaktif',
  ],
  tbl_bank: ['kodebank', 'namabank'],
  tbl_kantor: ['kodekantor', 'namakantor'],
  tbl_conf: ['confname', 'confvalue'],
  tbl_ikhd: ['notransaksi', 'tipe'],
  tbl_ikdt: ['notransaksi', 'kodeitem', 'satuan'],
  tbl_imhd: ['notransaksi', 'tipe'],
  tbl_imdt: ['notransaksi', 'kodeitem', 'satuan'],
};

const SOURCE_MISSING = () =>
  new AppError('IPOS_SOURCE_MISSING', 'Belum ada backup iPOS yang dibuka. Pilih file backup iPOS (.i5bu) dulu.', 409);

/** Runs `fn` against ipos_import with a short-lived pool, closed afterwards so the main process can drop the database. */
export async function withIposDb<T>(config: DbConfig, fn: (db: Queryable) => Promise<T>): Promise<T> {
  const pool = createPool(config);
  try {
    return await fn(pool);
  } catch (err) {
    // 3D000 invalid_catalog_name: the temporary database does not exist (no file chosen yet).
    if (typeof err === 'object' && err !== null && (err as { code?: string }).code === '3D000') throw SOURCE_MISSING();
    throw err;
  } finally {
    await pool.end();
  }
}

export async function readSourceInfo(db: Queryable): Promise<IposSourceInfo> {
  const exists = await db.query("SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = '_mtpos_source'");
  if (!exists.rowCount) throw SOURCE_MISSING();
  const r = await db.query<IposSourceInfo>(
    `SELECT file_name AS "fileName", sha256, size_bytes::int AS "sizeBytes", dump_created_at AS "dumpCreatedAt",
            source_version AS "sourceVersion", tables, restored_at AS "restoredAt"
     FROM _mtpos_source ORDER BY restored_at DESC LIMIT 1`,
  );
  if (!r.rows[0]) throw SOURCE_MISSING();
  return r.rows[0];
}

export async function checkFingerprint(
  db: Queryable,
  required: Record<string, readonly string[]> = MASTER_FINGERPRINT,
): Promise<FingerprintProblem[]> {
  const r = await db.query<{ table_name: string; column_name: string }>(
    `SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = ANY($1)`,
    [Object.keys(required)],
  );
  const have = new Map<string, Set<string>>();
  for (const row of r.rows) {
    if (!have.has(row.table_name)) have.set(row.table_name, new Set());
    have.get(row.table_name)!.add(row.column_name);
  }
  const problems: FingerprintProblem[] = [];
  for (const [table, columns] of Object.entries(required)) {
    const cols = have.get(table);
    if (!cols) problems.push({ table, missingColumns: [] });
    else {
      const missing = columns.filter((c) => !cols.has(c));
      if (missing.length) problems.push({ table, missingColumns: missing });
    }
  }
  return problems;
}

// ------------------------------------------------------------------ master-scope rows (raw, as iPOS stores them)
export interface IposUnit {
  satuan: string;
  ketsatuan: string | null;
}
export interface IposJenis {
  jenis: string;
  ketjenis: string | null;
}
export interface IposItem {
  kodeitem: string;
  namaitem: string | null;
  jenis: string | null;
  tipe: string | null;
  satuan: string | null;
  stokmin: string | null;
  sistemhargajual: string | null;
  hargajual1: string | null;
  statusjual: string | null;
  statushapus: string | null;
}
export interface IposItemUnit {
  kodeitem: string;
  satuan: string;
  jumlahkonv: string | null;
  kodebarcode: string | null;
  tipe: string | null;
}
export interface IposItemPrice {
  kodeitem: string;
  satuan: string;
  hargajual: string | null;
  level: number | null;
  jmlsampai: string | null;
}
export interface IposGroup {
  kgrup: string;
  grup: string | null;
  potongan: string | null;
}
export interface IposPartner {
  kode: string;
  tipe: 'PL' | 'SU';
  nama: string | null;
  alamat: string | null;
  kota: string | null;
  telepon: string | null;
  kontak: string | null;
  keterangan: string | null;
  limitjmlhupi: string | null;
  harijt: number | null;
  kgrup: string | null;
  stsaktif: string | null;
}
export interface IposBank {
  kodebank: string;
  namabank: string | null;
}
export interface IposOffice {
  kodekantor: string;
  namakantor: string | null;
}
export interface UnitUsage {
  kodeitem: string;
  satuan: string;
  n: number;
}

export interface IposMasterRows {
  units: IposUnit[];
  jenis: IposJenis[];
  items: IposItem[];
  itemUnits: IposItemUnit[];
  itemPrices: IposItemPrice[];
  groups: IposGroup[];
  partners: IposPartner[];
  banks: IposBank[];
  offices: IposOffice[];
  defaultTermDays: number | null;
  saleUnitUsage: UnitUsage[];
  purchaseUnitUsage: UnitUsage[];
  /**
   * Unit prices counted by SQL in iPOS itself, independent of the JS mapping — the "iPOS" side
   * of the reconciliation must not share the importer's parsing, or a parsing bug hides itself.
   */
  pricedUnitsInSource: number;
}

export async function loadMasterRows(db: Queryable): Promise<IposMasterRows> {
  const q = async <T>(sql: string): Promise<T[]> => (await db.query<T & object>(sql)).rows as T[];
  const [
    units,
    jenis,
    items,
    itemUnits,
    itemPrices,
    groups,
    partners,
    banks,
    offices,
    conf,
    saleUnitUsage,
    purchaseUnitUsage,
    priced,
  ] = await Promise.all([
    q<IposUnit>('SELECT satuan, ketsatuan FROM tbl_itemsatuan WHERE satuan IS NOT NULL'),
    q<IposJenis>('SELECT jenis, ketjenis FROM tbl_itemjenis WHERE jenis IS NOT NULL'),
    q<IposItem>(
      `SELECT kodeitem, namaitem, jenis, tipe, satuan, stokmin::text AS stokmin, sistemhargajual, hargajual1::text AS hargajual1,
              statusjual, statushapus
       FROM tbl_item WHERE kodeitem IS NOT NULL ORDER BY kodeitem`,
    ),
    q<IposItemUnit>(
      'SELECT kodeitem, satuan, jumlahkonv::text AS jumlahkonv, kodebarcode, tipe FROM tbl_itemsatuanjml WHERE satuan IS NOT NULL',
    ),
    q<IposItemPrice>(
      `SELECT kodeitem, satuan, hargajual::text AS hargajual, level, jmlsampai::text AS jmlsampai
       FROM tbl_itemhj WHERE tipehj = 'S' AND satuan IS NOT NULL`,
    ),
    q<IposGroup>('SELECT kgrup, grup, potongan::text AS potongan FROM tbl_supelgrup WHERE kgrup IS NOT NULL'),
    q<IposPartner>(
      `SELECT kode, tipe, nama, alamat, kota, telepon, kontak, keterangan, limitjmlhupi::text AS limitjmlhupi, harijt, kgrup, stsaktif
       FROM tbl_supel WHERE tipe IN ('PL', 'SU') AND kode IS NOT NULL ORDER BY tipe, kode`,
    ),
    q<IposBank>('SELECT kodebank, namabank FROM tbl_bank WHERE kodebank IS NOT NULL ORDER BY kodebank'),
    q<IposOffice>('SELECT kodekantor, namakantor FROM tbl_kantor WHERE kodekantor IS NOT NULL'),
    q<{ confvalue: string | null }>("SELECT confvalue FROM tbl_conf WHERE confname = 'DEF_JATUH_TEMPO'"),
    q<UnitUsage>(
      `SELECT d.kodeitem, d.satuan, count(*)::int AS n FROM tbl_ikdt d JOIN tbl_ikhd h ON h.notransaksi = d.notransaksi
       WHERE h.tipe IN ('KSR', 'JL') AND d.kodeitem IS NOT NULL AND d.satuan IS NOT NULL GROUP BY 1, 2`,
    ),
    q<UnitUsage>(
      `SELECT d.kodeitem, d.satuan, count(*)::int AS n FROM tbl_imdt d JOIN tbl_imhd h ON h.notransaksi = d.notransaksi
       WHERE h.tipe = 'BL' AND d.kodeitem IS NOT NULL AND d.satuan IS NOT NULL GROUP BY 1, 2`,
    ),
    // Same rule as S3-5, written directly in SQL: type S → priced units in tbl_itemhj; otherwise hargajual1.
    q<{ n: number }>(
      `SELECT (SELECT count(*) FROM (
                SELECT DISTINCT h.kodeitem, upper(trim(h.satuan))
                FROM tbl_itemhj h JOIN tbl_item i ON i.kodeitem = h.kodeitem
                WHERE upper(i.sistemhargajual) = 'S' AND h.tipehj = 'S' AND coalesce(h.level, 0) <= 1
                  AND coalesce(h.jmlsampai, 0) = 0 AND h.hargajual > 0
                  AND (upper(trim(h.satuan)) = upper(trim(i.satuan)) OR EXISTS (
                        SELECT 1 FROM tbl_itemsatuanjml s WHERE s.kodeitem = h.kodeitem AND upper(trim(s.satuan)) = upper(trim(h.satuan))))) x)
            + (SELECT count(*) FROM tbl_item WHERE upper(coalesce(sistemhargajual, '')) <> 'S' AND hargajual1 > 0) AS n`,
    ),
  ]);
  const term = Number.parseInt(conf[0]?.confvalue ?? '', 10);
  return {
    units,
    jenis,
    items,
    itemUnits,
    itemPrices,
    groups,
    partners,
    banks,
    offices,
    defaultTermDays: Number.isFinite(term) && term >= 0 ? term : null,
    saleUnitUsage,
    purchaseUnitUsage,
    pricedUnitsInSource: Number(priced[0]?.n ?? 0),
  };
}

// ------------------------------------------------------------------ opening-stock scope (FR-MIG-02, Sprint 4)
/** The only iPOS office the store uses (Analisis §2) — its stock becomes the default warehouse's. */
export const IPOS_OFFICE = 'UTM';

export const STOCK_FINGERPRINT: Record<string, readonly string[]> = {
  tbl_itemstok: ['kodeitem', 'kantor', 'stok', 'hppdasar'],
  tbl_item_im: ['iddetail', 'kodeitem', 'kodekantor', 'tanggal', 'tipe', 'hargadasar', 'sisa'],
};

export interface IposLayer {
  iddetail: string;
  kodeitem: string;
  /** "2026-01-02T08:00:00" — iPOS local time (WIB), read as text so the Node time zone cannot shift it. */
  tanggal: string;
  tipe: string | null;
  hargadasar: string;
  sisa: string;
}
export interface IposItemStock {
  kodeitem: string;
  stok: string;
  hppdasar: string | null;
}

export interface IposStockRows {
  layers: IposLayer[];
  stocks: IposItemStock[];
  /** kodeitem → hargadasar of the newest purchase (BL) layer, else of the newest layer (S4-4). */
  lastCost: Map<string, string>;
  /** Counted by SQL in iPOS itself — the "iPOS" side of the reconciliation (S3-11). */
  source: { products: number; layers: number; qty: string; value: string; minusProducts: number };
}

export async function loadStockRows(db: Queryable): Promise<IposStockRows> {
  const [layers, stocks, last, totals] = await Promise.all([
    db.query<IposLayer>(
      `SELECT iddetail, trim(kodeitem) AS kodeitem, to_char(tanggal, 'YYYY-MM-DD"T"HH24:MI:SS') AS tanggal, tipe,
              hargadasar::text AS hargadasar, sisa::text AS sisa
       FROM tbl_item_im WHERE kodekantor = $1 AND sisa > 0 AND kodeitem IS NOT NULL
       ORDER BY kodeitem, tanggal, iddetail`,
      [IPOS_OFFICE],
    ),
    db.query<IposItemStock>(
      `SELECT trim(kodeitem) AS kodeitem, stok::text AS stok, hppdasar::text AS hppdasar
       FROM tbl_itemstok WHERE kantor = $1 AND kodeitem IS NOT NULL AND stok <> 0`,
      [IPOS_OFFICE],
    ),
    db.query<{ kodeitem: string; hargadasar: string }>(
      `SELECT DISTINCT ON (trim(kodeitem)) trim(kodeitem) AS kodeitem, hargadasar::text AS hargadasar
       FROM tbl_item_im WHERE kodekantor = $1 AND kodeitem IS NOT NULL AND hargadasar > 0
       ORDER BY trim(kodeitem), (tipe = 'BL') DESC, tanggal DESC, iddetail DESC`,
      [IPOS_OFFICE],
    ),
    db.query<IposStockRows['source']>(
      `SELECT (SELECT count(*) FROM tbl_itemstok WHERE kantor = $1 AND stok <> 0)::int AS products,
              (SELECT count(*) FROM tbl_item_im WHERE kodekantor = $1 AND sisa > 0)::int AS layers,
              (SELECT coalesce(sum(stok), 0)::numeric(18,4)::text FROM tbl_itemstok WHERE kantor = $1) AS qty,
              (SELECT round(coalesce(sum(sisa * hargadasar), 0), 2)::text FROM tbl_item_im WHERE kodekantor = $1 AND sisa > 0) AS value,
              (SELECT count(*) FROM tbl_itemstok WHERE kantor = $1 AND stok < 0)::int AS "minusProducts"`,
      [IPOS_OFFICE],
    ),
  ]);
  return {
    layers: layers.rows,
    stocks: stocks.rows,
    lastCost: new Map(last.rows.map((r) => [r.kodeitem, r.hargadasar])),
    source: totals.rows[0]!,
  };
}

// ------------------------------------------------------------------ open receivables & payables (sprint-9 A7)
const CREDIT_COLUMNS = [
  'notransaksi',
  'tanggal',
  'tipe',
  'kodesupel',
  'jmlkredit',
  'krd_jml_byr',
  'krd_jml_pot',
  'byr_krd_jt',
];
// How iPOS keeps a credit sale (backup 2026-10-24, aggregates; verified on every credit note):
// - tbl_ikhd.jmltunai = paid at the counter (the DP), jmlkredit = what became credit; only JL
//   notes have credit (KSR never), 485 of 2.187 credit notes had a DP
// - every instalment is a BP (tbl_byrpiutanghd) split per note in tbl_byrpiutangdt (notrsmasuk,
//   krd_jml_byr); per note Σ dt.krd_jml_byr = tbl_ikhd.krd_jml_byr, per BP Σ dt = totalbayar
// - krd_jml_pot = a deduction on the credit (0 in the store's data) → lowers what is owed
export const AR_AP_FINGERPRINT: Record<string, readonly string[]> = {
  tbl_ikhd: CREDIT_COLUMNS,
  tbl_imhd: CREDIT_COLUMNS,
  tbl_byrpiutanghd: ['notransaksi', 'tanggal', 'kodesupel', 'totalbayar', 'keterangan'],
  tbl_byrpiutangdt: ['notransaksi', 'notrsmasuk', 'krd_jml_byr'],
};

/** A sales note (tbl_ikhd) or purchase invoice (tbl_imhd) with credit left. */
export interface IposOpenCredit {
  notransaksi: string;
  kodesupel: string;
  tanggal: string;
  /** NULL when iPOS has no due date (byr_krd_jt). */
  jatuhtempo: string | null;
  open: string;
}

/** Every iPOS sales note that went (partly) on credit — paid off or not. */
export interface IposCreditNote extends IposOpenCredit {
  /** jmlkredit − krd_jml_pot: what the customer owed. */
  credit: string;
  /** krd_jml_byr: paid off so far through BP payments. */
  paid: string;
}

/** One BP payment and how iPOS split it over the notes. */
export interface IposArPayment {
  notransaksi: string;
  /** "2026-01-02T08:00:00" — iPOS local time (WIB). */
  tanggal: string;
  kodesupel: string;
  total: string;
  keterangan: string | null;
  allocations: { note: string; amount: string }[];
}

export interface IposArApRows {
  credits: IposCreditNote[];
  payments: IposArPayment[];
  payables: IposOpenCredit[];
  /** Totals counted in iPOS itself, for the reconciliation. */
  source: {
    receivables: number;
    receivablesOpen: string;
    customers: number;
    creditNotes: number;
    creditTotal: string;
    payments: number;
    paymentsTotal: string;
    payables: number;
    payablesOpen: string;
  };
}

const OPEN = `(jmlkredit - coalesce(krd_jml_byr, 0) - coalesce(krd_jml_pot, 0))`;
const creditDocs = (table: 'tbl_ikhd' | 'tbl_imhd', where: string) => `
  SELECT trim(notransaksi) AS notransaksi, trim(coalesce(kodesupel, '')) AS kodesupel, tanggal::date::text AS tanggal,
         byr_krd_jt::date::text AS jatuhtempo, round(${OPEN}, 2)::text AS open,
         round(jmlkredit - coalesce(krd_jml_pot, 0), 2)::text AS credit, round(coalesce(krd_jml_byr, 0), 2)::text AS paid
  FROM ${table} WHERE ${where}
  ORDER BY tanggal, notransaksi`;

export async function loadArApRows(db: Queryable): Promise<IposArApRows> {
  const [credits, payments, allocations, payables, totals] = await Promise.all([
    db.query<IposCreditNote>(creditDocs('tbl_ikhd', 'jmlkredit > 0')),
    db.query<Omit<IposArPayment, 'allocations'>>(
      `SELECT trim(notransaksi) AS notransaksi, to_char(tanggal, 'YYYY-MM-DD"T"HH24:MI:SS') AS tanggal,
              trim(coalesce(kodesupel, '')) AS kodesupel, round(coalesce(totalbayar, 0), 2)::text AS total,
              nullif(trim(keterangan), '') AS keterangan
       FROM tbl_byrpiutanghd ORDER BY tanggal, notransaksi`,
    ),
    db.query<{ payment: string; note: string; amount: string }>(
      `SELECT trim(notransaksi) AS payment, trim(notrsmasuk) AS note, round(sum(krd_jml_byr), 2)::text AS amount
       FROM tbl_byrpiutangdt WHERE krd_jml_byr > 0 GROUP BY 1, 2 ORDER BY 1, 2`,
    ),
    db.query<IposOpenCredit>(creditDocs('tbl_imhd', `${OPEN} > 0`)),
    db.query<IposArApRows['source']>(
      `WITH r AS (SELECT kodesupel, jmlkredit - coalesce(krd_jml_pot, 0) AS credit, ${OPEN} AS open FROM tbl_ikhd WHERE jmlkredit > 0),
            p AS (SELECT ${OPEN} AS open FROM tbl_imhd)
       SELECT (SELECT count(*) FROM r WHERE open > 0)::int AS receivables,
              (SELECT round(coalesce(sum(open), 0), 2)::text FROM r WHERE open > 0) AS "receivablesOpen",
              (SELECT count(DISTINCT trim(kodesupel)) FROM r WHERE open > 0)::int AS customers,
              (SELECT count(*) FROM r)::int AS "creditNotes",
              (SELECT round(coalesce(sum(credit), 0), 2)::text FROM r) AS "creditTotal",
              (SELECT count(*) FROM tbl_byrpiutanghd)::int AS payments,
              (SELECT round(coalesce(sum(totalbayar), 0), 2)::text FROM tbl_byrpiutanghd) AS "paymentsTotal",
              (SELECT count(*) FROM p WHERE open > 0)::int AS payables,
              (SELECT round(coalesce(sum(open), 0), 2)::text FROM p WHERE open > 0) AS "payablesOpen"`,
    ),
  ]);
  const split = new Map<string, IposArPayment['allocations']>();
  for (const a of allocations.rows) {
    const list = split.get(a.payment) ?? [];
    list.push({ note: a.note, amount: a.amount });
    split.set(a.payment, list);
  }
  return {
    credits: credits.rows,
    payments: payments.rows.map((p) => ({ ...p, allocations: split.get(p.notransaksi) ?? [] })),
    payables: payables.rows,
    source: totals.rows[0]!,
  };
}

// ------------------------------------------------------------------ 2-year history (sprint-10 S10-10)
const DOC_COLUMNS = [
  'notransaksi',
  'kodekantor',
  'tanggal',
  'tipe',
  'kodesupel',
  'keterangan',
  'subtotal',
  'potnomfaktur',
  'pajak',
  'biayalain',
  'totalakhir',
  'jmltunai',
  'jmlkredit',
  'byr_krd_jt',
];
const LINE_COLUMNS = [
  'iddetail',
  'nobaris',
  'notransaksi',
  'kodeitem',
  'jumlah',
  'satuan',
  'harga',
  'potongan',
  'total',
  'jmlkonversi',
];
export const HISTORY_FINGERPRINT: Record<string, readonly string[]> = {
  tbl_ikhd: DOC_COLUMNS,
  tbl_ikdt: LINE_COLUMNS,
  tbl_item_ik: ['iddetailtrs', 'tipe', 'jumlahdasar', 'hargadasar'],
  tbl_imhd: DOC_COLUMNS,
  tbl_imdt: LINE_COLUMNS,
  tbl_acckashd: ['notransaksi', 'kodekantor', 'tanggal', 'tipe', 'jumlah'],
  tbl_acckasdt: ['notransaksi', 'nobaris', 'jumlah', 'keterangan'],
};

/** A sales note (KSR/JL) or purchase invoice (BL) header. Money as decimal text. */
export interface IposHistDoc {
  notransaksi: string;
  tipe: string;
  /** "2026-01-02T08:00:00" — iPOS local time (WIB). */
  tanggal: string;
  kodesupel: string;
  keterangan: string | null;
  subtotal: string;
  potnomfaktur: string;
  pajak: string;
  biayalain: string;
  totalakhir: string;
  jmltunai: string;
  jmlkredit: string;
  jatuhtempo: string | null;
}

export interface IposHistLine {
  notransaksi: string;
  kodeitem: string;
  satuan: string;
  jumlah: string;
  harga: string;
  potongan: string;
  total: string;
  jmlkonversi: string;
  /** Sales only: Σ jumlahdasar × hargadasar of the FIFO layers the line used (tbl_item_ik). */
  cost: string | null;
  /** Sales only: a layer had cost 0, or none was recorded — iPOS did not know the HPP (DQ-3). */
  costUnknown: boolean;
}

export interface IposCashLine {
  notransaksi: string;
  tanggal: string;
  nobaris: number;
  jumlah: string;
  keterangan: string | null;
}

export interface IposHistoryRows {
  sales: IposHistDoc[];
  saleLines: IposHistLine[];
  purchases: IposHistDoc[];
  purchaseLines: IposHistLine[];
  cash: IposCashLine[];
  source: IposHistoryCounts;
}

const histDocs = (table: 'tbl_ikhd' | 'tbl_imhd', types: string) => `
  SELECT trim(notransaksi) AS notransaksi, tipe, to_char(tanggal, 'YYYY-MM-DD"T"HH24:MI:SS') AS tanggal,
         trim(coalesce(kodesupel, '')) AS kodesupel, nullif(trim(keterangan), '') AS keterangan,
         round(coalesce(subtotal, 0), 2)::text AS subtotal, round(coalesce(potnomfaktur, 0), 2)::text AS potnomfaktur,
         round(coalesce(pajak, 0), 2)::text AS pajak, round(coalesce(biayalain, 0), 2)::text AS biayalain,
         round(coalesce(totalakhir, 0), 2)::text AS totalakhir, round(coalesce(jmltunai, 0), 2)::text AS jmltunai,
         round(coalesce(jmlkredit, 0), 2)::text AS jmlkredit, byr_krd_jt::date::text AS jatuhtempo
  FROM ${table} WHERE kodekantor = $1 AND tipe IN (${types})
  ORDER BY tanggal, notransaksi`;

/** HPP per sales line from the FIFO consumption rows (tbl_item_ik.iddetailtrs = line iddetail). */
const LINE_COST = `c AS (
  SELECT iddetailtrs, sum(jumlahdasar * hargadasar) AS cost, bool_or(hargadasar = 0) AS zero
  FROM tbl_item_ik WHERE tipe IN ('KSR','JL') GROUP BY iddetailtrs)`;

const histLines = (line: 'tbl_ikdt' | 'tbl_imdt', head: 'tbl_ikhd' | 'tbl_imhd', types: string, withCost: boolean) => `
  ${withCost ? `WITH ${LINE_COST}` : ''}
  SELECT trim(d.notransaksi) AS notransaksi, trim(d.kodeitem) AS kodeitem, trim(d.satuan) AS satuan,
         d.jumlah::text AS jumlah, round(d.harga, 2)::text AS harga, round(coalesce(d.potongan, 0), 2)::text AS potongan,
         round(d.total, 2)::text AS total, coalesce(nullif(d.jmlkonversi, 0), 1)::text AS jmlkonversi,
         ${withCost ? `CASE WHEN c.zero IS FALSE THEN round(c.cost, 2)::text END AS cost, (c.zero IS NOT FALSE) AS "costUnknown"` : `NULL AS cost, false AS "costUnknown"`}
  FROM ${line} d JOIN ${head} h ON h.notransaksi = d.notransaksi
  ${withCost ? 'LEFT JOIN c ON c.iddetailtrs = d.iddetail' : ''}
  WHERE h.kodekantor = $1 AND h.tipe IN (${types})
  ORDER BY d.notransaksi, d.nobaris, d.iddetail`;

export async function loadHistoryRows(db: Queryable): Promise<IposHistoryRows> {
  // A fresh restore has no planner statistics: without them the line ⋈ FIFO-row joins become nested
  // loops over 15.000 × 15.000 rows and hit the statement timeout. ANALYZE reads, it changes no data.
  await db.query('ANALYZE tbl_ikhd, tbl_ikdt, tbl_item_ik, tbl_imhd, tbl_imdt, tbl_acckashd, tbl_acckasdt');
  const [sales, saleLines, purchases, purchaseLines, cash, totals, months] = await Promise.all([
    db.query<IposHistDoc>(histDocs('tbl_ikhd', "'KSR','JL'"), [IPOS_OFFICE]),
    db.query<IposHistLine>(histLines('tbl_ikdt', 'tbl_ikhd', "'KSR','JL'", true), [IPOS_OFFICE]),
    db.query<IposHistDoc>(histDocs('tbl_imhd', "'BL'"), [IPOS_OFFICE]),
    db.query<IposHistLine>(histLines('tbl_imdt', 'tbl_imhd', "'BL'", false), [IPOS_OFFICE]),
    db.query<IposCashLine>(
      `SELECT trim(h.notransaksi) AS notransaksi, to_char(h.tanggal, 'YYYY-MM-DD"T"HH24:MI:SS') AS tanggal,
              d.nobaris, round(d.jumlah, 2)::text AS jumlah, nullif(trim(d.keterangan), '') AS keterangan
       FROM tbl_acckasdt d JOIN tbl_acckashd h ON h.notransaksi = d.notransaksi
       WHERE h.kodekantor = $1 AND h.tipe = 'KASO' AND d.jumlah > 0
       ORDER BY h.tanggal, h.notransaksi, d.nobaris`,
      [IPOS_OFFICE],
    ),
    db.query<Omit<IposHistoryCounts, 'months'>>(
      `WITH ${LINE_COST},
            l AS (SELECT c.cost, c.zero FROM tbl_ikdt d JOIN tbl_ikhd h ON h.notransaksi = d.notransaksi
                  LEFT JOIN c ON c.iddetailtrs = d.iddetail WHERE h.kodekantor = $1 AND h.tipe IN ('KSR','JL'))
       SELECT (SELECT count(*) FROM tbl_ikhd WHERE kodekantor = $1 AND tipe = 'KSR')::int AS ksr,
              (SELECT round(coalesce(sum(totalakhir), 0), 2)::text FROM tbl_ikhd WHERE kodekantor = $1 AND tipe = 'KSR') AS "ksrTotal",
              (SELECT count(*) FROM tbl_ikhd WHERE kodekantor = $1 AND tipe = 'JL')::int AS jl,
              (SELECT round(coalesce(sum(totalakhir), 0), 2)::text FROM tbl_ikhd WHERE kodekantor = $1 AND tipe = 'JL') AS "jlTotal",
              (SELECT coalesce(sum(round(cost, 2)), 0)::numeric(18,2)::text FROM l WHERE zero IS FALSE) AS "saleCost",
              (SELECT count(*) FROM l WHERE zero IS NOT FALSE)::int AS "linesWithoutCost",
              (SELECT count(*) FROM tbl_imhd WHERE kodekantor = $1 AND tipe = 'BL')::int AS purchases,
              (SELECT round(coalesce(sum(totalakhir), 0), 2)::text FROM tbl_imhd WHERE kodekantor = $1 AND tipe = 'BL') AS "purchasesTotal",
              (SELECT count(*) FROM tbl_acckashd WHERE kodekantor = $1 AND tipe = 'KASO')::int AS "cashOut",
              (SELECT round(coalesce(sum(jumlah), 0), 2)::text FROM tbl_acckashd WHERE kodekantor = $1 AND tipe = 'KASO') AS "cashOutTotal"`,
      [IPOS_OFFICE],
    ),
    db.query<IposHistoryCounts['months'][number]>(
      `SELECT to_char(tanggal, 'YYYY-MM') AS month, tipe, count(*)::int AS count, round(sum(totalakhir), 2)::text AS total
       FROM tbl_ikhd WHERE kodekantor = $1 AND tipe IN ('KSR','JL') GROUP BY 1, 2 ORDER BY 1, 2`,
      [IPOS_OFFICE],
    ),
  ]);
  return {
    sales: sales.rows,
    saleLines: saleLines.rows,
    purchases: purchases.rows,
    purchaseLines: purchaseLines.rows,
    cash: cash.rows,
    source: { ...totals.rows[0]!, months: months.rows },
  };
}
