// iPOS importer, 2-YEAR HISTORY scope (FR-MIG-02 "Histori", sprint-10 S10-10): pure mapping from
// iPOS rows to sales / purchase invoices / cash-out rows. No database access here — lookups come
// in, a plan and the data-quality findings go out (unit-tested on its own).
//
// Rules learned from the store's backup (agregat, 2026-10-30):
// - total = subtotal − potnomfaktur + biayalain (pajak is inclusive; potfaktur is the percentage)
// - jmltunai includes the change given back: change = jmltunai + jmlkredit − total, when > 0
// - every line has FIFO rows in tbl_item_ik; a layer at cost 0 means iPOS did not know the HPP (DQ-3)
// - some lines use a unit the item no longer has (conversion 1) → the product's base unit, the
//   original unit code kept on the line as snapshot
import { dec, Decimal, toMoney, toQty } from '@shared/money';
import { allocateDiscount } from '@shared/pos';
import type { DataIssue } from '@shared/schemas/imports';
import type { IposCashLine, IposHistDoc, IposHistLine } from './ipos-source';

export interface HistoryProduct {
  id: string;
  name: string;
  baseUnitId: string;
  /** Unit code (upper case) → product_unit. */
  units: Map<string, { id: string; conversion: string }>;
}

export interface HistoryLookups {
  customers: Map<string, { id: string; groupId: string | null }>;
  walkIn: { id: string; groupId: string | null };
  suppliers: Map<string, { id: string }>;
  /** iPOS kodeitem → product. */
  products: Map<string, HistoryProduct>;
  /** Numbers already used in the app (dev/test documents) — such iPOS documents are skipped. */
  taken: { sales: Set<string>; purchases: Set<string>; cash: Set<string> };
}

export interface HistorySaleLine {
  productId: string;
  productUnitId: string;
  productName: string;
  unitCode: string;
  conversion: string;
  qty: string;
  baseQty: string;
  unitPrice: string;
  discount: string;
  lineTotal: string;
  allocatedDiscount: string;
  netAmount: string;
  costTotal: string | null;
  costPerBase: string | null;
}

export interface HistorySale {
  legacyKey: string;
  channel: 'KASIR' | 'FAKTUR';
  /** ISO with +07:00 (iPOS stores WIB local time). */
  trxAt: string;
  customerId: string;
  customerGroupId: string | null;
  subtotal: string;
  discount: string;
  tax: string;
  otherCharges: string;
  total: string;
  paid: string;
  credit: string;
  change: string;
  dueDate: string | null;
  note: string | null;
  lines: HistorySaleLine[];
}

export interface HistoryPurchaseLine {
  productId: string;
  productUnitId: string;
  conversion: string;
  qty: string;
  baseQty: string;
  unitPrice: string;
  discount: string;
  lineTotal: string;
  costPerBase: string;
}

export interface HistoryPurchase {
  legacyKey: string;
  supplierId: string;
  receivedAt: string;
  date: string;
  dueDate: string;
  subtotal: string;
  discount: string;
  tax: string;
  otherCost: string;
  total: string;
  note: string | null;
  lines: HistoryPurchaseLine[];
}

export type OpexCode = 'OPEX_EXPEDITION' | 'OPEX_UNLOADING' | 'OPEX_VEHICLE' | 'OPEX_WAGES' | 'OPEX_GENERAL';

export interface HistoryCash {
  /** notransaksi#nobaris — one row per detail line. */
  legacyKey: string;
  /** The iPOS number on the document's first line only (cash_transactions.number is unique). */
  number: string | null;
  trxAt: string;
  amount: string;
  category: OpexCode;
  note: string;
}

export interface HistoryPlan {
  sales: HistorySale[];
  purchases: HistoryPurchase[];
  cash: HistoryCash[];
  issues: DataIssue[];
}

/** Expense category from the iPOS description (Analisis §4: EKSPEDISI, BONGKAR, MINYAK/MOBIL, UPAH). */
export function cashCategoryFor(text: string | null): OpexCode {
  const t = (text ?? '').toUpperCase();
  if (/EKSPEDISI|EXPEDISI|ONGKIR|ONGKOS KIRIM|TRUK|TRUCK/.test(t)) return 'OPEX_EXPEDITION';
  if (/BONGKAR|MUAT|LANGSIR|KULI/.test(t)) return 'OPEX_UNLOADING';
  if (/MINYAK|BBM|SOLAR|BENSIN|PERTALITE|MOBIL|MOTOR|SERVIS|SERVICE|\bBAN\b|\bOLI\b|SPAREPART|BENGKEL/.test(t)) {
    return 'OPEX_VEHICLE';
  }
  if (/UPAH|GAJI|BONUS|\bTHR\b|HONOR/.test(t)) return 'OPEX_WAGES';
  return 'OPEX_GENERAL';
}

const wib = (local: string) => `${local}+07:00`;
const addDays = (iso: string, days: number) =>
  new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
const max0 = (v: Decimal) => (v.gt(0) ? v : new Decimal(0));

