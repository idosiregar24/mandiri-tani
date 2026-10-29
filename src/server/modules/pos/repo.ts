// Read-only lookups for the cashier screen (sprint-5 B1/B2). One query per keystroke/scan.
import type { PosProduct } from '@shared/schemas/pos';
import type { LastPrice } from '@shared/schemas/sales';
import type { Queryable } from '../../db/pool';
import { likePattern } from '../../lib/http';

const MAX_WORDS = 5;
export const SEARCH_LIMIT = 20;

/** Product → its sellable units with every price row, and stock available in the default warehouse. */
const PRODUCT_JSON = `
  json_build_object(
    'id', p.id, 'sku', p.sku, 'name', p.name, 'baseUnitCode', bu.code,
    'trackStock', p.track_stock, 'allowDecimalQty', p.allow_decimal_qty,
    'availableQty', trim_scale(coalesce((
        SELECT b.qty - b.reserved_qty FROM stock_balances b
        WHERE b.product_id = p.id
          AND b.warehouse_id = (SELECT w.id FROM warehouses w WHERE w.is_default AND w.deleted_at IS NULL)), 0))::text,
    'units', coalesce((
      SELECT json_agg(json_build_object(
               'id', pu.id, 'unitCode', u.code, 'conversionQty', trim_scale(pu.conversion_qty)::text,
               'isBase', pu.is_base, 'isDefaultSale', pu.is_default_sale,
               'barcodes', coalesce((SELECT json_agg(pb.barcode ORDER BY pb.barcode) FROM product_barcodes pb
                                     WHERE pb.product_unit_id = pu.id AND pb.deleted_at IS NULL), '[]'::json),
               'prices', coalesce((SELECT json_agg(json_build_object(
                                     'customerGroupId', pp.customer_group_id,
                                     'minQty', trim_scale(pp.min_qty)::text,
                                     'price', pp.price::text) ORDER BY pp.customer_group_id NULLS FIRST, pp.min_qty)
                                   FROM product_prices pp WHERE pp.product_unit_id = pu.id AND pp.deleted_at IS NULL), '[]'::json))
             ORDER BY pu.conversion_qty, u.code)
      FROM product_units pu JOIN units u ON u.id = pu.unit_id
      WHERE pu.product_id = p.id AND pu.deleted_at IS NULL AND pu.is_sellable), '[]'::json)
  )`;

/**
 * Exact SKU / barcode first, then names starting with the text, then the rest; every word
 * of the search must appear in the name ("npk mutiara" finds "NPK MUTIARA 16-16-16").
 */
export async function search(db: Queryable, q: string): Promise<PosProduct[]> {
  const words = q.split(/\s+/).filter(Boolean).slice(0, MAX_WORDS);
  const params: unknown[] = [q, likePattern(q), `${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`];
  const nameMatch = words.map((w) => {
    params.push(likePattern(w));
    return `p.name ILIKE $${params.length}`;
  });
  params.push(SEARCH_LIMIT);
  const r = await db.query<{ product: PosProduct }>(
    `WITH exact AS (
       SELECT pu.product_id FROM product_barcodes pb JOIN product_units pu ON pu.id = pb.product_unit_id
       WHERE pb.barcode = $1 AND pb.deleted_at IS NULL AND pu.deleted_at IS NULL)
     SELECT ${PRODUCT_JSON} AS product
     FROM products p JOIN units bu ON bu.id = p.base_unit_id
     WHERE p.deleted_at IS NULL AND p.is_active
       AND (upper(p.sku) = upper($1) OR p.id IN (SELECT product_id FROM exact)
            OR p.sku ILIKE $2 OR (${nameMatch.join(' AND ')}))
     ORDER BY CASE WHEN upper(p.sku) = upper($1) OR p.id IN (SELECT product_id FROM exact) THEN 0
                   WHEN p.name ILIKE $3 THEN 1 ELSE 2 END,
              p.name, p.sku
     LIMIT $${params.length}`,
    params,
  );
  return r.rows.map((x) => x.product);
}

/** Scanner: barcode → that unit; SKU → the default sale unit (or the base unit). */
export async function lookup(db: Queryable, code: string): Promise<{ product: PosProduct; unitId: string } | null> {
  const r = await db.query<{ product: PosProduct; unitId: string }>(
    `WITH hit AS (
       (SELECT pu.product_id, pu.id AS unit_id, 0 AS rank
          FROM product_barcodes pb JOIN product_units pu ON pu.id = pb.product_unit_id
         WHERE pb.barcode = $1 AND pb.deleted_at IS NULL AND pu.deleted_at IS NULL AND pu.is_sellable)
       UNION ALL
       (SELECT p.id, (SELECT pu.id FROM product_units pu
                       WHERE pu.product_id = p.id AND pu.deleted_at IS NULL AND pu.is_sellable
                       ORDER BY pu.is_default_sale DESC, pu.is_base DESC, pu.conversion_qty LIMIT 1), 1
          FROM products p WHERE upper(p.sku) = upper($1) AND p.deleted_at IS NULL)
       ORDER BY rank LIMIT 1)
     SELECT ${PRODUCT_JSON} AS product, hit.unit_id AS "unitId"
     FROM hit JOIN products p ON p.id = hit.product_id JOIN units bu ON bu.id = p.base_unit_id
     WHERE p.deleted_at IS NULL AND p.is_active AND hit.unit_id IS NOT NULL`,
    [code],
  );
  return r.rows[0] ?? null;
}

/** Products by id in the cashier's shape (recalling a held note). */
export async function productsByIds(db: Queryable, ids: string[]): Promise<PosProduct[]> {
  if (!ids.length) return [];
  const r = await db.query<{ product: PosProduct }>(
    `SELECT ${PRODUCT_JSON} AS product FROM products p JOIN units bu ON bu.id = p.base_unit_id
     WHERE p.id = ANY($1::uuid[]) AND p.deleted_at IS NULL`,
    [ids],
  );
  return r.rows.map((x) => x.product);
}

/** FR-POS-27: last 3 prices a customer paid for one product unit (completed notes only). */
export async function lastPrices(db: Queryable, customerId: string, productUnitId: string): Promise<LastPrice[]> {
  const r = await db.query<LastPrice>(
    `SELECT s.id AS "saleId", s.number, to_json(s.trx_at) #>> '{}' AS "trxAt",
            trim_scale(i.qty)::text AS qty, i.unit_price::text AS "unitPrice"
     FROM sale_items i JOIN sales s ON s.id = i.sale_id
     WHERE s.customer_id = $1 AND i.product_unit_id = $2 AND s.status = 'COMPLETED'
     ORDER BY s.trx_at DESC, i.line_no
     LIMIT 3`,
    [customerId, productUnitId],
  );
  return r.rows;
}
