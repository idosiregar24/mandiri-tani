// Master data contracts (PRD §5.1, schema §2). Inputs are Zod schemas shared by the
// server (validation) and the renderer (forms); outputs are plain interfaces.
import { dec, isDecimalString } from '../money';
import { Code, Money, NonNegativeQty, OptionalText, PositiveQty, RequiredText, Uuid, z } from './common';

// ------------------------------------------------------------------ simple masters
export const UnitInput = z.object({
  code: Code('Kode satuan', 12),
  name: RequiredText('Nama satuan', 50),
});
export type UnitInput = z.infer<typeof UnitInput>;

export const CategoryInput = z.object({
  name: RequiredText('Nama kategori', 100),
  parentId: Uuid.nullish().transform((v) => v ?? null),
});
export type CategoryInput = z.infer<typeof CategoryInput>;

export const BrandInput = z.object({ name: RequiredText('Nama merek', 100) });
export type BrandInput = z.infer<typeof BrandInput>;

export const WarehouseInput = z.object({
  code: Code('Kode gudang', 10),
  name: RequiredText('Nama gudang', 100),
  isDefault: z.boolean().default(false),
  isActive: z.boolean().default(true),
});
export type WarehouseInput = z.infer<typeof WarehouseInput>;

export const CustomerGroupInput = z.object({
  code: Code('Kode grup', 20),
  name: RequiredText('Nama grup', 100),
  discountPercent: z
    .string()
    .trim()
    .refine((v) => isDecimalString(v) && dec(v).gte(0) && dec(v).lte(100), 'Diskon 0 sampai 100 persen.'),
});
export type CustomerGroupInput = z.infer<typeof CustomerGroupInput>;

export interface Unit {
  id: string;
  code: string;
  name: string;
  productCount: number;
}
export interface Category {
  id: string;
  name: string;
  parentId: string | null;
  productCount: number;
}
export interface Brand {
  id: string;
  name: string;
  productCount: number;
}
export interface Warehouse {
  id: string;
  code: string;
  name: string;
  isDefault: boolean;
  isActive: boolean;
}
export interface CustomerGroup {
  id: string;
  code: string;
  name: string;
  discountPercent: string;
  customerCount: number;
}

// ------------------------------------------------------------------ customers & suppliers
const Phone = z
  .string()
  .trim()
  .max(30, 'Nomor HP terlalu panjang.')
  .nullish()
  .transform((v) => (v ? v.replace(/[^\d+]/g, '') || null : null));

export const CustomerInput = z.object({
  /** Empty = generated (PLxxxx). */
  code: z
    .string()
    .trim()
    .max(30, 'Kode maksimal 30 huruf.')
    .nullish()
    .transform((v) => (v ? v.toUpperCase() : null)),
  name: RequiredText('Nama pelanggan', 150),
  phone: Phone,
  address: OptionalText(500),
  village: OptionalText(100),
  customerGroupId: Uuid.nullish().transform((v) => v ?? null),
  /** null = tanpa batas (D-7); "0" = tidak boleh kredit. */
  creditLimit: Money.nullish().transform((v) => v ?? null),
  paymentTermDays: z.coerce.number().int('Termin harus bilangan bulat.').min(0).max(365).default(10),
  notes: OptionalText(1000),
  isActive: z.boolean().default(true),
});
export type CustomerInput = z.input<typeof CustomerInput>;

export interface Customer {
  id: string;
  code: string;
  name: string;
  phone: string | null;
  address: string | null;
  village: string | null;
  customerGroupId: string | null;
  customerGroupName: string | null;
  creditLimit: string | null;
  paymentTermDays: number;
  isWalkIn: boolean;
  notes: string | null;
  isActive: boolean;
  updatedAt: string;
}

export const SupplierInput = z.object({
  code: z
    .string()
    .trim()
    .max(30, 'Kode maksimal 30 huruf.')
    .nullish()
    .transform((v) => (v ? v.toUpperCase() : null)),
  name: RequiredText('Nama supplier', 150),
  contactName: OptionalText(150),
  phone: Phone,
  address: OptionalText(500),
  paymentTermDays: z.coerce.number().int().min(0).max(365).default(0),
  notes: OptionalText(1000),
  isActive: z.boolean().default(true),
});
export type SupplierInput = z.input<typeof SupplierInput>;

export interface Supplier {
  id: string;
  code: string;
  name: string;
  contactName: string | null;
  phone: string | null;
  address: string | null;
  paymentTermDays: number;
  notes: string | null;
  isActive: boolean;
  updatedAt: string;
}

// ------------------------------------------------------------------ bank accounts & payment methods (D-6)
export const BankAccountInput = z.object({
  code: Code('Kode rekening', 20),
  name: RequiredText('Nama rekening', 100),
  isActive: z.boolean().default(true),
});
export type BankAccountInput = z.infer<typeof BankAccountInput>;

export interface CashAccount {
  id: string;
  code: string;
  name: string;
  kind: 'DRAWER' | 'CASH' | 'BANK';
  isActive: boolean;
}

export const PAYMENT_KINDS = ['CASH', 'QRIS', 'TRANSFER', 'CREDIT'] as const;
export type PaymentKind = (typeof PAYMENT_KINDS)[number];

