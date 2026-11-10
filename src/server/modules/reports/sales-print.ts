// Cetak Laporan Penjualan in the iPOS 5 format (menu Laporan > Penjualan): the same filters as the
// iPOS form (Periode, No Transaksi, Pelanggan, Gudang, User, Modul) and the report types the store
// uses. The page layout itself lives in the renderer (features/reports/print); this module only
// delivers the rows and totals, computed in SQL. A cashier gets only their own sales of today,
// exactly like the on-screen sales report (S10-6). No cost fields here.
import { hasPermission } from '@shared/permissions';
import { StoreSettings, LogoSettings } from '@shared/schemas/settings';
import {
  SALES_PRINT_TITLES,
  SalesPrintQuery,
  type ReportFilterOptions,
  type ReportPrintHeader,
  type SalesPrintCustomer,
  type SalesPrintDay,
  type SalesPrintInvoice,
  type SalesPrintItem,
  type SalesPrintReport,
  type SalesPrintReturn,
  type SalesTotals,
} from '@shared/schemas/reports';
import type { Pool, Queryable } from '../../db/pool';
import type { XlsxReport } from '../../lib/xlsx';
import type { RequestCtx } from '../../middleware/auth';
import { today } from '../ar-ap/service';
import { COUNTED_SALE, inPeriod, periodLabel, wibDate, withReport } from './common';

/**
 * $1 from, $2 to, $3 channel, $4 cashier, $5/$6 number range, $7/$8 customer code range,
 * $9 warehouse. Needs `sales s JOIN customers c`.
 */
const FILTER = `${COUNTED_SALE} AND ${inPeriod('s.trx_at', '$1', '$2')}
  AND ($3::text IS NULL OR s.channel = $3) AND ($4::uuid IS NULL OR s.cashier_id = $4)
  AND ($5::text IS NULL OR s.number >= $5) AND ($6::text IS NULL OR s.number <= $6)
  AND ($7::text IS NULL OR upper(c.code) >= upper($7)) AND ($8::text IS NULL OR upper(c.code) <= upper($8))
  AND ($9::uuid IS NULL OR s.warehouse_id = $9)`;
const FROM = `FROM sales s JOIN customers c ON c.id = s.customer_id`;

const ITEM_COUNT = `coalesce((SELECT sum(i.qty) FROM sale_items i WHERE i.sale_id = s.id), 0)`;
const CASH = `(s.paid_amount - s.change_amount)`;

async function invoices(db: Queryable, params: unknown[], order: string, extra = ''): Promise<SalesPrintInvoice[]> {
  const r = await db.query<SalesPrintInvoice>(
    `SELECT s.id, s.number, ${wibDate('s.trx_at')}::text AS date,
            c.code AS "customerCode", c.name AS "customerName",
            nullif(concat_ws(', ', nullif(c.address, ''), nullif(c.village, '')), '') AS "customerAddress",
            trim_scale(${ITEM_COUNT})::text AS "itemCount",
            s.subtotal::text,
            CASE WHEN s.subtotal > 0 THEN round(s.discount_amount * 100 / s.subtotal, 2) ELSE 0 END::numeric(9,2)::text
              AS "discountPct",
            s.discount_amount::text AS discount, s.tax_amount::text AS tax,
            s.other_charges::text AS "otherCharges", s.total::text,
            ${CASH}::text AS "paidCash", s.credit_amount::text AS "paidCredit"
     ${FROM}
     WHERE ${FILTER} ${extra}
     ORDER BY ${order}`,
    params,
  );
  return r.rows;
}

async function items(db: Queryable, params: unknown[]): Promise<SalesPrintItem[]> {
  const r = await db.query<SalesPrintItem>(
    `SELECT i.sale_id AS "saleId", i.line_no AS "lineNo", p.sku, i.product_name AS name,
            trim_scale(i.qty)::text AS qty, i.unit_code AS unit, i.unit_price::text AS price,
            CASE WHEN i.qty * i.unit_price > 0 THEN round(i.discount_amount * 100 / (i.qty * i.unit_price), 2)
                 ELSE 0 END::numeric(9,2)::text AS "discountPct",
            i.line_total::text AS total
     ${FROM} JOIN sale_items i ON i.sale_id = s.id JOIN products p ON p.id = i.product_id
     WHERE ${FILTER}
     ORDER BY s.trx_at, s.number, i.line_no`,
    params,
  );
  return r.rows;
}

