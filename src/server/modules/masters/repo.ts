// SQL for the small masters: units, categories, brands, warehouses, customer groups.
import { uuidv7 } from '@shared/uuid';
import type {
  Brand,
  BrandInput,
  Category,
  CategoryInput,
  CustomerGroup,
  CustomerGroupInput,
  Unit,
  UnitInput,
  Warehouse,
  WarehouseInput,
} from '@shared/schemas/master';
import type { Queryable } from '../../db/pool';

// ------------------------------------------------------------------ units
const UNIT_SELECT = `
  SELECT u.id, u.code, u.name,
         (SELECT count(*) FROM product_units pu JOIN products p ON p.id = pu.product_id
           WHERE pu.unit_id = u.id AND pu.deleted_at IS NULL AND p.deleted_at IS NULL)::int AS "productCount"
  FROM units u`;

export async function listUnits(db: Queryable): Promise<Unit[]> {
  return (await db.query<Unit>(`${UNIT_SELECT} WHERE u.deleted_at IS NULL ORDER BY u.code`)).rows;
}

export async function getUnit(db: Queryable, id: string): Promise<Unit | null> {
  return (await db.query<Unit>(`${UNIT_SELECT} WHERE u.id = $1 AND u.deleted_at IS NULL`, [id])).rows[0] ?? null;
}

export async function insertUnit(db: Queryable, input: UnitInput): Promise<string> {
  const id = uuidv7();
  await db.query('INSERT INTO units (id, code, name) VALUES ($1, $2, $3)', [id, input.code, input.name]);
  return id;
}

export async function updateUnit(db: Queryable, id: string, input: UnitInput): Promise<boolean> {
  const r = await db.query('UPDATE units SET code = $2, name = $3 WHERE id = $1 AND deleted_at IS NULL', [
    id,
    input.code,
    input.name,
  ]);
  return r.rowCount === 1;
}

export async function softDeleteUnit(db: Queryable, id: string): Promise<boolean> {
  const r = await db.query('UPDATE units SET deleted_at = now() WHERE id = $1 AND deleted_at IS NULL', [id]);
  return r.rowCount === 1;
}

// ------------------------------------------------------------------ categories
const CATEGORY_SELECT = `
  SELECT c.id, c.name, c.parent_id AS "parentId",
         (SELECT count(*) FROM products p WHERE p.category_id = c.id AND p.deleted_at IS NULL)::int AS "productCount"
  FROM categories c`;

export async function listCategories(db: Queryable): Promise<Category[]> {
  return (await db.query<Category>(`${CATEGORY_SELECT} WHERE c.deleted_at IS NULL ORDER BY c.name`)).rows;
}

export async function getCategory(db: Queryable, id: string): Promise<Category | null> {
  return (
    (await db.query<Category>(`${CATEGORY_SELECT} WHERE c.id = $1 AND c.deleted_at IS NULL`, [id])).rows[0] ?? null
  );
}

export async function categoryNameTaken(db: Queryable, name: string, exceptId?: string): Promise<boolean> {
  const r = await db.query(
    'SELECT 1 FROM categories WHERE upper(name) = upper($1) AND deleted_at IS NULL AND id IS DISTINCT FROM $2',
    [name, exceptId ?? null],
  );
  return (r.rowCount ?? 0) > 0;
}

export async function insertCategory(db: Queryable, input: CategoryInput): Promise<string> {
  const id = uuidv7();
  await db.query('INSERT INTO categories (id, name, parent_id) VALUES ($1, $2, $3)', [id, input.name, input.parentId]);
  return id;
}

export async function updateCategory(db: Queryable, id: string, input: CategoryInput): Promise<boolean> {
  const r = await db.query('UPDATE categories SET name = $2, parent_id = $3 WHERE id = $1 AND deleted_at IS NULL', [
    id,
    input.name,
    input.parentId,
  ]);
  return r.rowCount === 1;
}

export async function softDeleteCategory(db: Queryable, id: string): Promise<boolean> {
  const r = await db.query('UPDATE categories SET deleted_at = now() WHERE id = $1 AND deleted_at IS NULL', [id]);
  return r.rowCount === 1;
}

export async function categoryHasChildren(db: Queryable, id: string): Promise<boolean> {
  const r = await db.query('SELECT 1 FROM categories WHERE parent_id = $1 AND deleted_at IS NULL LIMIT 1', [id]);
  return (r.rowCount ?? 0) > 0;
}

// ------------------------------------------------------------------ brands
const BRAND_SELECT = `
  SELECT b.id, b.name,
         (SELECT count(*) FROM products p WHERE p.brand_id = b.id AND p.deleted_at IS NULL)::int AS "productCount"
  FROM brands b`;

export async function listBrands(db: Queryable): Promise<Brand[]> {
  return (await db.query<Brand>(`${BRAND_SELECT} WHERE b.deleted_at IS NULL ORDER BY b.name`)).rows;
}

export async function getBrand(db: Queryable, id: string): Promise<Brand | null> {
  return (await db.query<Brand>(`${BRAND_SELECT} WHERE b.id = $1 AND b.deleted_at IS NULL`, [id])).rows[0] ?? null;
}

