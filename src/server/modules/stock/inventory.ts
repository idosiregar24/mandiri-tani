// Stock read service (FR-INV-02, 03, 07, 12, 13). Cost fields are stripped here, server-side,
// for roles without cost.read (security-standards §2) — never just hidden in the UI.
import { hasPermission } from '@shared/permissions';
import type {
  ConsistencyProblem,
  CostLayer,
  StockCard,
  StockCardQuery,
  StockListQuery,
  StockRow,
  StockSummary,
} from '@shared/schemas/stock';
import type { Pool, Queryable } from '../../db/pool';
import { clock, jakartaDate } from '../../lib/clock';
import { AppError, notFoundError } from '../../lib/errors';
import type { RequestCtx } from '../../middleware/auth';
import { dec, toQty } from '@shared/money';
import * as read from './read-repo';

const canSeeCost = (ctx: Pick<RequestCtx, 'role'>) => hasPermission(ctx.role, 'cost.read');

export async function list(
  pool: Pool,
  ctx: RequestCtx,
  q: StockListQuery,
): Promise<{ rows: StockRow[]; total: number; page: number; pageSize: number; summary: StockSummary }> {
  const wh = await read.defaultWarehouse(pool);
  const { rows, total } = await read.listStock(pool, wh.id, {
    ...q,
    limit: q.pageSize,
    offset: (q.page - 1) * q.pageSize,
  });
  const summary = await read.stockSummary(pool, wh.id);
  const cost = canSeeCost(ctx);
  return {
    rows: cost ? rows : rows.map(({ value: _v, avgCost: _a, ...r }) => r),
    total,
    page: q.page,
    pageSize: q.pageSize,
    summary: cost ? summary : { products: summary.products, low: summary.low, minus: summary.minus },
  };
}

const pad = (n: number) => String(n).padStart(2, '0');

/** Default period: the first day of the current month up to today (Asia/Jakarta). */
function period(q: StockCardQuery): { from: string; to: string } {
  const t = jakartaDate(clock.now());
  const today = `${t.year}-${pad(t.month)}-${pad(t.day)}`;
  const from = q.from ?? `${t.year}-${pad(t.month)}-01`;
  const to = q.to ?? today;
  if (from > to) throw new AppError('INVALID_PERIOD', 'Tanggal awal harus sebelum tanggal akhir.', 400);
  return { from, to };
}

export async function card(pool: Pool, ctx: RequestCtx, productId: string, q: StockCardQuery): Promise<StockCard> {
  const wh = await read.defaultWarehouse(pool);
  const head = await read.cardHead(pool, wh.id, productId);
  if (!head) throw notFoundError('Barang');
  const { from, to } = period(q);
  const { opening, lines } = await read.cardLines(pool, wh.id, productId, from, to);
  const totalIn = lines.reduce((s, l) => s.plus(l.qtyIn), dec(0));
  const totalOut = lines.reduce((s, l) => s.plus(l.qtyOut), dec(0));
  const cost = canSeeCost(ctx);
  return {
    productId: head.productId,
    sku: head.sku,
    name: head.name,
    baseUnitCode: head.baseUnitCode,
    saleUnitCode: head.saleUnitCode,
    saleConversion: head.saleConversion,
    from,
    to,
    opening,
    totalIn: toQty(totalIn),
    totalOut: toQty(totalOut),
    closing: toQty(dec(opening).plus(totalIn).minus(totalOut)),
    lines: cost ? lines : lines.map(({ unitCost: _u, costEstimated: _c, ...l }) => l),
    current: { qty: head.qty, reservedQty: head.reservedQty, availableQty: head.availableQty },
  };
}

export async function layers(pool: Pool, productId: string): Promise<CostLayer[]> {
  const wh = await read.defaultWarehouse(pool);
  return read.layers(pool, wh.id, productId);
}

export const consistency = (db: Queryable): Promise<ConsistencyProblem[]> => read.consistency(db);

/** Typed quantity in a product unit → base units, with the product's decimal rule (database-standards §4). */
export async function toBaseQty(
  db: Queryable,
  productId: string,
  productUnitId: string,
  qty: string,
): Promise<{ base: string; name: string }> {
  const u = await read.productUnit(db, productId, productUnitId);
  if (!u) throw notFoundError('Satuan barang');
  if (!u.trackStock) throw new AppError('NOT_STOCKED', `${u.name} adalah jasa (tanpa stok).`, 422);
  if (!u.allowDecimal && !dec(qty).isInteger()) {
    throw new AppError('DECIMAL_NOT_ALLOWED', `${u.name} tidak boleh dihitung pecahan dalam ${u.unitCode}.`, 422, {
      productId,
    });
  }
  return { base: toQty(dec(qty).times(u.conversion)), name: u.name };
}
