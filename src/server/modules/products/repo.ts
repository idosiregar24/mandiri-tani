import { uuidv7 } from '@shared/uuid';
import type { Product, ProductListItem, ProductPrice, ProductUnit } from '@shared/schemas/master';
import type { Queryable } from '../../db/pool';
import { likePattern } from '../../lib/http';

export interface ProductRow {
  sku: string;
  name: string;
  categoryId: string | null;
  brandId: string | null;
  itemType: string;
  baseUnitId: string;
  trackStock: boolean;
  allowDecimalQty: boolean;
  minStock: string;
  maxStock: string | null;
  isActive: boolean;
}

export interface UnitRow {
  unitId: string;
  conversionQty: string;
  isBase: boolean;
  isDefaultSale: boolean;
  isDefaultPurchase: boolean;
  isSellable: boolean;
}

// ------------------------------------------------------------------ read
export async function list(
  db: Queryable,
  opts: { q?: string; categoryId?: string; includeInactive: boolean; limit: number; offset: number },
): Promise<{ rows: ProductListItem[]; total: number }> {
  const where = ['p.deleted_at IS NULL'];
  const params: unknown[] = [];
  if (!opts.includeInactive) where.push('p.is_active');
  if (opts.q) {
    params.push(likePattern(opts.q), opts.q);
    where.push(`(p.name ILIKE $${params.length - 1} OR p.sku ILIKE $${params.length - 1} OR EXISTS (
      SELECT 1 FROM product_barcodes b JOIN product_units pu ON pu.id = b.product_unit_id
      WHERE pu.product_id = p.id AND b.barcode = $${params.length} AND b.deleted_at IS NULL AND pu.deleted_at IS NULL))`);
  }
  if (opts.categoryId) {
    params.push(opts.categoryId);
    where.push(`p.category_id = $${params.length}`);
  }
  const clause = where.join(' AND ');
  const total = Number(
    (await db.query<{ n: string }>(`SELECT count(*) AS n FROM products p WHERE ${clause}`, params)).rows[0]!.n,
  );
  params.push(opts.limit, opts.offset);
  const rows = await db.query<ProductListItem>(
    `SELECT p.id, p.sku, p.name, c.name AS "categoryName", bu.code AS "baseUnitCode", p.is_active AS "isActive",
            coalesce((
              SELECT json_agg(json_build_object(
                       'unitCode', u.code,
                       'conversionQty', trim_scale(pu.conversion_qty)::text,
                       'price', (SELECT pp.price::text FROM product_prices pp
                                 WHERE pp.product_unit_id = pu.id AND pp.customer_group_id IS NULL
                                   AND pp.min_qty = 1 AND pp.deleted_at IS NULL))
                     ORDER BY pu.conversion_qty, u.code)
              FROM product_units pu JOIN units u ON u.id = pu.unit_id
              WHERE pu.product_id = p.id AND pu.deleted_at IS NULL), '[]'::json) AS units
     FROM products p
     JOIN units bu ON bu.id = p.base_unit_id
     LEFT JOIN categories c ON c.id = p.category_id
     WHERE ${clause}
     ORDER BY p.name, p.sku
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  return { rows: rows.rows, total };
}

export async function get(db: Queryable, id: string): Promise<Product | null> {
  const p = (
    await db.query<Omit<Product, 'units'>>(
      `SELECT p.id, p.sku, p.name, p.category_id AS "categoryId", c.name AS "categoryName",
              p.brand_id AS "brandId", b.name AS "brandName", p.item_type AS "itemType", p.track_stock AS "trackStock",
              p.allow_decimal_qty AS "allowDecimalQty", trim_scale(p.min_stock)::text AS "minStock",
              trim_scale(p.max_stock)::text AS "maxStock", p.is_active AS "isActive", p.updated_at AS "updatedAt"
       FROM products p
       LEFT JOIN categories c ON c.id = p.category_id
       LEFT JOIN brands b ON b.id = p.brand_id
       WHERE p.id = $1 AND p.deleted_at IS NULL`,
      [id],
    )
  ).rows[0];
  if (!p) return null;

  const units = (
    await db.query<Omit<ProductUnit, 'barcodes' | 'prices'>>(
      `SELECT pu.id, pu.unit_id AS "unitId", u.code AS "unitCode", u.name AS "unitName",
              trim_scale(pu.conversion_qty)::text AS "conversionQty", pu.is_base AS "isBase",
              pu.is_default_sale AS "isDefaultSale", pu.is_default_purchase AS "isDefaultPurchase", pu.is_sellable AS "isSellable"
       FROM product_units pu JOIN units u ON u.id = pu.unit_id
       WHERE pu.product_id = $1 AND pu.deleted_at IS NULL
       ORDER BY pu.conversion_qty, u.code`,
      [id],
    )
  ).rows;
  const unitIds = units.map((u) => u.id);
  const barcodes = (
    await db.query<{ productUnitId: string; barcode: string }>(
      `SELECT product_unit_id AS "productUnitId", barcode FROM product_barcodes
       WHERE product_unit_id = ANY($1) AND deleted_at IS NULL ORDER BY created_at, barcode`,
      [unitIds],
    )
  ).rows;
  const prices = (
    await db.query<ProductPrice & { productUnitId: string }>(
      `SELECT id, product_unit_id AS "productUnitId", customer_group_id AS "customerGroupId",
              trim_scale(min_qty)::text AS "minQty", price::text AS price
       FROM product_prices WHERE product_unit_id = ANY($1) AND deleted_at IS NULL
       ORDER BY customer_group_id NULLS FIRST, min_qty`,
      [unitIds],
    )
  ).rows;

  return {
    ...p,
    units: units.map((u) => ({
      ...u,
      barcodes: barcodes.filter((b) => b.productUnitId === u.id).map((b) => b.barcode),
      prices: prices.filter((x) => x.productUnitId === u.id).map(({ productUnitId: _, ...x }) => x),
    })),
  };
}

/** Next free BRGxxxxx for a product saved without a code, counting deleted rows too. */
export async function nextSku(db: Queryable): Promise<string> {
  const r = await db.query<{ n: number }>(
    `SELECT coalesce(max(substring(sku FROM 4)::bigint), 0)::int + 1 AS n FROM products WHERE sku ~ '^BRG[0-9]{1,9}$'`,
  );
  return `BRG${String(r.rows[0]!.n).padStart(5, '0')}`;
}

export async function existing(
  db: Queryable,
  table: 'categories' | 'brands' | 'units' | 'customer_groups',
  ids: string[],
): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const r = await db.query<{ id: string }>(`SELECT id FROM ${table} WHERE id = ANY($1) AND deleted_at IS NULL`, [ids]);
  return new Set(r.rows.map((x) => x.id));
}

/** Barcodes already used by OTHER product units (global uniqueness, FR-MD-03). */
export async function barcodesInUse(
  db: Queryable,
  codes: string[],
  exceptProductId: string | null,
): Promise<{ barcode: string; productName: string }[]> {
  if (codes.length === 0) return [];
  return (
    await db.query<{ barcode: string; productName: string }>(
      `SELECT b.barcode, p.name AS "productName"
       FROM product_barcodes b
       JOIN product_units pu ON pu.id = b.product_unit_id
       JOIN products p ON p.id = pu.product_id
       WHERE b.barcode = ANY($1) AND b.deleted_at IS NULL AND p.id IS DISTINCT FROM $2`,
      [codes, exceptProductId],
    )
  ).rows;
}

// ------------------------------------------------------------------ write
export async function insertProduct(db: Queryable, row: ProductRow, id = uuidv7()): Promise<string> {
  await db.query(
    `INSERT INTO products (id, sku, name, category_id, brand_id, item_type, base_unit_id, track_stock, allow_decimal_qty,
                           min_stock, max_stock, is_active)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
    [
      id,
      row.sku,
      row.name,
      row.categoryId,
      row.brandId,
      row.itemType,
      row.baseUnitId,
      row.trackStock,
      row.allowDecimalQty,
      row.minStock,
      row.maxStock,
      row.isActive,
    ],
  );
  return id;
}

