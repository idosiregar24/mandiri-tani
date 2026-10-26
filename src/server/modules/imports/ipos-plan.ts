// iPOS → Mandiri Tani master data, as a PURE function (no database): the same plan feeds the
// preview (inspect) and the import (commit), and is unit-tested on synthetic rows.
// Mapping rules: Analisis-Sumber-Data-iPOS.md §4 and sprint-3 decisions S3-5…S3-8.
import { dec, toMoney, toQty } from '@shared/money';
import type { DataIssue, IposMasterCounts } from '@shared/schemas/imports';
import { uuidv7 } from '@shared/uuid';
import type { IposMasterRows, UnitUsage } from './ipos-source';

/** What already exists in the app (seeded by migration 0002) and is reused, not duplicated. */
export interface ExistingMasters {
  units: { id: string; code: string }[];
  umumGroupId: string;
  walkInCustomerId: string;
  defaultWarehouseId: string;
}

export interface LegacyRef {
  entity: string;
  legacyKey: string;
  entityId: string;
}

export interface PlannedProductUnit {
  id: string;
  unitId: string;
  unitCode: string;
  conversionQty: string;
  isBase: boolean;
  isDefaultSale: boolean;
  isDefaultPurchase: boolean;
  barcode: string | null;
  price: string | null;
}

export interface MasterPlan {
  units: { id: string; code: string; name: string }[];
  categories: { id: string; name: string }[];
  groups: { id: string; code: string; name: string; discountPercent: string }[];
  /** Discount of the built-in UMUM group, taken from iPOS "General". */
  umumDiscountPercent: string | null;
  customers: {
    id: string;
    code: string;
    name: string;
    phone: string | null;
    address: string | null;
    customerGroupId: string;
    creditLimit: string | null;
    paymentTermDays: number;
    notes: string | null;
    isActive: boolean;
  }[];
  suppliers: {
    id: string;
    code: string;
    name: string;
    contactName: string | null;
    phone: string | null;
    address: string | null;
    paymentTermDays: number;
    notes: string | null;
    isActive: boolean;
  }[];
  bankAccounts: { id: string; code: string; name: string }[];
  paymentMethods: { id: string; code: string; name: string; cashAccountId: string; sortOrder: number }[];
  products: {
    id: string;
    sku: string;
    name: string;
    categoryId: string | null;
    baseUnitId: string;
    minStock: string;
    isActive: boolean;
    units: PlannedProductUnit[];
  }[];
  legacyRefs: LegacyRef[];
  /** Counted straight from the iPOS rows — the "iPOS" side of the reconciliation (FR-MIG-04). */
  sourceCounts: IposMasterCounts;
  /** iPOS customers per group (kgrup → count), mapped to the new group code. */
  sourceCustomersPerGroup: Record<string, number>;
  issues: DataIssue[];
}

// ------------------------------------------------------------------ small helpers
const clean = (v: string | null | undefined): string => (v ?? '').replace(/\s+/g, ' ').trim();
const orNull = (v: string | null | undefined): string | null => clean(v) || null;
const upper = (v: string | null | undefined) => clean(v).toUpperCase();
const titleCase = (v: string) =>
  v.toLowerCase().replace(/(^|[\s/-])(\p{L})/gu, (_m, sep: string, ch: string) => sep + ch.toUpperCase());
// iPOS mixes numeric(18,3) and unbounded numeric columns ("60000.00000000000000000000"), so any
// plain decimal is accepted here; rounding to 2/4 places happens only where a value is stored.
const num = (v: string | null | undefined): string => (v && /^-?\d+(\.\d+)?$/.test(v.trim()) ? v.trim() : '0');
const positive = (v: string | null | undefined) => dec(num(v)).gt(0);
const inactive = (flag: string | null) => ['T', 'N', '0'].includes(upper(flag));

/** iPOS item categories with friendlier names (Analisis §4). */
const CATEGORY_NAMES: Record<string, string> = {
  RACUN: 'Pestisida',
  ALT: 'Alat Pertanian',
  PUPUK: 'Pupuk',
  BIBIT: 'Bibit',
};

