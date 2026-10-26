// Business rules for the small masters (FR-MD-10, FR-MD-14): soft delete only, never
// delete something still in use, exactly one default warehouse, UMUM group is built in.
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
import type { Pool } from '../../db/pool';
import { withTransaction } from '../../db/tx';
import { recordAudit } from '../../lib/audit';
import { AppError, isUniqueViolation, notFoundError } from '../../lib/errors';
import type { RequestCtx } from '../../middleware/auth';
import * as repo from './repo';

const inUse = (message: string) => new AppError('REFERENCE_IN_USE', message, 409);

async function uniqueOr<T>(work: Promise<T>, message: string): Promise<T> {
  try {
    return await work;
  } catch (err) {
    if (isUniqueViolation(err)) throw new AppError('DUPLICATE', message, 409);
    throw err;
  }
}

// ------------------------------------------------------------------ units
export const listUnits = (pool: Pool) => repo.listUnits(pool);

export async function createUnit(pool: Pool, input: UnitInput): Promise<Unit> {
  const id = await uniqueOr(repo.insertUnit(pool, input), `Kode satuan ${input.code} sudah ada.`);
  return (await repo.getUnit(pool, id))!;
}

export async function updateUnit(pool: Pool, id: string, input: UnitInput): Promise<Unit> {
  const ok = await uniqueOr(repo.updateUnit(pool, id, input), `Kode satuan ${input.code} sudah ada.`);
  if (!ok) throw notFoundError('Satuan');
  return (await repo.getUnit(pool, id))!;
}

export async function deleteUnit(pool: Pool, ctx: RequestCtx, id: string): Promise<void> {
  await withTransaction(pool, async (tx) => {
    const unit = await repo.getUnit(tx, id);
    if (!unit) throw notFoundError('Satuan');
    if (unit.productCount > 0) throw inUse(`Satuan ${unit.code} masih dipakai ${unit.productCount} barang.`);
    await repo.softDeleteUnit(tx, id);
    await recordAudit(tx, ctx, { action: 'unit.delete', entity: 'unit', entityId: id, before: unit });
  });
}

// ------------------------------------------------------------------ categories
export const listCategories = (pool: Pool) => repo.listCategories(pool);

async function checkCategory(db: Pool, input: CategoryInput, id?: string): Promise<void> {
  if (await repo.categoryNameTaken(db, input.name, id))
    throw new AppError('DUPLICATE', `Kategori ${input.name} sudah ada.`, 409);
  if (input.parentId) {
    if (input.parentId === id)
      throw new AppError('INVALID_PARENT', 'Kategori tidak bisa menjadi induk dirinya sendiri.', 422);
    if (!(await repo.getCategory(db, input.parentId))) throw notFoundError('Kategori induk');
  }
}

export async function createCategory(pool: Pool, input: CategoryInput): Promise<Category> {
  await checkCategory(pool, input);
  const id = await repo.insertCategory(pool, input);
  return (await repo.getCategory(pool, id))!;
}

export async function updateCategory(pool: Pool, id: string, input: CategoryInput): Promise<Category> {
  await checkCategory(pool, input, id);
  if (!(await repo.updateCategory(pool, id, input))) throw notFoundError('Kategori');
  return (await repo.getCategory(pool, id))!;
}

export async function deleteCategory(pool: Pool, ctx: RequestCtx, id: string): Promise<void> {
  await withTransaction(pool, async (tx) => {
    const cat = await repo.getCategory(tx, id);
    if (!cat) throw notFoundError('Kategori');
    if (cat.productCount > 0)
      throw inUse(`Kategori ${cat.name} masih dipakai ${cat.productCount} barang. Pindahkan barangnya dulu.`);
    if (await repo.categoryHasChildren(tx, id)) throw inUse(`Kategori ${cat.name} masih punya sub-kategori.`);
    await repo.softDeleteCategory(tx, id);
    await recordAudit(tx, ctx, { action: 'category.delete', entity: 'category', entityId: id, before: cat });
  });
}

// ------------------------------------------------------------------ brands
export const listBrands = (pool: Pool) => repo.listBrands(pool);

export async function createBrand(pool: Pool, input: BrandInput): Promise<Brand> {
  if (await repo.brandNameTaken(pool, input.name))
    throw new AppError('DUPLICATE', `Merek ${input.name} sudah ada.`, 409);
  const id = await repo.insertBrand(pool, input);
  return (await repo.getBrand(pool, id))!;
}

export async function updateBrand(pool: Pool, id: string, input: BrandInput): Promise<Brand> {
  if (await repo.brandNameTaken(pool, input.name, id))
    throw new AppError('DUPLICATE', `Merek ${input.name} sudah ada.`, 409);
  if (!(await repo.updateBrand(pool, id, input))) throw notFoundError('Merek');
  return (await repo.getBrand(pool, id))!;
}