export async function updateProduct(db: Queryable, id: string, row: ProductRow): Promise<void> {
  await db.query(
    `UPDATE products SET sku = $2, name = $3, category_id = $4, brand_id = $5, item_type = $6, base_unit_id = $7,
            track_stock = $8, allow_decimal_qty = $9, min_stock = $10, max_stock = $11, is_active = $12
     WHERE id = $1`,
    [
      id,
      row.sku,
      row.name,
      row.categoryId,
      row.brandId,
      row.itemType,
      row.baseUnitId,
      row.trackStock,
      row.allowDecimalQty,
      row.minStock,
      row.maxStock,
      row.isActive,
    ],
  );
}

export async function softDeleteProduct(db: Queryable, id: string): Promise<void> {
  await db.query(
    `UPDATE product_barcodes SET deleted_at = now()
     WHERE deleted_at IS NULL AND product_unit_id IN (SELECT id FROM product_units WHERE product_id = $1)`,
    [id],
  );
  await db.query('UPDATE products SET deleted_at = now(), is_active = false WHERE id = $1', [id]);
}

/** Drop the base/default flags of every unit so they can be re-assigned without tripping the one-base index. */
export async function clearUnitFlags(db: Queryable, productId: string): Promise<void> {
  await db.query(
    `UPDATE product_units SET is_base = false, is_default_sale = false, is_default_purchase = false
     WHERE product_id = $1 AND deleted_at IS NULL AND (is_base OR is_default_sale OR is_default_purchase)`,
    [productId],
  );
}