async function days(db: Queryable, params: unknown[]): Promise<SalesPrintDay[]> {
  const r = await db.query<SalesPrintDay>(
    `SELECT ${wibDate('s.trx_at')}::text AS date, count(*)::int AS count, sum(s.total)::text AS total,
            sum(${CASH})::text AS "paidCash", sum(s.credit_amount)::text AS "paidCredit"
     ${FROM} WHERE ${FILTER} GROUP BY 1 ORDER BY 1`,
    params,
  );
  return r.rows;
}

async function customers(db: Queryable, params: unknown[]): Promise<SalesPrintCustomer[]> {
  const r = await db.query<SalesPrintCustomer>(
    `SELECT c.code, c.name, count(*)::int AS count, sum(s.total)::text AS total,
            sum(${CASH})::text AS "paidCash", sum(s.credit_amount)::text AS "paidCredit"
     ${FROM} WHERE ${FILTER} GROUP BY c.id ORDER BY c.name, c.code`,
    params,
  );
  return r.rows;
}

const HAS_RETURN = `AND EXISTS (SELECT 1 FROM sale_returns r WHERE r.sale_id = s.id)`;

async function returns(db: Queryable, params: unknown[]): Promise<SalesPrintReturn[]> {
  const r = await db.query<SalesPrintReturn>(
    `SELECT r.sale_id AS "saleId", r.number, ${wibDate('r.trx_at')}::text AS date, c.code AS "customerCode",
            trim_scale(coalesce((SELECT sum(ri.qty) FROM sale_return_items ri WHERE ri.return_id = r.id), 0))::text
              AS "itemCount",
            r.total::text
     ${FROM} JOIN sale_returns r ON r.sale_id = s.id
     WHERE ${FILTER}
     ORDER BY r.trx_at, r.number`,
    params,
  );
  return r.rows;
}

async function returnTotals(db: Queryable, params: unknown[]): Promise<SalesPrintReport['returnTotals']> {
  const r = await db.query<SalesPrintReport['returnTotals']>(
    `SELECT trim_scale(coalesce(sum(x.items), 0))::text AS "itemCount", coalesce(sum(x.total), 0)::text AS total
     FROM (SELECT r.total,
                  (SELECT coalesce(sum(ri.qty), 0) FROM sale_return_items ri WHERE ri.return_id = r.id) AS items
           ${FROM} JOIN sale_returns r ON r.sale_id = s.id WHERE ${FILTER}) x`,
    params,
  );
  return r.rows[0]!;
}

async function totals(db: Queryable, params: unknown[], extra = ''): Promise<SalesPrintReport['totals']> {
  const r = await db.query<SalesTotals & { itemCount: string }>(
    `SELECT count(*)::int AS count, trim_scale(coalesce(sum(${ITEM_COUNT}), 0))::text AS "itemCount",
            coalesce(sum(s.subtotal), 0)::text AS subtotal, coalesce(sum(s.discount_amount), 0)::text AS discount,
            coalesce(sum(s.tax_amount), 0)::text AS tax, coalesce(sum(s.other_charges), 0)::text AS "otherCharges",
            coalesce(sum(s.total), 0)::text AS total, coalesce(sum(${CASH}), 0)::text AS "paidCash",
            coalesce(sum(s.credit_amount), 0)::text AS "paidCredit"
     ${FROM} WHERE ${FILTER} ${extra}`,
    params,
  );
  return r.rows[0]!;
}