class Issues {
  private readonly map = new Map<string, DataIssue>();
  add(code: string, title: string, action: string, example?: string): void {
    let issue = this.map.get(code);
    if (!issue) this.map.set(code, (issue = { code, title, action, count: 0, examples: [] }));
    issue.count++;
    if (example && issue.examples.length < 10) issue.examples.push(example);
  }
  list(): DataIssue[] {
    return [...this.map.values()];
  }
}

function sequence(prefix: string, existing: string[]) {
  const re = new RegExp(`^${prefix}(\\d{1,9})$`);
  let n = existing.reduce((max, code) => Math.max(max, Number(re.exec(code)?.[1] ?? 0)), 0);
  return () => `${prefix}${String(++n).padStart(4, '0')}`;
}

function mostUsed(usage: UnitUsage[]): Map<string, string[]> {
  const byItem = new Map<string, { satuan: string; n: number }[]>();
  for (const u of usage) {
    const key = clean(u.kodeitem);
    if (!byItem.has(key)) byItem.set(key, []);
    byItem.get(key)!.push({ satuan: upper(u.satuan), n: u.n });
  }
  const out = new Map<string, string[]>();
  for (const [item, list] of byItem)
    out.set(
      item,
      list.sort((a, b) => b.n - a.n || a.satuan.localeCompare(b.satuan)).map((x) => x.satuan),
    );
  return out;
}

