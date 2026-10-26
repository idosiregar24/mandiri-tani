// Read-only access to the temporary `ipos_import` database the main process restored the
// iPOS backup into (sprint-3 S3-3/S3-4). Nothing here writes to it, and nothing is hard-coded
// from one particular backup — the fingerprint below is checked first (FR-MIG-09).
import type { FingerprintProblem, IposSourceInfo } from '@shared/schemas/imports';
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