/** Groups lines by document number, keeping their order. */
function byDoc(lines: IposHistLine[]): Map<string, IposHistLine[]> {
  const m = new Map<string, IposHistLine[]>();
  for (const l of lines) {
    const list = m.get(l.notransaksi);
    if (list) list.push(l);
    else m.set(l.notransaksi, [l]);
  }
  return m;
}

class Findings {
  private map = new Map<string, DataIssue>();
  add(code: string, title: string, action: string, example: string) {
    const i = this.map.get(code) ?? { code, title, action, count: 0, examples: [] };
    i.count++;
    if (i.examples.length < 5) i.examples.push(example);
    this.map.set(code, i);
  }
  list(): DataIssue[] {
    return [...this.map.values()];
  }
}

/** The product unit a line was sold/bought in; a unit the item no longer has → its base unit. */
function unitFor(p: HistoryProduct, l: IposHistLine): { id: string; missing: boolean } {
  const u = p.units.get(l.satuan.toUpperCase());
  if (u) return { id: u.id, missing: false };
  return { id: p.baseUnitId, missing: true };
}

export function planHistoryImport(
  rows: {
    sales: IposHistDoc[];
    saleLines: IposHistLine[];
    purchases: IposHistDoc[];
    purchaseLines: IposHistLine[];
    cash: IposCashLine[];
  },
  look: HistoryLookups,
): HistoryPlan {
  const f = new Findings();
  const saleLines = byDoc(rows.saleLines);
  const purchaseLines = byDoc(rows.purchaseLines);

  // ---------------------------------------------------------------- sales
  const sales: HistorySale[] = [];
  for (const h of rows.sales) {
    if (look.taken.sales.has(h.notransaksi)) {
      f.add(
        'HIST_NUMBER_TAKEN',
        'Nomor nota iPOS sudah dipakai nota di aplikasi ini',
        'Nota iPOS ini dilewati. Biasanya nota uji coba — jalankan "Reset data persiapan" lalu impor ulang.',
        h.notransaksi,
      );
      continue;
    }
    const lines = saleLines.get(h.notransaksi) ?? [];
    const unknown = lines.find((l) => !look.products.has(l.kodeitem));
    if (lines.length === 0 || unknown) {
      f.add(
        'HIST_UNKNOWN_ITEM',
        'Nota dengan barang yang tidak ada di data master',
        'Nota ini dilewati (omzetnya tidak masuk laporan). Periksa barangnya di iPOS.',
        unknown ? `${h.notransaksi} (${unknown.kodeitem})` : `${h.notransaksi} (tanpa baris)`,
      );
      continue;
    }
    let customer = look.customers.get(h.kodesupel);
    if (!customer) {
      f.add(
        'HIST_UNKNOWN_CUSTOMER',
        'Nota dengan pelanggan yang tidak ada di data master',
        'Dicatat atas nama pelanggan Umum supaya omzetnya tetap masuk laporan.',
        `${h.notransaksi} (${h.kodesupel || 'tanpa pelanggan'})`,
      );
      customer = look.walkIn;
    }
    const allocations = allocateDiscount(
      lines.map((l) => l.total),
      h.potnomfaktur,
    );
    const mapped = lines.map((l, i): HistorySaleLine => {
      const p = look.products.get(l.kodeitem)!;
      const unit = unitFor(p, l);
      if (unit.missing) {
        f.add(
          'HIST_UNIT_GONE',
          'Baris nota memakai satuan yang sudah tidak ada di barangnya',
          'Dicatat pada satuan dasar barang; kode satuan asli tetap tertulis di baris nota.',
          `${h.notransaksi} (${p.name}, ${l.satuan})`,
        );
      }
      const baseQty = toQty(dec(l.jumlah).times(l.jmlkonversi));
      if (l.costUnknown) {
        f.add(
          'DQ-3',
          'Baris jual tanpa HPP di iPOS (barang keluar sebelum ada stok tercatat)',
          'Diimpor dengan HPP "tidak diketahui": omzetnya tampil di laporan, tapi tidak dihitung sebagai laba.',
          `${h.notransaksi} (${p.name})`,
        );
      }
      const cost = l.costUnknown || l.cost === null ? null : toMoney(l.cost);
      return {
        productId: p.id,
        productUnitId: unit.id,
        productName: p.name,
        unitCode: l.satuan.toUpperCase(),
        conversion: toQty(l.jmlkonversi),
        qty: toQty(l.jumlah),
        baseQty,
        unitPrice: toMoney(l.harga),
        discount: toMoney(l.potongan),
        lineTotal: toMoney(l.total),
        allocatedDiscount: allocations[i]!,
        netAmount: toMoney(dec(l.total).minus(allocations[i]!)),
        costTotal: cost,
        costPerBase: cost === null ? null : toQty(dec(cost).div(baseQty)),
      };
    });
    const total = dec(h.totalakhir);
    const credit = dec(h.jmlkredit);
    const paid = dec(h.jmltunai);
    if (paid.plus(credit).lt(total)) {
      f.add(
        'HIST_UNDERPAID',
        'Nota yang pembayarannya kurang dari total di iPOS',
        'Diimpor apa adanya (tunai & kredit sesuai iPOS). Periksa notanya bila perlu.',
        h.notransaksi,
      );
    }
    const date = h.tanggal.slice(0, 10);
    const channel = h.tipe === 'KSR' ? 'KASIR' : 'FAKTUR';
    sales.push({
      legacyKey: h.notransaksi,
      channel,
      trxAt: wib(h.tanggal),
      customerId: customer.id,
      customerGroupId: customer.groupId,
      subtotal: toMoney(h.subtotal),
      discount: toMoney(h.potnomfaktur),
      tax: toMoney(h.pajak),
      otherCharges: toMoney(h.biayalain),
      total: toMoney(total),
      paid: toMoney(paid),
      credit: channel === 'FAKTUR' ? toMoney(credit) : '0.00',
      change: toMoney(max0(paid.plus(credit).minus(total))),
      dueDate:
        channel === 'FAKTUR' && credit.gt(0)
          ? h.jatuhtempo && h.jatuhtempo >= date
            ? h.jatuhtempo
            : addDays(date, 10)
          : null,
      note: h.keterangan,
      lines: mapped,
    });
  }

  // ---------------------------------------------------------------- purchases
  const purchases: HistoryPurchase[] = [];
  for (const h of rows.purchases) {
    if (look.taken.purchases.has(h.notransaksi)) {
      f.add(
        'HIST_NUMBER_TAKEN',
        'Nomor nota iPOS sudah dipakai nota di aplikasi ini',
        'Nota iPOS ini dilewati. Biasanya nota uji coba — jalankan "Reset data persiapan" lalu impor ulang.',
        h.notransaksi,
      );
      continue;
    }
    const supplier = look.suppliers.get(h.kodesupel);
    const lines = purchaseLines.get(h.notransaksi) ?? [];
    const unknown = lines.find((l) => !look.products.has(l.kodeitem));
    if (!supplier || lines.length === 0 || unknown) {
      f.add(
        'HIST_PURCHASE_SKIPPED',
        'Faktur beli dengan supplier atau barang yang tidak ada di data master',
        'Faktur ini dilewati. Periksa supplier/barangnya di iPOS.',
        `${h.notransaksi} (${!supplier ? h.kodesupel || 'tanpa supplier' : unknown ? unknown.kodeitem : 'tanpa baris'})`,
      );
      continue;
    }
    const date = h.tanggal.slice(0, 10);
    purchases.push({
      legacyKey: h.notransaksi,
      supplierId: supplier.id,
      receivedAt: wib(h.tanggal),
      date,
      dueDate: h.jatuhtempo && h.jatuhtempo >= date ? h.jatuhtempo : date,
      subtotal: toMoney(h.subtotal),
      discount: toMoney(h.potnomfaktur),
      tax: toMoney(h.pajak),
      otherCost: toMoney(h.biayalain),
      total: toMoney(h.totalakhir),
      note: h.keterangan,
      lines: lines.map((l) => {
        const p = look.products.get(l.kodeitem)!;
        const unit = unitFor(p, l);
        if (unit.missing) {
          f.add(
            'HIST_UNIT_GONE',
            'Baris nota memakai satuan yang sudah tidak ada di barangnya',
            'Dicatat pada satuan dasar barang; kode satuan asli tetap tertulis di baris nota.',
            `${h.notransaksi} (${p.name}, ${l.satuan})`,
          );
        }
        const baseQty = toQty(dec(l.jumlah).times(l.jmlkonversi));
        return {
          productId: p.id,
          productUnitId: unit.id,
          conversion: toQty(l.jmlkonversi),
          qty: toQty(l.jumlah),
          baseQty,
          unitPrice: toMoney(l.harga),
          discount: toMoney(l.potongan),
          lineTotal: toMoney(l.total),
          // iPOS: TRS_IM_BIAYA_HPP = 0, TRS_IM_POT_HPP = 0 — note costs and discounts do not touch HPP.
          costPerBase: toQty(dec(l.total).div(baseQty)),
        };
      }),
    });
  }

  // ---------------------------------------------------------------- cash out (KASO)
  const cash: HistoryCash[] = [];
  const firstLine = new Set<string>();
  for (const c of rows.cash) {
    const first = !firstLine.has(c.notransaksi);
    firstLine.add(c.notransaksi);
    const category = cashCategoryFor(c.keterangan);
    if (category === 'OPEX_GENERAL') {
      f.add(
        'HIST_CASH_GENERAL',
        'Kas keluar iPOS tanpa kata kunci biaya yang dikenal',
        'Dicatat sebagai "Biaya Operasional Lain".',
        c.notransaksi,
      );
    }
    const number = first && !look.taken.cash.has(c.notransaksi) ? c.notransaksi : null;
    cash.push({
      legacyKey: `${c.notransaksi}#${c.nobaris}`,
      number,
      trxAt: wib(c.tanggal),
      amount: toMoney(c.jumlah),
      category,
      note: [number ? null : c.notransaksi, c.keterangan ?? 'Kas keluar iPOS'].filter(Boolean).join(' · '),
    });
  }

  return { sales, purchases, cash, issues: f.list() };
}
