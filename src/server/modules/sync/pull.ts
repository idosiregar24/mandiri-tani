import type { SyncEntity, SyncPullQuery, SyncPullResult } from '@shared/schemas/sync';
import type { Queryable } from '../../db/pool';

const OVERLAP_MS = 120_000; // 120 seconds

interface CursorPayload {
  u: string; // updated_at ISO string (microsecond precision)
  i: string; // id UUID string
}

function encodeCursor(payload: CursorPayload): string {
  return Buffer.from(JSON.stringify(payload)).toString('base64url');
}

function decodeCursor(cursor: string): CursorPayload | null {
  try {
    const raw = Buffer.from(cursor, 'base64url').toString('utf8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.u === 'string' && typeof parsed.i === 'string') {
      return parsed as CursorPayload;
    }
    return null;
  } catch {
    return null;
  }
}

function selectClauseForEntity(entity: SyncEntity, canCost: boolean): { table: string; selectSql: string } {
  const tsSelect =
    entity === 'stock_balances'
      ? `to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS updated_at, NULL::text AS deleted_at`
      : `to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS updated_at,
         to_char(deleted_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS deleted_at`;

  switch (entity) {
    case 'units':
      return {
        table: 'units',
        selectSql: `id, code, name, ${tsSelect}`,
      };
    case 'categories':
      return {
        table: 'categories',
        selectSql: `id, name, parent_id, ${tsSelect}`,
      };
    case 'brands':
      return {
        table: 'brands',
        selectSql: `id, name, ${tsSelect}`,
      };
    case 'customer_groups':
      return {
        table: 'customer_groups',
        selectSql: `id, code, name, trim_scale(discount_percent)::text AS discount_percent, ${tsSelect}`,
      };
    case 'customers':
      return {
        table: 'customers',
        selectSql: `id, code, name, group_id, phone, address, trim_scale(credit_limit)::text AS credit_limit, payment_terms_days, is_active, ${tsSelect}`,
      };
    case 'suppliers':
      return {
        table: 'suppliers',
        selectSql: `id, code, name, phone, address, payment_terms_days, is_active, ${tsSelect}`,
      };
    case 'warehouses':
      return {
        table: 'warehouses',
        selectSql: `id, code, name, is_default, is_active, ${tsSelect}`,
      };
    case 'payment_methods':
      return {
        table: 'payment_methods',
        selectSql: `id, code, name, kind, account_number, account_holder, is_active, sort_order, ${tsSelect}`,
      };
    case 'products':
      return {
        table: 'products',
        selectSql: `id, sku, name, category_id, brand_id, item_type, track_stock, allow_decimal_qty,
                    trim_scale(min_stock)::text AS min_stock, trim_scale(max_stock)::text AS max_stock, is_active,
                    ${canCost ? 'last_purchase_cost::text' : 'NULL'} AS last_purchase_cost,
                    ${tsSelect}`,
      };
    case 'product_units':
      return {
        table: 'product_units',
        selectSql: `id, product_id, unit_id, trim_scale(conversion_qty)::text AS conversion_qty, is_base, is_default_sale, is_default_purchase, is_sellable, ${tsSelect}`,
      };
    case 'product_barcodes':
      return {
        table: 'product_barcodes',
        selectSql: `id, product_unit_id, barcode, ${tsSelect}`,
      };
    case 'product_prices':
      return {
        table: 'product_prices',
        selectSql: `id, product_unit_id, customer_group_id, trim_scale(min_qty)::text AS min_qty, price::text AS price, ${tsSelect}`,
      };
    case 'stock_balances':
      return {
        table: 'stock_balances',
        selectSql: `id, product_id, warehouse_id, trim_scale(qty)::text AS qty, trim_scale(reserved_qty)::text AS reserved_qty, ${tsSelect}`,
      };
  }
}

export async function pull(
  db: Queryable,
  q: SyncPullQuery,
  canCost: boolean,
): Promise<SyncPullResult> {
  const serverTime = new Date().toISOString();
  const { table, selectSql } = selectClauseForEntity(q.entity, canCost);

  const whereConditions: string[] = [];
  const params: unknown[] = [];

  const decoded = q.cursor ? decodeCursor(q.cursor) : null;

  if (decoded) {
    // Keyset pagination: strict (updated_at > $1 OR (updated_at = $1 AND id > $2)) — NO overlap!
    params.push(decoded.u, decoded.i);
    whereConditions.push(`(updated_at > $1::timestamptz OR (updated_at = $1::timestamptz AND id > $2))`);
  } else if (q.since) {
    // First page with since: OVERLAP = 120s to catch transactions that committed late
    const sinceDate = new Date(Date.parse(q.since) - OVERLAP_MS);
    params.push(sinceDate.toISOString());
    whereConditions.push(`updated_at > $1::timestamptz`);
  }

  const whereSql = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';
  params.push(q.limit + 1);

  const querySql = `
    SELECT ${selectSql}
    FROM ${table}
    ${whereSql}
    ORDER BY updated_at ASC, id ASC
    LIMIT $${params.length}
  `;

  const r = await db.query<Record<string, unknown> & { id: string; updated_at: string; deleted_at: string | null }>(
    querySql,
    params,
  );

  const hasMore = r.rows.length > q.limit;
  const rows = hasMore ? r.rows.slice(0, q.limit) : r.rows;

  const lastRow = rows[rows.length - 1];

  let nextCursor: string | undefined;
  let nextSince: string | undefined;

  if (hasMore && lastRow) {
    nextCursor = encodeCursor({ u: lastRow.updated_at, i: lastRow.id });
  } else {
    nextSince = lastRow ? lastRow.updated_at : (q.since ?? serverTime);
  }

  return {
    server_time: serverTime,
    rows,
    has_more: hasMore,
    cursor: nextCursor,
    next_since: nextSince,
  };
}