export async function brandNameTaken(db: Queryable, name: string, exceptId?: string): Promise<boolean> {
  const r = await db.query(
    'SELECT 1 FROM brands WHERE upper(name) = upper($1) AND deleted_at IS NULL AND id IS DISTINCT FROM $2',
    [name, exceptId ?? null],
  );
  return (r.rowCount ?? 0) > 0;
}

export async function insertBrand(db: Queryable, input: BrandInput): Promise<string> {
  const id = uuidv7();
  await db.query('INSERT INTO brands (id, name) VALUES ($1, $2)', [id, input.name]);
  return id;
}

export async function updateBrand(db: Queryable, id: string, input: BrandInput): Promise<boolean> {
  const r = await db.query('UPDATE brands SET name = $2 WHERE id = $1 AND deleted_at IS NULL', [id, input.name]);
  return r.rowCount === 1;
}

export async function softDeleteBrand(db: Queryable, id: string): Promise<boolean> {
  const r = await db.query('UPDATE brands SET deleted_at = now() WHERE id = $1 AND deleted_at IS NULL', [id]);
  return r.rowCount === 1;
}

// ------------------------------------------------------------------ warehouses
const WAREHOUSE_SELECT = `
  SELECT w.id, w.code, w.name, w.is_default AS "isDefault", w.is_active AS "isActive" FROM warehouses w`;

export async function listWarehouses(db: Queryable): Promise<Warehouse[]> {
  return (
    await db.query<Warehouse>(`${WAREHOUSE_SELECT} WHERE w.deleted_at IS NULL ORDER BY w.is_default DESC, w.code`)
  ).rows;
}

export async function getWarehouse(db: Queryable, id: string): Promise<Warehouse | null> {
  return (
    (await db.query<Warehouse>(`${WAREHOUSE_SELECT} WHERE w.id = $1 AND w.deleted_at IS NULL`, [id])).rows[0] ?? null
  );
}

export async function clearDefaultWarehouse(db: Queryable, exceptId: string | null): Promise<void> {
  await db.query(
    'UPDATE warehouses SET is_default = false WHERE is_default AND deleted_at IS NULL AND id IS DISTINCT FROM $1',
    [exceptId],
  );
}

export async function insertWarehouse(db: Queryable, input: WarehouseInput): Promise<string> {
  const id = uuidv7();
  await db.query('INSERT INTO warehouses (id, code, name, is_default, is_active) VALUES ($1, $2, $3, $4, $5)', [
    id,
    input.code,
    input.name,
    input.isDefault,
    input.isActive,
  ]);
  return id;
}

export async function updateWarehouse(db: Queryable, id: string, input: WarehouseInput): Promise<boolean> {
  const r = await db.query(
    'UPDATE warehouses SET code = $2, name = $3, is_default = $4, is_active = $5 WHERE id = $1 AND deleted_at IS NULL',
    [id, input.code, input.name, input.isDefault, input.isActive],
  );
  return r.rowCount === 1;
}

export async function softDeleteWarehouse(db: Queryable, id: string): Promise<boolean> {
  const r = await db.query(
    'UPDATE warehouses SET deleted_at = now(), is_active = false WHERE id = $1 AND deleted_at IS NULL',
    [id],
  );
  return r.rowCount === 1;
}

// ------------------------------------------------------------------ customer groups
const GROUP_SELECT = `
  SELECT g.id, g.code, g.name, g.discount_percent::text AS "discountPercent",
         (SELECT count(*) FROM customers c WHERE c.customer_group_id = g.id AND c.deleted_at IS NULL)::int AS "customerCount"
  FROM customer_groups g`;

export async function listCustomerGroups(db: Queryable): Promise<CustomerGroup[]> {
  return (
    await db.query<CustomerGroup>(
      `${GROUP_SELECT} WHERE g.deleted_at IS NULL ORDER BY (upper(g.code) <> 'UMUM'), g.name`,
    )
  ).rows;
}

export async function getCustomerGroup(db: Queryable, id: string): Promise<CustomerGroup | null> {
  return (
    (await db.query<CustomerGroup>(`${GROUP_SELECT} WHERE g.id = $1 AND g.deleted_at IS NULL`, [id])).rows[0] ?? null
  );
}

export async function insertCustomerGroup(db: Queryable, input: CustomerGroupInput): Promise<string> {
  const id = uuidv7();
  await db.query('INSERT INTO customer_groups (id, code, name, discount_percent) VALUES ($1, $2, $3, $4)', [
    id,
    input.code,
    input.name,
    input.discountPercent,
  ]);
  return id;
}

export async function updateCustomerGroup(db: Queryable, id: string, input: CustomerGroupInput): Promise<boolean> {
  const r = await db.query(
    'UPDATE customer_groups SET code = $2, name = $3, discount_percent = $4 WHERE id = $1 AND deleted_at IS NULL',
    [id, input.code, input.name, input.discountPercent],
  );
  return r.rowCount === 1;
}

export async function softDeleteCustomerGroup(db: Queryable, id: string): Promise<boolean> {
  const r = await db.query('UPDATE customer_groups SET deleted_at = now() WHERE id = $1 AND deleted_at IS NULL', [id]);
  return r.rowCount === 1;
}

export async function groupHasPrices(db: Queryable, id: string): Promise<boolean> {
  const r = await db.query('SELECT 1 FROM product_prices WHERE customer_group_id = $1 AND deleted_at IS NULL LIMIT 1', [
    id,
  ]);
  return (r.rowCount ?? 0) > 0;
}
