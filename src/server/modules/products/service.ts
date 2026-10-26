// Products with their units, barcodes and prices saved as ONE package in one transaction
// (FR-MD-01…04, PRD §6.3). Price changes are audited (security-standards §7).
import { dec, toMoney, toQty } from '@shared/money';
import {
  ProductInput,
  type Product,
  type ProductInputParsed,
  type ProductListItem,
  type ProductListQuery,
} from '@shared/schemas/master';
import type { Pool, PoolClient } from '../../db/pool';
import { withTransaction } from '../../db/tx';
import { recordAudit } from '../../lib/audit';
import { AppError, isUniqueViolation, notFoundError } from '../../lib/errors';
import type { RequestCtx } from '../../middleware/auth';
import * as repo from './repo';

type UnitIn = ProductInputParsed['units'][number];

export async function list(
  pool: Pool,
  q: ProductListQuery,
): Promise<{ rows: ProductListItem[]; total: number; page: number; pageSize: number }> {
  const r = await repo.list(pool, { ...q, limit: q.pageSize, offset: (q.page - 1) * q.pageSize });
  return { ...r, page: q.page, pageSize: q.pageSize };
}

export async function get(pool: Pool, id: string): Promise<Product> {
  const p = await repo.get(pool, id);
  if (!p) throw notFoundError('Barang');
  return p;
}

/** Exactly one default sale and one default purchase unit; the base unit when none was chosen. */
function normaliseDefaults(units: UnitIn[]): UnitIn[] {
  const pick = (flag: 'isDefaultSale' | 'isDefaultPurchase') => {
    const chosen = units.findIndex((u) => u[flag]);
    return chosen >= 0 ? chosen : units.findIndex((u) => u.isBase);
  };
  const sale = pick('isDefaultSale');
  const purchase = pick('isDefaultPurchase');
  return units.map((u, i) => ({ ...u, isDefaultSale: i === sale, isDefaultPurchase: i === purchase }));
}

async function validateReferences(tx: PoolClient, input: ProductInputParsed, productId: string | null): Promise<void> {
  if (input.categoryId && !(await repo.existing(tx, 'categories', [input.categoryId])).has(input.categoryId))
    throw notFoundError('Kategori');
  if (input.brandId && !(await repo.existing(tx, 'brands', [input.brandId])).has(input.brandId))
    throw notFoundError('Merek');
  const unitIds = input.units.map((u) => u.unitId);
  const units = await repo.existing(tx, 'units', unitIds);
  if (unitIds.some((id) => !units.has(id))) throw notFoundError('Satuan');
  const groupIds = [
    ...new Set(
      input.units.flatMap((u) => u.prices.map((p) => p.customerGroupId)).filter((g): g is string => g !== null),
    ),
  ];
  const groups = await repo.existing(tx, 'customer_groups', groupIds);
  if (groupIds.some((id) => !groups.has(id))) throw notFoundError('Grup pelanggan');

  for (const [i, u] of input.units.entries()) {
    const keys = new Set<string>();
    for (const p of u.prices) {
      const key = `${p.customerGroupId ?? ''}|${toQty(p.minQty)}`;
      if (keys.has(key))
        throw new AppError(
          'DUPLICATE_PRICE',
          `Satuan baris ${i + 1}: harga untuk grup & jumlah minimum yang sama ditulis dua kali.`,
          422,
        );
      keys.add(key);
    }
  }

  const taken = await repo.barcodesInUse(
    tx,
    input.units.flatMap((u) => u.barcodes),
    productId,
  );
  if (taken.length > 0) {
    const t = taken[0]!;
    throw new AppError('DUPLICATE_BARCODE', `Barcode ${t.barcode} sudah dipakai barang "${t.productName}".`, 409, {
      barcodes: taken.map((x) => x.barcode),
    });
  }
}

function productRow(input: ProductInputParsed, sku: string): repo.ProductRow {
  const base = input.units.find((u) => u.isBase)!;
  return {
    sku,
    name: input.name,
    categoryId: input.categoryId,
    brandId: input.brandId,
    itemType: input.itemType,
    baseUnitId: base.unitId,
    trackStock: input.itemType === 'STANDARD',
    allowDecimalQty: input.allowDecimalQty,
    minStock: toQty(input.minStock),
    maxStock: input.maxStock === null ? null : toQty(input.maxStock),
    isActive: input.isActive,
  };
}

const unitRow = (u: UnitIn): repo.UnitRow => ({
  unitId: u.unitId,
  conversionQty: toQty(u.conversionQty),
  isBase: u.isBase,
  isDefaultSale: u.isDefaultSale,
  isDefaultPurchase: u.isDefaultPurchase,
  isSellable: u.isSellable,
});

function skuDuplicate(err: unknown, sku: string): never {
  if (isUniqueViolation(err, 'products_sku_uq'))
    throw new AppError('DUPLICATE', `Kode barang ${sku} sudah dipakai barang lain.`, 409);
  if (isUniqueViolation(err, 'product_barcodes_barcode_uq'))
    throw new AppError('DUPLICATE_BARCODE', 'Barcode sudah dipakai barang lain.', 409);
  throw err;
}