/** "2026-04-01" → "01/04/26" (iPOS PERIODE line). */
const shortDate = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(2, 4)}`;
const range = (a?: string, b?: string) => `${a ?? '-'} - ${b ?? '-'}`;

async function header(db: Queryable, ctx: RequestCtx, q: SalesPrintQuery, cashierId: string | null) {
  const s = await db.query<{ key: string; value: unknown }>(
    `SELECT key, value FROM settings WHERE key IN ('store','logo')`,
  );
  const byKey = new Map(s.rows.map((x) => [x.key, x.value]));
  const store = StoreSettings.safeParse(byKey.get('store'));
  const logo = LogoSettings.safeParse(byKey.get('logo') ?? {});
  const filters = [`PERIODE : ${shortDate(q.from)} - ${shortDate(q.to)}`];
  if (q.numberFrom || q.numberTo) filters.push(`NO. TRANSAKSI : ${range(q.numberFrom, q.numberTo)}`);
  if (q.customerFrom || q.customerTo) filters.push(`PELANGGAN : ${range(q.customerFrom, q.customerTo)}`);
  if (q.warehouseId) {
    const w = await db.query<{ code: string }>(`SELECT code FROM warehouses WHERE id = $1`, [q.warehouseId]);
    filters.push(`GUDANG : ${w.rows[0]?.code ?? '-'}`);
  }
  if (cashierId) {
    const u = await db.query<{ username: string }>(`SELECT username FROM users WHERE id = $1`, [cashierId]);
    filters.push(`USER : ${(u.rows[0]?.username ?? '-').toUpperCase()}`);
  }
  if (q.channel) filters.push(`MODUL : ${q.channel === 'KASIR' ? 'KASIR' : 'PENJUALAN'}`);
  const company = store.success ? store.data : { name: 'Toko', address: null, phone: null, fax: null };
  return {
    company: {
      name: company.name,
      address: company.address,
      phone: company.phone,
      fax: company.fax,
      logo: logo.success ? logo.data.image : null,
    },
    filters,
    printedBy: ctx.username.toUpperCase(),
  } satisfies ReportPrintHeader;
}

export async function salesPrint(pool: Pool, ctx: RequestCtx, raw: unknown): Promise<SalesPrintReport> {
  const ownOnly = !hasPermission(ctx.role, 'reports.all');
  const q = SalesPrintQuery.parse(ownOnly ? { ...(raw as object), from: today(), to: today() } : raw);
  const cashierId = ownOnly ? ctx.userId : (q.userId ?? null);
  const params = [
    q.from,
    q.to,
    q.channel ?? null,
    cashierId,
    q.numberFrom ?? null,
    q.numberTo ?? null,
    q.customerFrom ?? null,
    q.customerTo ?? null,
    q.warehouseId ?? null,
  ];
  return withReport(pool, async (db) => {
    const t = q.type;
    const listed =
      t === 'rekap' || t === 'detail'
        ? await invoices(db, params, 's.trx_at, s.number')
        : t === 'pelanggan-detail'
          ? await invoices(db, params, 'c.name, c.code, s.trx_at, s.number')
          : t === 'retur'
            ? await invoices(db, params, 's.trx_at, s.number', HAS_RETURN)
            : [];
    const rets = t === 'retur' ? await returns(db, params) : [];
    return {
      type: t,
      title: SALES_PRINT_TITLES[t],
      period: { from: q.from, to: q.to },
      ownOnly,
      header: await header(db, ctx, q, cashierId),
      invoices: listed,
      items: t === 'detail' ? await items(db, params) : [],
      days: t === 'harian' ? await days(db, params) : [],
      customers: t === 'pelanggan-rekap' ? await customers(db, params) : [],
      returns: rets,
      totals: await totals(db, params, t === 'retur' ? HAS_RETURN : ''),
      returnTotals: t === 'retur' ? await returnTotals(db, params) : { itemCount: '0', total: '0.00' },
    };
  });
}

/** Users and warehouses for the print form's User / Gudang choices. */
export async function reportFilterOptions(pool: Pool): Promise<ReportFilterOptions> {
  const [u, w] = await Promise.all([
    pool.query<ReportFilterOptions['users'][number]>(
      `SELECT id, username, full_name AS "fullName" FROM users ORDER BY username`,
    ),
    pool.query<ReportFilterOptions['warehouses'][number]>(
      `SELECT id, code, name FROM warehouses WHERE deleted_at IS NULL ORDER BY code`,
    ),
  ]);
  return { users: u.rows, warehouses: w.rows };
}

// ------------------------------------------------------------------------------ Excel

const COMMON_HEAD = [
  { key: 'number', header: 'No Transaksi', width: 24 },
  { key: 'date', header: 'Tanggal', type: 'date' as const },
];

export function salesPrintXlsx(r: SalesPrintReport): XlsxReport {
  const subtitle = [periodLabel(r.period), ...r.header.filters.slice(1)].join(' · ');
  const t = r.totals;
  switch (r.type) {
    case 'harian':
      return {
        title: 'Penjualan Harian',
        subtitle,
        columns: [
          { key: 'date', header: 'Tanggal', type: 'date' },
          { key: 'count', header: 'Jml Trs', type: 'int' },
          { key: 'total', header: 'Total Transaksi', type: 'money' },
          { key: 'paidCash', header: 'Jml Bayar Tunai', type: 'money' },
          { key: 'paidCredit', header: 'Jml Bayar Kredit', type: 'money' },
        ],
        rows: r.days.map((d) => ({ ...d })),
        totals: { date: 'TOTAL', count: t.count, total: t.total, paidCash: t.paidCash, paidCredit: t.paidCredit },
      };
    case 'pelanggan-rekap':
      return {
        title: 'Jual Per Pelanggan Rekap',
        subtitle,
        columns: [
          { key: 'code', header: 'Kode Pel.', width: 12 },
          { key: 'name', header: 'Pelanggan', width: 32 },
          { key: 'count', header: 'Jml Trs', type: 'int' },
          { key: 'total', header: 'Total Transaksi', type: 'money' },
          { key: 'paidCash', header: 'Jml Bayar Tunai', type: 'money' },
          { key: 'paidCredit', header: 'Jml Bayar Kredit', type: 'money' },
        ],
        rows: r.customers.map((c) => ({ ...c })),
        totals: { name: 'TOTAL', count: t.count, total: t.total, paidCash: t.paidCash, paidCredit: t.paidCredit },
      };
    case 'detail': {
      const byId = new Map(r.invoices.map((i) => [i.id, i]));
      return {
        title: 'Penjualan Detail',
        subtitle,
        columns: [
          ...COMMON_HEAD,
          { key: 'customerCode', header: 'Kode Pel.', width: 12 },
          { key: 'customerName', header: 'Nama Pelanggan', width: 28 },
          { key: 'lineNo', header: 'No.', type: 'int' },
          { key: 'sku', header: 'Kd. Item', width: 16 },
          { key: 'name', header: 'Nama Item', width: 32 },
          { key: 'qty', header: 'Jml', type: 'qty' },
          { key: 'unit', header: 'Satuan', width: 8 },
          { key: 'price', header: 'Harga', type: 'money' },
          { key: 'discountPct', header: 'Pot. %', type: 'qty' },
          { key: 'total', header: 'Total', type: 'money' },
        ],
        rows: r.items.map((i) => {
          const s = byId.get(i.saleId)!;
          return { ...i, number: s.number, date: s.date, customerCode: s.customerCode, customerName: s.customerName };
        }),
        totals: { number: `TOTAL (${t.count} nota)`, qty: t.itemCount, total: t.subtotal },
        notes: [
          `Potongan nota Rp ${t.discount} · Pajak Rp ${t.tax} · Biaya lain Rp ${t.otherCharges} · Total akhir Rp ${t.total}`,
        ],
      };
    }
    case 'retur':
      return {
        title: 'Jual Per Retur',
        subtitle,
        columns: [
          ...COMMON_HEAD,
          { key: 'customerCode', header: 'Kode Pel.', width: 12 },
          { key: 'itemCount', header: 'Jml Item', type: 'qty' },
          { key: 'total', header: 'Total Jual', type: 'money' },
          { key: 'returnNumber', header: 'No Transaksi Retur', width: 24 },
          { key: 'returnDate', header: 'Tgl Retur', type: 'date' },
          { key: 'returnItems', header: 'Jml Item Retur', type: 'qty' },
          { key: 'returnTotal', header: 'Total Retur', type: 'money' },
        ],
        rows: r.invoices.flatMap((s) => {
          const rs = r.returns.filter((x) => x.saleId === s.id);
          return rs.map((x, i) => ({
            ...(i === 0
              ? { number: s.number, date: s.date, customerCode: s.customerCode, itemCount: s.itemCount, total: s.total }
              : {}),
            returnNumber: x.number,
            returnDate: x.date,
            returnItems: x.itemCount,
            returnTotal: x.total,
          }));
        }),
        totals: {
          number: 'TOTAL',
          itemCount: t.itemCount,
          total: t.total,
          returnItems: r.returnTotals.itemCount,
          returnTotal: r.returnTotals.total,
        },
      };
    default:
      // rekap & pelanggan-detail: one row per note
      return {
        title: r.type === 'rekap' ? 'Penjualan Rekap' : 'Jual Per Pelanggan Detail',
        subtitle,
        columns: [
          ...COMMON_HEAD,
          { key: 'customerCode', header: 'Kode Pel.', width: 12 },
          { key: 'customerName', header: 'Pelanggan', width: 28 },
          { key: 'itemCount', header: 'Jml Item', type: 'qty' },
          { key: 'subtotal', header: 'Sub Total', type: 'money' },
          { key: 'discountPct', header: 'Pot. %', type: 'qty' },
          { key: 'discount', header: 'Potongan', type: 'money' },
          { key: 'tax', header: 'Pajak', type: 'money' },
          { key: 'otherCharges', header: 'Biaya Lain', type: 'money' },
          { key: 'total', header: 'Total Akhir', type: 'money' },
          { key: 'paidCash', header: 'Bayar Tunai', type: 'money' },
          { key: 'paidCredit', header: 'Bayar Kredit', type: 'money' },
        ],
        rows: r.invoices.map((i) => ({ ...i })),
        totals: { number: `TOTAL (${t.count} nota)`, ...t },
      };
  }
}
