// The product form edits a friendlier shape than the API payload: the first unit row is
// always the base unit, each unit has one "general price" box, and the rarer prices (per
// customer group / minimum qty) sit in "Detail lain". Validation is still the ONE shared
// schema (ProductInput) — issues on the payload are mapped back onto form fields.
import { ProductInput, type Product, type ProductInput as ProductPayload } from '@shared/schemas/master';

export interface PriceRow {
  customerGroupId: string | null;
  minQty: string;
  price: string;
}

export interface UnitRow {
  id?: string;
  unitId: string;
  conversionQty: string;
  isDefaultSale: boolean;
  isDefaultPurchase: boolean;
  isSellable: boolean;
  /** Barcodes separated by commas or spaces. */
  barcodes: string;
  /** General price (all customers, from qty 1); "" = no price. */
  price: string;
  /** Group prices and quantity tiers. */
  extra: PriceRow[];
}

export interface ProductFormValues {
  sku: string;
  name: string;
  categoryId: string | null;
  brandId: string | null;
  isService: boolean;
  allowDecimalQty: boolean;
  minStock: string;
  maxStock: string | null;
  isActive: boolean;
  units: UnitRow[];
}

const isGeneral = (p: { customerGroupId: string | null; minQty: string }) =>
  p.customerGroupId === null && Number(p.minQty) === 1;

export function emptyUnit(unitId = ''): UnitRow {
  return {
    unitId,
    conversionQty: '',
    isDefaultSale: false,
    isDefaultPurchase: false,
    isSellable: true,
    barcodes: '',
    price: '',
    extra: [],
  };
}

export function newProductValues(baseUnitId: string): ProductFormValues {
  return {
    sku: '',
    name: '',
    categoryId: null,
    brandId: null,
    isService: false,
    allowDecimalQty: false,
    minStock: '0',
    maxStock: null,
    isActive: true,
    units: [{ ...emptyUnit(baseUnitId), conversionQty: '1', isDefaultSale: true, isDefaultPurchase: true }],
  };
}

export function fromProduct(p: Product): ProductFormValues {
  const units = [...p.units].sort((a, b) => Number(b.isBase) - Number(a.isBase));
  return {
    sku: p.sku,
    name: p.name,
    categoryId: p.categoryId,
    brandId: p.brandId,
    isService: p.itemType === 'SERVICE',
    allowDecimalQty: p.allowDecimalQty,
    minStock: p.minStock,
    maxStock: p.maxStock,
    isActive: p.isActive,
    units: units.map((u) => {
      const general = u.prices.find(isGeneral);
      return {
        id: u.id,
        unitId: u.unitId,
        conversionQty: u.conversionQty,
        isDefaultSale: u.isDefaultSale,
        isDefaultPurchase: u.isDefaultPurchase,
        isSellable: u.isSellable,
        barcodes: u.barcodes.join(', '),
        price: general ? general.price.replace(/\.00$/, '') : '',
        extra: u.prices
          .filter((x) => !isGeneral(x))
          .map((x) => ({ customerGroupId: x.customerGroupId, minQty: x.minQty, price: x.price.replace(/\.00$/, '') })),
      };
    }),
  };
}

export function splitBarcodes(text: string): string[] {
  return [
    ...new Set(
      text
        .split(/[\s,;]+/)
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  ];
}

export function toPayload(v: ProductFormValues): ProductPayload {
  return {
    sku: v.sku.trim() || null,
    name: v.name,
    categoryId: v.categoryId,
    brandId: v.brandId,
    itemType: v.isService ? 'SERVICE' : 'STANDARD',
    allowDecimalQty: v.allowDecimalQty,
    minStock: v.minStock || '0',
    maxStock: v.maxStock,
    isActive: v.isActive,
    units: v.units.map((u, i) => ({
      ...(u.id ? { id: u.id } : {}),
      unitId: u.unitId,
      conversionQty: i === 0 ? '1' : u.conversionQty,
      isBase: i === 0,
      isDefaultSale: u.isDefaultSale,
      isDefaultPurchase: u.isDefaultPurchase,
      isSellable: u.isSellable,
      barcodes: splitBarcodes(u.barcodes),
      prices: [...(u.price ? [{ customerGroupId: null, minQty: '1', price: u.price }] : []), ...u.extra],
    })),
  };
}

/** Payload issue path → form field name ("units.1.prices.0.price" → "units.1.price"). */
export function formPath(v: ProductFormValues, path: readonly PropertyKey[]): string {
  const p = path.map(String);
  if (p[0] !== 'units' || p.length < 2) return p.length ? p.join('.') : 'root';
  const i = Number(p[1]);
  if (p[2] === 'prices' && p.length >= 4) {
    const j = Number(p[3]);
    const offset = v.units[i]?.price ? 1 : 0;
    if (offset && j === 0) return `units.${i}.price`;
    return `units.${i}.extra.${j - offset}.${p[4] ?? 'price'}`;
  }
  if (p[2] === 'barcodes') return `units.${i}.barcodes`;
  return p.join('.');
}

export interface FieldIssue {
  field: string;
  message: string;
}

/** Validates with the shared schema; [] = ok. Issues that belong to no field go to "root". */
export function validate(v: ProductFormValues): FieldIssue[] {
  const r = ProductInput.safeParse(toPayload(v));
  if (r.success) return [];
  const seen = new Set<string>();
  const out: FieldIssue[] = [];
  for (const issue of r.error.issues) {
    let field = formPath(v, issue.path);
    if (field === 'units') field = 'root';
    if (seen.has(field)) continue;
    seen.add(field);
    out.push({ field, message: issue.message });
  }
  return out;
}

/** Server 400 fieldErrors ("units.0.prices.0.price") → form fields. */
export function serverIssues(v: ProductFormValues, fieldErrors: Record<string, string>): FieldIssue[] {
  return Object.entries(fieldErrors).map(([key, message]) => {
    const field = formPath(v, key.split('.'));
    return { field: field === 'units' ? 'root' : field, message };
  });
}