export async function deleteBrand(pool: Pool, ctx: RequestCtx, id: string): Promise<void> {
  await withTransaction(pool, async (tx) => {
    const brand = await repo.getBrand(tx, id);
    if (!brand) throw notFoundError('Merek');
    if (brand.productCount > 0) throw inUse(`Merek ${brand.name} masih dipakai ${brand.productCount} barang.`);
    await repo.softDeleteBrand(tx, id);
    await recordAudit(tx, ctx, { action: 'brand.delete', entity: 'brand', entityId: id, before: brand });
  });
}

// ------------------------------------------------------------------ warehouses
export const listWarehouses = (pool: Pool) => repo.listWarehouses(pool);

export async function createWarehouse(pool: Pool, input: WarehouseInput): Promise<Warehouse> {
  return withTransaction(pool, async (tx) => {
    if (input.isDefault) await repo.clearDefaultWarehouse(tx, null);
    const id = await uniqueOr(
      repo.insertWarehouse(tx, { ...input, isActive: input.isDefault || input.isActive }),
      `Kode gudang ${input.code} sudah ada.`,
    );
    return (await repo.getWarehouse(tx, id))!;
  });
}

export async function updateWarehouse(pool: Pool, id: string, input: WarehouseInput): Promise<Warehouse> {
  return withTransaction(pool, async (tx) => {
    const current = await repo.getWarehouse(tx, id);
    if (!current) throw notFoundError('Gudang');
    if (current.isDefault && !input.isDefault) {
      throw new AppError(
        'DEFAULT_REQUIRED',
        'Harus ada satu gudang utama. Jadikan gudang lain sebagai utama dulu.',
        422,
      );
    }
    if (input.isDefault && !input.isActive)
      throw new AppError('DEFAULT_REQUIRED', 'Gudang utama tidak bisa dinonaktifkan.', 422);
    if (input.isDefault) await repo.clearDefaultWarehouse(tx, id);
    await uniqueOr(repo.updateWarehouse(tx, id, input), `Kode gudang ${input.code} sudah ada.`);
    return (await repo.getWarehouse(tx, id))!;
  });
}

export async function deleteWarehouse(pool: Pool, ctx: RequestCtx, id: string): Promise<void> {
  await withTransaction(pool, async (tx) => {
    const wh = await repo.getWarehouse(tx, id);
    if (!wh) throw notFoundError('Gudang');
    if (wh.isDefault) throw inUse('Gudang utama tidak bisa dihapus.');
    // Sprint 4: also refuse while stock_balances for this warehouse is not zero.
    await repo.softDeleteWarehouse(tx, id);
    await recordAudit(tx, ctx, { action: 'warehouse.delete', entity: 'warehouse', entityId: id, before: wh });
  });
}

// ------------------------------------------------------------------ customer groups
export const listCustomerGroups = (pool: Pool) => repo.listCustomerGroups(pool);

const isUmum = (code: string) => code.toUpperCase() === 'UMUM';

export async function createCustomerGroup(pool: Pool, input: CustomerGroupInput): Promise<CustomerGroup> {
  const id = await uniqueOr(repo.insertCustomerGroup(pool, input), `Kode grup ${input.code} sudah ada.`);
  return (await repo.getCustomerGroup(pool, id))!;
}

export async function updateCustomerGroup(pool: Pool, id: string, input: CustomerGroupInput): Promise<CustomerGroup> {
  const current = await repo.getCustomerGroup(pool, id);
  if (!current) throw notFoundError('Grup pelanggan');
  if (isUmum(current.code) && !isUmum(input.code))
    throw new AppError('BUILT_IN', 'Kode grup UMUM bawaan tidak bisa diubah.', 422);
  await uniqueOr(repo.updateCustomerGroup(pool, id, input), `Kode grup ${input.code} sudah ada.`);
  return (await repo.getCustomerGroup(pool, id))!;
}

export async function deleteCustomerGroup(pool: Pool, ctx: RequestCtx, id: string): Promise<void> {
  await withTransaction(pool, async (tx) => {
    const group = await repo.getCustomerGroup(tx, id);
    if (!group) throw notFoundError('Grup pelanggan');
    if (isUmum(group.code)) throw new AppError('BUILT_IN', 'Grup UMUM bawaan tidak bisa dihapus.', 422);
    if (group.customerCount > 0) throw inUse(`Grup ${group.name} masih dipakai ${group.customerCount} pelanggan.`);
    if (await repo.groupHasPrices(tx, id)) throw inUse(`Grup ${group.name} masih punya harga khusus di data barang.`);
    await repo.softDeleteCustomerGroup(tx, id);
    await recordAudit(tx, ctx, {
      action: 'customer_group.delete',
      entity: 'customer_group',
      entityId: id,
      before: group,
    });
  });
}