export async function insertUnit(db: Queryable, productId: string, u: UnitRow, id = uuidv7()): Promise<string> {
  await db.query(
    `INSERT INTO product_units (id, product_id, unit_id, conversion_qty, is_base, is_default_sale, is_default_purchase, is_sellable)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [id, productId, u.unitId, u.conversionQty, u.isBase, u.isDefaultSale, u.isDefaultPurchase, u.isSellable],
  );
  return id;
}

export async function updateUnit(db: Queryable, id: string, u: UnitRow): Promise<void> {
  await db.query(
    `UPDATE product_units SET unit_id = $2, conversion_qty = $3, is_base = $4, is_default_sale = $5,
            is_default_purchase = $6, is_sellable = $7
     WHERE id = $1`,
    [id, u.unitId, u.conversionQty, u.isBase, u.isDefaultSale, u.isDefaultPurchase, u.isSellable],
  );
}

export async function softDeleteUnits(db: Queryable, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await db.query(
    'UPDATE product_barcodes SET deleted_at = now() WHERE product_unit_id = ANY($1) AND deleted_at IS NULL',
    [ids],
  );
  await db.query(
    'UPDATE product_prices SET deleted_at = now() WHERE product_unit_id = ANY($1) AND deleted_at IS NULL',
    [ids],
  );
  await db.query('UPDATE product_units SET deleted_at = now() WHERE id = ANY($1)', [ids]);
}

export async function softDeleteBarcodes(db: Queryable, productUnitId: string, keep: string[]): Promise<void> {
  await db.query(
    'UPDATE product_barcodes SET deleted_at = now() WHERE product_unit_id = $1 AND deleted_at IS NULL AND NOT (barcode = ANY($2))',
    [productUnitId, keep],
  );
}

export async function insertBarcode(db: Queryable, productUnitId: string, barcode: string): Promise<void> {
  await db.query(
    `INSERT INTO product_barcodes (id, product_unit_id, barcode)
     SELECT $1, $2, $3
     WHERE NOT EXISTS (SELECT 1 FROM product_barcodes WHERE product_unit_id = $2 AND barcode = $3 AND deleted_at IS NULL)`,
    [uuidv7(), productUnitId, barcode],
  );
}

export async function softDeletePrice(db: Queryable, id: string): Promise<void> {
  await db.query('UPDATE product_prices SET deleted_at = now() WHERE id = $1', [id]);
}

export async function updatePrice(db: Queryable, id: string, price: string): Promise<void> {
  await db.query('UPDATE product_prices SET price = $2 WHERE id = $1', [id, price]);
}

export async function insertPrice(
  db: Queryable,
  productUnitId: string,
  p: { customerGroupId: string | null; minQty: string; price: string },
): Promise<void> {
  await db.query(
    `INSERT INTO product_prices (id, product_unit_id, customer_group_id, min_qty, price) VALUES ($1, $2, $3, $4, $5)`,
    [uuidv7(), productUnitId, p.customerGroupId, p.minQty, p.price],
  );
}