// ------------------------------------------------------------------ the plan
export function planMasterImport(src: IposMasterRows, existing: ExistingMasters): MasterPlan {
  const issues = new Issues();
  const legacyRefs: LegacyRef[] = [];
  const ref = (entity: string, legacyKey: string, entityId: string) => legacyRefs.push({ entity, legacyKey, entityId });

  // ---- units: reuse the seeded iPOS codes, add the ones the app does not know yet
  const unitId = new Map(existing.units.map((u) => [u.code.toUpperCase(), u.id]));
  const units: MasterPlan['units'] = [];
  const ensureUnit = (code: string, name?: string | null) => {
    let id = unitId.get(code);
    if (!id) {
      id = uuidv7();
      unitId.set(code, id);
      units.push({ id, code, name: titleCase(clean(name) || code) });
    }
    return id;
  };
  for (const u of src.units) {
    const code = upper(u.satuan);
    if (!code) continue;
    ref('unit', code, ensureUnit(code, u.ketsatuan));
  }

  // ---- categories
  const categories: MasterPlan['categories'] = [];
  const categoryId = new Map<string, string>();
  const ensureCategory = (code: string, label?: string | null) => {
    let id = categoryId.get(code);
    if (!id) {
      id = uuidv7();
      categoryId.set(code, id);
      categories.push({ id, name: CATEGORY_NAMES[code] ?? titleCase(clean(label) || code) });
      ref('category', code, id);
    }
    return id;
  };
  for (const j of src.jenis) if (upper(j.jenis)) ensureCategory(upper(j.jenis), j.ketjenis);

  // ---- customer groups (General → built-in UMUM)
  const groups: MasterPlan['groups'] = [];
  const groupId = new Map<string, string>();
  let umumDiscountPercent: string | null = null;
  for (const g of src.groups) {
    const key = upper(g.kgrup);
    if (!key) continue;
    const discount = toMoney(dec(num(g.potongan)).clamp(0, 100));
    if (key === 'GENERAL' || key === 'UMUM') {
      groupId.set(key, existing.umumGroupId);
      umumDiscountPercent = discount;
      ref('customer_group', clean(g.kgrup), existing.umumGroupId);
      continue;
    }
    const code = key.replace(/\s+/g, '_').slice(0, 20);
    const id = uuidv7();
    groupId.set(key, id);
    groups.push({ id, code, name: clean(g.grup) || clean(g.kgrup), discountPercent: discount });
    ref('customer_group', clean(g.kgrup), id);
  }

  // ---- customers & suppliers
  const pl = src.partners.filter((p) => p.tipe === 'PL');
  const su = src.partners.filter((p) => p.tipe === 'SU');
  const term = src.defaultTermDays ?? 10;
  const phone = (v: string | null) =>
    clean(v)
      .replace(/[^\d+]/g, '')
      .slice(0, 30) || null;
  const address = (a: string | null, k: string | null) => [clean(a), clean(k)].filter(Boolean).join(', ') || null;

  const nextPl = sequence(
    'PL',
    pl.map((p) => upper(p.kode)),
  );
  const usedPl = new Set<string>();
  const customers: MasterPlan['customers'] = [];
  for (const p of pl) {
    const legacy = clean(p.kode);
    if (upper(p.kode) === 'UMUM') {
      ref('customer', legacy, existing.walkInCustomerId);
      continue;
    }
    let code = upper(p.kode);
    if (!/^PL\d{1,9}$/.test(code) || usedPl.has(code)) {
      code = nextPl();
      issues.add(
        'DQ-5',
        'Kode pelanggan bukan format PLxxxx',
        'Dibuat kode baru berurutan; kode lama disimpan sebagai jejak impor.',
        `${legacy} → ${code}`,
      );
    }
    usedPl.add(code);
    const g = upper(p.kgrup);
    const gid = groupId.get(g) ?? existing.umumGroupId;
    if (g && !groupId.has(g))
      issues.add(
        'GROUP_UNKNOWN',
        'Pelanggan dengan grup yang tidak ada',
        'Dimasukkan ke grup UMUM.',
        `${code} (${clean(p.kgrup)})`,
      );
    const id = uuidv7();
    customers.push({
      id,
      code,
      name: clean(p.nama) || code,
      phone: phone(p.telepon),
      address: address(p.alamat, p.kota),
      customerGroupId: gid,
      creditLimit: positive(p.limitjmlhupi) ? toMoney(num(p.limitjmlhupi)) : null,
      paymentTermDays: p.harijt && p.harijt > 0 ? p.harijt : term,
      notes: orNull(p.keterangan),
      isActive: !inactive(p.stsaktif),
    });
    ref('customer', legacy, id);
  }
  const byName = new Map<string, string[]>();
  for (const c of customers) {
    const k = c.name.toUpperCase();
    byName.set(k, [...(byName.get(k) ?? []), c.code]);
  }
  for (const [, codes] of byName) {
    if (codes.length > 1) {
      const c = customers.find((x) => x.code === codes[0])!;
      issues.add(
        'DQ-4',
        'Nama pelanggan kembar',
        'Diimpor semua; periksa dan gabungkan bila orangnya sama.',
        `${c.name} (${codes.join(', ')})`,
      );
    }
  }

  const nextSp = sequence(
    'SP',
    su.map((p) => upper(p.kode)),
  );
  const usedSp = new Set<string>();
  const suppliers: MasterPlan['suppliers'] = [];
  for (const p of su) {
    const legacy = clean(p.kode);
    let code = upper(p.kode);
    if (!/^SP\d{1,9}$/.test(code) || usedSp.has(code)) {
      code = nextSp();
      issues.add(
        'DQ-5S',
        'Kode supplier bukan format SPxxxx',
        'Dibuat kode baru berurutan; kode lama disimpan sebagai jejak impor.',
        `${legacy} → ${code}`,
      );
    }
    usedSp.add(code);
    const id = uuidv7();
    suppliers.push({
      id,
      code,
      name: clean(p.nama) || code,
      contactName: orNull(p.kontak),
      phone: phone(p.telepon),
      address: address(p.alamat, p.kota),
      paymentTermDays: p.harijt && p.harijt > 0 ? p.harijt : 0,
      notes: orNull(p.keterangan),
      isActive: !inactive(p.stsaktif),
    });
    ref('supplier', legacy, id);
  }

  // ---- banks → bank account + "Transfer <bank>" method (D-6)
  const bankAccounts: MasterPlan['bankAccounts'] = [];
  const paymentMethods: MasterPlan['paymentMethods'] = [];
  for (const [i, b] of src.banks.entries()) {
    const key = upper(b.kodebank).replace(/[^A-Z0-9]+/g, '_');
    if (!key) continue;
    const accountId = uuidv7();
    const label = key.length <= 4 ? key : titleCase(key.replace(/_/g, ' '));
    bankAccounts.push({ id: accountId, code: `BANK_${key}`, name: clean(b.namabank) || label });
    ref('cash_account', clean(b.kodebank), accountId);
    const methodId = uuidv7();
    paymentMethods.push({
      id: methodId,
      code: `TRANSFER_${key}`,
      name: `Transfer ${label}`,
      cashAccountId: accountId,
      sortOrder: 2 + i,
    });
    ref('payment_method', clean(b.kodebank), methodId);
  }

  // ---- office UTM → the default warehouse (only UTM is used — Analisis §2)
  if (src.offices.some((o) => upper(o.kodekantor) === 'UTM')) ref('warehouse', 'UTM', existing.defaultWarehouseId);
  else
    issues.add(
      'NO_UTM',
      'Kantor UTM tidak ada di iPOS',
      'Gudang Utama dipakai apa adanya; periksa kode gudang di Data Lain.',
    );

  // ---- products
  const unitsByItem = new Map<string, typeof src.itemUnits>();
  for (const u of src.itemUnits) {
    const k = clean(u.kodeitem);
    unitsByItem.set(k, [...(unitsByItem.get(k) ?? []), u]);
  }
  const pricesByItem = new Map<string, typeof src.itemPrices>();
  for (const p of src.itemPrices) {
    const k = clean(p.kodeitem);
    pricesByItem.set(k, [...(pricesByItem.get(k) ?? []), p]);
  }
  const saleUse = mostUsed(src.saleUnitUsage);
  const buyUse = mostUsed(src.purchaseUnitUsage);
  const barcodes = new Set<string>();
  const products: MasterPlan['products'] = [];
  let derivedUnits = 0;

  for (const item of src.items) {
    const sku = clean(item.kodeitem);
    if (!sku) continue;
    const name = clean(item.namaitem) || sku;
    const jenis = upper(item.jenis);
    const baseCode = upper(item.satuan) || 'PCS';
    if (!upper(item.satuan))
      issues.add('NO_UNIT', 'Barang tanpa satuan', 'Satuan dasar diisi PCS; periksa di layar Barang.', name);

    const rows = unitsByItem.get(sku) ?? [];
    const planned: PlannedProductUnit[] = [
      {
        id: uuidv7(),
        unitId: ensureUnit(baseCode),
        unitCode: baseCode,
        conversionQty: '1',
        isBase: true,
        isDefaultSale: false,
        isDefaultPurchase: false,
        barcode: null,
        price: null,
      },
    ];
    const baseRow = rows.find((r) => upper(r.tipe) === 'D' && upper(r.satuan) === baseCode);
    for (const r of rows) {
      const code = upper(r.satuan);
      if (upper(r.tipe) === 'D') continue;
      derivedUnits++;
      if (code === baseCode || planned.some((p) => p.unitCode === code)) {
        issues.add(
          'UNIT_DUPLICATE',
          'Satuan turunan sama dengan satuan lain',
          'Baris satuan ini dilewati.',
          `${name} (${code})`,
        );
        continue;
      }
      if (!positive(r.jumlahkonv)) {
        issues.add(
          'UNIT_CONVERSION',
          'Konversi satuan 0 atau kosong',
          'Satuan ini dilewati; tambahkan manual bila perlu.',
          `${name} (${code})`,
        );
        continue;
      }
      if (dec(num(r.jumlahkonv)).eq(1)) {
        issues.add(
          'UNIT_CONV_1',
          'Satuan turunan dengan isi 1',
          'Diimpor apa adanya; periksa apakah isinya benar.',
          `${name}: 1 ${code} = 1 ${baseCode}`,
        );
      }
      planned.push({
        id: uuidv7(),
        unitId: ensureUnit(code),
        unitCode: code,
        conversionQty: toQty(num(r.jumlahkonv)),
        isBase: false,
        isDefaultSale: false,
        isDefaultPurchase: false,
        barcode: null,
        price: null,
      });
    }
    // Barcodes (none are filled at the store today, D-3) — globally unique, first one wins.
    for (const r of [...(baseRow ? [baseRow] : []), ...rows.filter((x) => x !== baseRow)]) {
      const code = clean(r.kodebarcode);
      const target = planned.find((p) => p.unitCode === upper(r.satuan));
      if (!code || !target || target.barcode) continue;
      if (barcodes.has(code)) {
        issues.add(
          'BARCODE_DUPLICATE',
          'Barcode dipakai lebih dari satu barang',
          'Barcode hanya dipasang di barang pertama.',
          `${code} (${name})`,
        );
        continue;
      }
      barcodes.add(code);
      target.barcode = code;
    }

    // Prices (S3-5): type S → per unit from tbl_itemhj (level 0/1, no quantity tier); else hargajual1 on the base unit.
    if (upper(item.sistemhargajual) === 'S') {
      const candidates = (pricesByItem.get(sku) ?? [])
        .filter((p) => (p.level ?? 0) <= 1 && dec(num(p.jmlsampai)).eq(0) && positive(p.hargajual))
        .sort((a, b) => (a.level ?? 0) - (b.level ?? 0));
      for (const p of candidates) {
        const target = planned.find((u) => u.unitCode === upper(p.satuan));
        if (target && target.price === null) target.price = toMoney(num(p.hargajual));
      }
    } else if (positive(item.hargajual1)) {
      planned[0]!.price = toMoney(num(item.hargajual1));
    }
    const priced = planned.filter((u) => u.price !== null).length;
    if (priced === 0)
      issues.add('DQ-2', 'Barang tanpa harga jual', 'Diimpor tanpa harga; kasir mengisi harga saat menjual.', name);

    // Usual units (S3-7): most used in iPOS sales / purchases; fallback base (sale) / largest (purchase).
    const pick = (order: string[] | undefined) => {
      for (const code of order ?? []) {
        const unit = planned.find((u) => u.unitCode === code);
        if (unit) return unit;
      }
      return undefined;
    };
    const sale = pick(saleUse.get(sku)) ?? planned[0]!;
    const buy = pick(buyUse.get(sku)) ?? [...planned].sort((a, b) => dec(b.conversionQty).cmp(a.conversionQty))[0]!;
    sale.isDefaultSale = true;
    buy.isDefaultPurchase = true;

    if (item.tipe !== null && clean(item.tipe) !== '1') {
      issues.add(
        'ITEM_TYPE',
        'Jenis barang iPOS tidak dikenal',
        'Diimpor sebagai barang biasa (punya stok).',
        `${name} (tipe ${clean(item.tipe)})`,
      );
    }
    if (jenis === 'PUPUK' && baseCode === 'PCS') {
      issues.add('DQ-9', 'Pupuk dengan satuan PCS', 'Diimpor apa adanya; periksa apakah seharusnya ZAK atau KG.', name);
    }
    if (dec(num(item.stokmin)).lt(0)) issues.add('MIN_STOCK', 'Stok minimum minus', 'Diisi 0.', name);

    const id = uuidv7();
    products.push({
      id,
      sku,
      name,
      categoryId: jenis ? ensureCategory(jenis) : null,
      baseUnitId: planned[0]!.unitId,
      minStock: toQty(dec(num(item.stokmin)).lt(0) ? '0' : num(item.stokmin)),
      isActive: !inactive(item.statusjual) && !['1', 'Y'].includes(upper(item.statushapus)),
      units: planned,
    });
    ref('product', sku, id);
    for (const u of planned) ref('product_unit', `${sku}|${u.unitCode}`, u.id);
  }

  const sourceCustomersPerGroup: Record<string, number> = {};
  for (const p of pl) {
    if (upper(p.kode) === 'UMUM') continue;
    const k = upper(p.kgrup);
    const code = k === 'GENERAL' || k === 'UMUM' || !groupId.has(k) ? 'UMUM' : k.replace(/\s+/g, '_').slice(0, 20);
    sourceCustomersPerGroup[code] = (sourceCustomersPerGroup[code] ?? 0) + 1;
  }

  return {
    units,
    categories,
    groups,
    umumDiscountPercent,
    customers,
    suppliers,
    bankAccounts,
    paymentMethods,
    products,
    legacyRefs,
    sourceCounts: {
      units: src.units.length,
      categories: src.jenis.length,
      customerGroups: src.groups.length,
      customers: pl.length,
      suppliers: su.length,
      bankAccounts: src.banks.length,
      products: src.items.length,
      multiUnitProducts: new Set(src.itemUnits.filter((u) => upper(u.tipe) !== 'D').map((u) => clean(u.kodeitem))).size,
      derivedUnits,
      pricedUnits: src.pricedUnitsInSource,
    },
    sourceCustomersPerGroup,
    issues: issues.list(),
  };
}
