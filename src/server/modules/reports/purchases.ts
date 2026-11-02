// Purchases detail like iPOS "Pembelian Detail" (FR-FIN-12): one row per supplier invoice with its
// lines. Credit = the invoice's payable; the rest was paid at once (cash or transfer).
import { Decimal, toMoney } from '@shared/money';
import { PurchasesReportQuery, type PurchaseReportRow, type PurchasesReport } from '@shared/schemas/reports';
import type { Pool } from '../../db/pool';
import type { XlsxReport } from '../../lib/xlsx';
import { periodLabel, withReport } from './common';

export async function purchasesReport(pool: Pool, raw: unknown): Promise<PurchasesReport> {
  const q = PurchasesReportQuery.parse(raw);
  const rows = await withReport(pool, async (db) => {
    const r = await db.query<PurchaseReportRow>(
      `SELECT pi.id, pi.number, pi.supplier_invoice_no AS "supplierInvoiceNo", pi.invoice_date::text AS date,
              json_build_object('code', s.code, 'name', s.name) AS supplier,
              trim_scale(coalesce((SELECT sum(gri.qty) FROM purchase_invoice_items pii
                 JOIN goods_receipt_items gri ON gri.id = pii.goods_receipt_item_id
                 WHERE pii.purchase_invoice_id = pi.id), 0))::text AS "itemCount",
              pi.subtotal::text, pi.discount_amount::text AS discount, pi.tax_amount::text AS tax,
              pi.other_cost::text AS "otherCost", pi.total::text,
              (pi.total - coalesce(py.amount, 0))::text AS "paidCash", coalesce(py.amount, 0)::text AS "paidCredit",
              pi.status,
              coalesce((SELECT json_agg(json_build_object(
                  'sku', p.sku, 'productName', p.name, 'qty', trim_scale(gri.qty)::text, 'unitCode', un.code,
                  'unitPrice', gri.unit_price::text, 'discount', gri.discount_amount::text,
                  'lineTotal', gri.line_total::text) ORDER BY gri.line_no)
                FROM purchase_invoice_items pii JOIN goods_receipt_items gri ON gri.id = pii.goods_receipt_item_id
                JOIN products p ON p.id = gri.product_id JOIN product_units pu ON pu.id = gri.product_unit_id
                JOIN units un ON un.id = pu.unit_id
                WHERE pii.purchase_invoice_id = pi.id), '[]'::json) AS lines
       FROM purchase_invoices pi JOIN suppliers s ON s.id = pi.supplier_id
       LEFT JOIN payables py ON py.source_type = 'PURCHASE_INVOICE' AND py.source_id = pi.id
       WHERE pi.invoice_date BETWEEN $1::date AND $2::date AND ($3::uuid IS NULL OR pi.supplier_id = $3)
       ORDER BY pi.invoice_date, pi.number`,
      [q.from, q.to, q.supplierId ?? null],
    );
    return r.rows;
  });
  const posted = rows.filter((r) => r.status === 'POSTED');
  const sum = (k: 'subtotal' | 'discount' | 'tax' | 'otherCost' | 'total' | 'paidCash' | 'paidCredit') =>
    toMoney(posted.reduce((s, r) => s.plus(r[k]), new Decimal(0)));
  return {
    period: { from: q.from, to: q.to },
    rows,
    totals: {
      count: posted.length,
      subtotal: sum('subtotal'),
      discount: sum('discount'),
      tax: sum('tax'),
      otherCost: sum('otherCost'),
      total: sum('total'),
      paidCash: sum('paidCash'),
      paidCredit: sum('paidCredit'),
    },
  };
}

/** Invoice row followed by its lines (indented), like the iPOS detail print. */
export function purchasesXlsx(r: PurchasesReport): XlsxReport {
  const rows: Record<string, string | null>[] = [];
  for (const p of r.rows) {
    rows.push({
      number: p.status === 'VOIDED' ? `${p.number} (BATAL)` : p.number,
      date: p.date,
      supplier: p.supplier.name,
      itemCount: p.itemCount,
      subtotal: p.subtotal,
      discount: p.discount,
      tax: p.tax,
      otherCost: p.otherCost,
      total: p.total,
      paidCash: p.paidCash,
      paidCredit: p.paidCredit,
    });
    for (const l of p.lines) {
      rows.push({
        number: `   ${l.sku}`,
        supplier: `${l.productName} — ${l.qty} ${l.unitCode} × ${l.unitPrice}`,
        subtotal: l.lineTotal,
        discount: l.discount,
      });
    }
  }
  return {
    title: 'Pembelian Detail',
    subtitle: periodLabel(r.period),
    columns: [
      { key: 'number', header: 'No Transaksi', width: 22 },
      { key: 'date', header: 'Tanggal', type: 'date' },
      { key: 'supplier', header: 'Supplier / Barang', width: 40 },
      { key: 'itemCount', header: 'Jml Item', type: 'qty' },
      { key: 'subtotal', header: 'Sub Total', type: 'money' },
      { key: 'discount', header: 'Pot.', type: 'money' },
      { key: 'tax', header: 'Pajak', type: 'money' },
      { key: 'otherCost', header: 'Biaya Lain', type: 'money' },
      { key: 'total', header: 'Total Akhir', type: 'money' },
      { key: 'paidCash', header: 'Bayar Tunai', type: 'money' },
      { key: 'paidCredit', header: 'Bayar Kredit', type: 'money' },
    ],
    rows,
    totals: { number: `Total (${r.totals.count} faktur)`, ...r.totals },
  };
}