/** Price snapshot for the audit log: "ZAK|umum|1" → "640000.00". */
function priceMap(p: Product): Record<string, string> {
  const out: Record<string, string> = {};
  for (const u of p.units)
    for (const x of u.prices) out[`${u.unitCode}|${x.customerGroupId ?? 'umum'}|${x.minQty}`] = x.price;
  return out;
}

async function auditPrices(tx: PoolClient, ctx: RequestCtx, before: Product | null, after: Product): Promise<void> {
  const b = before ? priceMap(before) : {};
  const a = priceMap(after);
  const keys = new Set([...Object.keys(b), ...Object.keys(a)]);
  const changed = [...keys].filter((k) => b[k] !== a[k]);
  if (changed.length === 0) return;
  await recordAudit(tx, ctx, {
    action: before ? 'price.update' : 'price.create',
    entity: 'product',
    entityId: after.id,
    before: Object.fromEntries(changed.map((k) => [k, b[k] ?? null])),
    after: Object.fromEntries(changed.map((k) => [k, a[k] ?? null])),
  });
}

async function writePrices(
  tx: PoolClient,
  productUnitId: string,
  wanted: UnitIn['prices'],
  current: Product['units'][number]['prices'],
): Promise<void> {
  const key = (g: string | null, q: string) => `${g ?? ''}|${toQty(q)}`;
  const want = new Map(wanted.map((p) => [key(p.customerGroupId, p.minQty), p]));
  for (const c of current) {
    const w = want.get(key(c.customerGroupId, c.minQty));
    if (!w) await repo.softDeletePrice(tx, c.id);
    else if (!dec(w.price).eq(c.price)) await repo.updatePrice(tx, c.id, toMoney(w.price));
    want.delete(key(c.customerGroupId, c.minQty));
  }
  for (const p of want.values()) {
    await repo.insertPrice(tx, productUnitId, {
      customerGroupId: p.customerGroupId,
      minQty: toQty(p.minQty),
      price: toMoney(p.price),
    });
  }
}

export async function create(pool: Pool, ctx: RequestCtx, raw: unknown): Promise<Product> {
  const parsed = ProductInput.parse(raw);
  const input = { ...parsed, units: normaliseDefaults(parsed.units) };
  return withTransaction(pool, async (tx) => {
    await validateReferences(tx, input, null);
    const sku = input.sku ?? (await repo.nextSku(tx));
    try {
      const id = await repo.insertProduct(tx, productRow(input, sku));
      for (const u of input.units) {
        const puId = await repo.insertUnit(tx, id, unitRow(u));
        for (const code of u.barcodes) await repo.insertBarcode(tx, puId, code);
        await writePrices(tx, puId, u.prices, []);
      }
      const product = (await repo.get(tx, id))!;
      await auditPrices(tx, ctx, null, product);
      return product;
    } catch (err) {
      skuDuplicate(err, sku);
    }
  });
}

export async function update(pool: Pool, ctx: RequestCtx, id: string, raw: unknown): Promise<Product> {
  const parsed = ProductInput.parse(raw);
  const input = { ...parsed, units: normaliseDefaults(parsed.units) };
  return withTransaction(pool, async (tx) => {
    const before = await repo.get(tx, id);
    if (!before) throw notFoundError('Barang');
    await validateReferences(tx, input, id);
    const sku = input.sku ?? before.sku;

    const currentById = new Map(before.units.map((u) => [u.id, u]));
    for (const u of input.units) {
      if (u.id && !currentById.has(u.id)) throw notFoundError('Satuan barang');
    }
    // Sprint 4/5: refuse to change base unit or a used unit's conversion once stock movements exist.
    try {
      await repo.updateProduct(tx, id, productRow(input, sku));
      const keep = new Set(input.units.map((u) => u.id).filter(Boolean));
      await repo.softDeleteUnits(
        tx,
        before.units.filter((u) => !keep.has(u.id)).map((u) => u.id),
      );
      await repo.clearUnitFlags(tx, id);
      // Barcodes are released first so one can move between units of this product in a single save.
      for (const u of input.units) if (u.id) await repo.softDeleteBarcodes(tx, u.id, u.barcodes);
      for (const u of input.units) {
        let puId = u.id;
        if (puId) await repo.updateUnit(tx, puId, unitRow(u));
        else puId = await repo.insertUnit(tx, id, unitRow(u));
        for (const code of u.barcodes) await repo.insertBarcode(tx, puId, code);
        await writePrices(tx, puId, u.prices, (u.id && currentById.get(u.id)?.prices) || []);
      }
    } catch (err) {
      skuDuplicate(err, sku);
    }
    const after = (await repo.get(tx, id))!;
    await auditPrices(tx, ctx, before, after);
    if (before.isActive !== after.isActive) {
      await recordAudit(tx, ctx, {
        action: after.isActive ? 'product.activate' : 'product.deactivate',
        entity: 'product',
        entityId: id,
      });
    }
    return after;
  });
}

export async function remove(pool: Pool, ctx: RequestCtx, id: string): Promise<void> {
  await withTransaction(pool, async (tx) => {
    const current = await repo.get(tx, id);
    if (!current) throw notFoundError('Barang');
    // Sprint 4: refuse while physical or reserved stock is not zero.
    await repo.softDeleteProduct(tx, id);
    await recordAudit(tx, ctx, {
      action: 'product.delete',
      entity: 'product',
      entityId: id,
      before: { sku: current.sku, name: current.name },
    });
  });
}
