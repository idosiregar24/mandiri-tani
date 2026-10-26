// iPOS opening stock → OPENING movements, as a PURE function (sprint-4 S4-3/S4-4).
// One movement per open iPOS FIFO layer (qty = sisa, cost = hargadasar, layer date = iPOS date),
// so FIFO continues exactly where iPOS left off (D-11). tbl_itemstok is the quantity truth: any
// difference with the layers becomes an extra movement and a data-quality finding.
import { dec, toQty } from '@shared/money';
import type { DataIssue } from '@shared/schemas/imports';
import type { IposStockRows } from './ipos-source';

export interface PlannedOpening {
  productId: string;
  kodeitem: string;
  /** Signed base-unit quantity. */
  qty: string;
  /** Per base unit, 4 dp; undefined = estimated outflow (negative stock). */
  unitCost?: string;
  layerReceivedAt?: Date;
  /** tbl_item_im.iddetail for legacy_refs; null for a difference line. */
  legacyKey: string | null;
}

export interface StockPlan {
  movements: PlannedOpening[];
  /** productId → last purchase cost per base unit (S4-4). */
  lastCost: Map<string, string>;
  issues: DataIssue[];
}

const NUM = /^-?\d+(\.\d+)?$/;
const num = (v: string | null | undefined) => (v && NUM.test(v.trim()) ? v.trim() : '0');
/** iPOS writes WIB wall-clock time; store it as the matching instant. */
const wib = (iso: string) => new Date(`${iso}+07:00`);

export function planStockImport(rows: IposStockRows, productIdByCode: Map<string, string>): StockPlan {
  const issues = new Map<string, DataIssue>();
  const issue = (code: string, title: string, action: string, example: string) => {
    let i = issues.get(code);
    if (!i) issues.set(code, (i = { code, title, action, count: 0, examples: [] }));
    i.count++;
    if (i.examples.length < 10) i.examples.push(example);
  };

  const layersByItem = new Map<string, IposStockRows['layers']>();
  for (const l of rows.layers) layersByItem.set(l.kodeitem, [...(layersByItem.get(l.kodeitem) ?? []), l]);
  const stockByItem = new Map(rows.stocks.map((s) => [s.kodeitem, s]));
  const codes = [...new Set([...layersByItem.keys(), ...stockByItem.keys()])].sort();

  const movements: PlannedOpening[] = [];
  const lastCost = new Map<string, string>();
  for (const code of codes) {
    const productId = productIdByCode.get(code);
    if (!productId) {
      issue(
        'STOCK_UNKNOWN_ITEM',
        'Stok untuk barang yang tidak ada di data master',
        'Dilewati; periksa apakah barangnya terhapus di iPOS.',
        code,
      );
      continue;
    }
    const layers = layersByItem.get(code) ?? [];
    let inLayers = dec(0);
    for (const l of layers) {
      const qty = dec(num(l.sisa));
      inLayers = inLayers.plus(qty);
      movements.push({
        productId,
        kodeitem: code,
        qty: toQty(qty),
        unitCost: toQty(dec(num(l.hargadasar))),
        layerReceivedAt: wib(l.tanggal),
        legacyKey: l.iddetail,
      });
    }
    const last = rows.lastCost.get(code);
    if (last) lastCost.set(productId, toQty(num(last)));

    const stok = stockByItem.has(code) ? dec(num(stockByItem.get(code)!.stok)) : inLayers;
    const diff = stok.minus(inLayers);
    if (diff.gt(0)) {
      const hpp = dec(num(stockByItem.get(code)?.hppdasar));
      const cost = hpp.gt(0) ? hpp : dec(last ? num(last) : '0');
      issue(
        'STOCK_WITHOUT_LAYER',
        'Stok iPOS lebih banyak dari lapisan HPP-nya',
        'Selisihnya dibuat lapisan dengan HPP rata-rata iPOS.',
        `${code}: ${toQty(diff)}`,
      );
      movements.push({ productId, kodeitem: code, qty: toQty(diff), unitCost: toQty(cost), legacyKey: null });
    } else if (diff.lt(0)) {
      if (stok.lt(0))
        issue(
          'STOCK_MINUS',
          'Stok minus di iPOS',
          'Diimpor minus apa adanya; muncul di filter "Minus" layar Stok.',
          `${code}: ${toQty(stok)}`,
        );
      else
        issue(
          'STOCK_LAYER_EXCESS',
          'Lapisan HPP iPOS lebih banyak dari stoknya',
          'Stok disamakan dengan iPOS (lapisan tertua dikurangi).',
          `${code}: ${toQty(diff)}`,
        );
      movements.push({ productId, kodeitem: code, qty: toQty(diff), legacyKey: null });
    }
  }
  return { movements, lastCost, issues: [...issues.values()] };
}