/** Owner-managed methods are TRANSFER / QRIS into a bank account; CASH & CREDIT are built in. */
export const PaymentMethodInput = z.object({
  code: Code('Kode metode', 30),
  name: RequiredText('Nama metode', 100),
  kind: z.enum(['TRANSFER', 'QRIS']),
  cashAccountId: Uuid,
  accountNumber: OptionalText(50),
  accountHolder: OptionalText(100),
  sortOrder: z.coerce.number().int().min(0).max(99).default(5),
  isActive: z.boolean().default(true),
});
export type PaymentMethodInput = z.infer<typeof PaymentMethodInput>;

export interface PaymentMethod {
  id: string;
  code: string;
  name: string;
  kind: PaymentKind;
  cashAccountId: string | null;
  cashAccountName: string | null;
  accountNumber: string | null;
  accountHolder: string | null;
  sortOrder: number;
  isActive: boolean;
  isBuiltIn: boolean;
}

// ------------------------------------------------------------------ products (FR-MD-01…04)
export const ITEM_TYPES = ['STANDARD', 'SERVICE'] as const;

export const ProductPriceInput = z.object({
  customerGroupId: Uuid.nullish().transform((v) => v ?? null),
  minQty: PositiveQty.default('1'),
  price: Money,
});
export type ProductPriceInput = z.input<typeof ProductPriceInput>;

export const ProductUnitInput = z.object({
  /** Existing product_units.id when editing; absent for a new unit. */
  id: Uuid.optional(),
  unitId: Uuid,
  conversionQty: PositiveQty,
  isBase: z.boolean(),
  isDefaultSale: z.boolean().default(false),
  isDefaultPurchase: z.boolean().default(false),
  isSellable: z.boolean().default(true),
  barcodes: z.array(z.string().trim().min(3, 'Barcode terlalu pendek.').max(64)).max(10).default([]),
  prices: z.array(ProductPriceInput).max(20).default([]),
});
export type ProductUnitInput = z.input<typeof ProductUnitInput>;

export const ProductInput = z
  .object({
    /** Empty = generated (BRGxxxxx). */
    sku: z
      .string()
      .trim()
      .max(100, 'Kode barang maksimal 100 huruf.')
      .nullish()
      .transform((v) => (v ? v.toUpperCase() : null)),
    name: RequiredText('Nama barang', 200),
    categoryId: Uuid.nullish().transform((v) => v ?? null),
    brandId: Uuid.nullish().transform((v) => v ?? null),
    itemType: z.enum(ITEM_TYPES).default('STANDARD'),
    allowDecimalQty: z.boolean().default(false),
    minStock: NonNegativeQty.default('0'),
    maxStock: NonNegativeQty.nullish().transform((v) => v ?? null),
    isActive: z.boolean().default(true),
    units: z.array(ProductUnitInput).min(1, 'Barang harus punya minimal satu satuan.').max(6, 'Maksimal 6 satuan.'),
  })
  .superRefine((p, ctx) => {
    const base = p.units.filter((u) => u.isBase);
    if (base.length !== 1) {
      ctx.addIssue({ code: 'custom', path: ['units'], message: 'Pilih tepat satu satuan dasar.' });
    }
    for (const [i, u] of p.units.entries()) {
      if (u.isBase && !dec(u.conversionQty).eq(1)) {
        ctx.addIssue({ code: 'custom', path: ['units', i, 'conversionQty'], message: 'Isi satuan dasar selalu 1.' });
      }
    }
    const seen = new Set<string>();
    for (const [i, u] of p.units.entries()) {
      if (seen.has(u.unitId))
        ctx.addIssue({
          code: 'custom',
          path: ['units', i, 'unitId'],
          message: 'Satuan ini sudah dipakai di baris lain.',
        });
      seen.add(u.unitId);
    }
    const codes = new Set<string>();
    for (const [i, u] of p.units.entries()) {
      for (const code of u.barcodes) {
        if (codes.has(code))
          ctx.addIssue({
            code: 'custom',
            path: ['units', i, 'barcodes'],
            message: `Barcode ${code} ditulis dua kali.`,
          });
        codes.add(code);
      }
    }
  });
export type ProductInput = z.input<typeof ProductInput>;
export type ProductInputParsed = z.output<typeof ProductInput>;

export interface ProductPrice {
  id: string;
  customerGroupId: string | null;
  minQty: string;
  price: string;
}

export interface ProductUnit {
  id: string;
  unitId: string;
  unitCode: string;
  unitName: string;
  conversionQty: string;
  isBase: boolean;
  isDefaultSale: boolean;
  isDefaultPurchase: boolean;
  isSellable: boolean;
  barcodes: string[];
  prices: ProductPrice[];
}

export interface Product {
  id: string;
  sku: string;
  name: string;
  categoryId: string | null;
  categoryName: string | null;
  brandId: string | null;
  brandName: string | null;
  itemType: (typeof ITEM_TYPES)[number];
  trackStock: boolean;
  allowDecimalQty: boolean;
  minStock: string;
  maxStock: string | null;
  isActive: boolean;
  units: ProductUnit[];
  updatedAt: string;
}

/** One row of the product list: base unit + the general price of each unit. */
export interface ProductListItem {
  id: string;
  sku: string;
  name: string;
  categoryName: string | null;
  baseUnitCode: string;
  isActive: boolean;
  /** e.g. [{ unitCode: 'KG', conversionQty: '1', price: '15000.00' }, { unitCode: 'ZAK', conversionQty: '50', price: '640000.00' }] */
  units: { unitCode: string; conversionQty: string; price: string | null }[];
}

export const ProductListQuery = z.object({
  q: z.string().trim().max(100).optional(),
  categoryId: Uuid.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
  includeInactive: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
});
export type ProductListQuery = z.infer<typeof ProductListQuery>;
