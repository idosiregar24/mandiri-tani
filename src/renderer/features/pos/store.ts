// The cashier's active cart (sprint-5 C3, S5-3). Client state only — never persisted; held notes
// go to the server (Sprint 7). Prices come from resolvePrice(), the same function the server uses.
import { create } from 'zustand';
import { dec, toQty } from '@shared/money';
import { discountForTarget, lineTotal, subtotal as sumLines } from '@shared/pos';
import { resolvePrice, type PriceSource } from '@shared/pricing';
import type { PosProduct, PosUnit } from '@shared/schemas/pos';
import type { RecalledSale, SaleChannel } from '@shared/schemas/sales';

export interface CartLine {
  key: string;
  product: PosProduct;
  unitId: string;
  /** Decimal string in the line's unit. */
  qty: string;
  /** '' = no price known yet: the cashier must type one. */
  unitPrice: string;
  /** Resolved master price (null = none) — kept even after a manual change (D-2). */
  listPrice: string | null;
  priceSource: PriceSource | null;
}

export interface CartCustomer {
  id: string;
  name: string;
  groupId: string | null;
  groupName: string | null;
}

interface PosState {
  lines: CartLine[];
  selectedKey: string | null;
  /** null = UMUM (walk-in). */
  customer: CartCustomer | null;
  /** "Total jadi" typed by the cashier (F10); null = no note discount. */
  totalTarget: string | null;
  /** Key of the line just added or changed — briefly highlighted (design-standards §3). */
  flashKey: string | null;
  /** D-1: KASIR = quick KSR receipt; FAKTUR = JL invoice (named customer, credit, shipping). */
  channel: SaleChannel;
  /** FAKTUR only: shipping / other charges (D-4). */
  otherCharges: string;
  otherChargesNote: string | null;
  /** D-5: goods stay in the warehouse until a pickup note. */
  pickupLater: boolean;
  addProduct: (product: PosProduct, unitId?: string, qty?: string) => string;
  setQty: (key: string, qty: string) => void;
  changeUnit: (key: string, unitId: string) => void;
  setPrice: (key: string, price: string) => void;
  removeLine: (key: string) => void;
  select: (key: string | null) => void;
  moveSelection: (delta: 1 | -1) => void;
  setCustomer: (c: CartCustomer | null) => void;
  setTotalTarget: (target: string | null) => void;
  setChannel: (channel: SaleChannel) => void;
  setOtherCharges: (amount: string, note: string | null) => void;
  setPickupLater: (on: boolean) => void;
  /** F7: a held note back into the (empty) cart. */
  loadRecalled: (r: RecalledSale) => void;
  clear: () => void;
}

let seq = 0;
const newKey = () => `l${++seq}`;

export function unitOf(line: Pick<CartLine, 'product' | 'unitId'>): PosUnit {
  return line.product.units.find((u) => u.id === line.unitId) ?? line.product.units[0]!;
}

export function defaultUnit(p: PosProduct): PosUnit {
  return p.units.find((u) => u.isDefaultSale) ?? p.units.find((u) => u.isBase) ?? p.units[0]!;
}

/** Re-resolves the price unless the cashier typed one (MANUAL survives qty and customer changes). */
function priced(line: CartLine, groupId: string | null, keepManual: boolean): CartLine {
  const r = resolvePrice(unitOf(line).prices, { groupId, qty: line.qty });
  if (keepManual && line.priceSource === 'MANUAL') return { ...line, listPrice: r?.price ?? null };
  return { ...line, unitPrice: r?.price ?? '', listPrice: r?.price ?? null, priceSource: r?.source ?? null };
}

export const usePosStore = create<PosState>()((set, get) => ({
  lines: [],
  selectedKey: null,
  customer: null,
  totalTarget: null,
  flashKey: null,
  channel: 'KASIR',
  otherCharges: '0',
  otherChargesNote: null,
  pickupLater: false,

  addProduct: (product, unitId, qty = '1') => {
    const unit = unitId ?? defaultUnit(product).id;
    const groupId = get().customer?.groupId ?? null;
    const existing = get().lines.find((l) => l.product.id === product.id && l.unitId === unit);
    if (existing) {
      // Same product + unit again → more of it, never a second line (iPOS data: 0 duplicates).
      const next = priced({ ...existing, product, qty: dec(existing.qty).plus(qty).toFixed() }, groupId, true);
      set((s) => ({
        lines: s.lines.map((l) => (l.key === existing.key ? next : l)),
        selectedKey: existing.key,
        flashKey: existing.key,
      }));
      return existing.key;
    }
    const key = newKey();
    const line = priced(
      { key, product, unitId: unit, qty: dec(qty).toFixed(), unitPrice: '', listPrice: null, priceSource: null },
      groupId,
      false,
    );
    set((s) => ({ lines: [...s.lines, line], selectedKey: key, flashKey: key }));
    return key;
  },

  setQty: (key, qty) =>
    set((s) => ({
      lines: s.lines.map((l) =>
        l.key === key ? priced({ ...l, qty: dec(qty).toFixed() }, s.customer?.groupId ?? null, true) : l,
      ),
      flashKey: key,
    })),

  // A typed price was for the old unit: the new unit starts from its own resolved price.
  changeUnit: (key, unitId) =>
    set((s) => ({
      lines: s.lines.map((l) => (l.key === key ? priced({ ...l, unitId }, s.customer?.groupId ?? null, false) : l)),
      flashKey: key,
    })),

  setPrice: (key, price) =>
    set((s) => ({
      lines: s.lines.map((l) => {
        if (l.key !== key) return l;
        const same = l.listPrice !== null && dec(price).eq(l.listPrice);
        return same ? priced(l, s.customer?.groupId ?? null, false) : { ...l, unitPrice: price, priceSource: 'MANUAL' };
      }),
      flashKey: key,
    })),

  removeLine: (key) =>
    set((s) => {
      const i = s.lines.findIndex((l) => l.key === key);
      const lines = s.lines.filter((l) => l.key !== key);
      const neighbour = lines[Math.min(i, lines.length - 1)];
      return { lines, selectedKey: neighbour?.key ?? null, totalTarget: lines.length ? s.totalTarget : null };
    }),

  select: (key) => set({ selectedKey: key }),

  moveSelection: (delta) =>
    set((s) => {
      if (!s.lines.length) return {};
      const i = s.lines.findIndex((l) => l.key === s.selectedKey);
      const next = i < 0 ? (delta > 0 ? 0 : s.lines.length - 1) : Math.max(0, Math.min(s.lines.length - 1, i + delta));
      return { selectedKey: s.lines[next]!.key };
    }),

  setCustomer: (customer) =>
    set((s) => ({ customer, lines: s.lines.map((l) => priced(l, customer?.groupId ?? null, true)) })),

  setTotalTarget: (totalTarget) => set({ totalTarget }),

  setChannel: (channel) => set((s) => ({ channel, otherCharges: channel === 'KASIR' ? '0' : s.otherCharges })),
  setOtherCharges: (otherCharges, otherChargesNote) => set({ otherCharges, otherChargesNote }),
  setPickupLater: (pickupLater) => set({ pickupLater }),

  // S7-2: a typed (MANUAL) price stays; list prices are resolved again (the master may have changed).
  loadRecalled: (r) => {
    const products = new Map(r.products.map((p) => [p.id, p]));
    const groupId = r.customer.isWalkIn ? null : r.customer.groupId;
    const lines: CartLine[] = [];
    for (const l of r.lines) {
      const product = [...products.values()].find((p) => p.units.some((u) => u.id === l.productUnitId));
      if (!product) continue;
      const base: CartLine = {
        key: newKey(),
        product,
        unitId: l.productUnitId,
        qty: l.qty,
        unitPrice: l.unitPrice,
        listPrice: null,
        priceSource: 'MANUAL',
      };
      lines.push(l.priceSource === 'MANUAL' ? priced(base, groupId, true) : priced(base, groupId, false));
    }
    const sub = sumLines(lines.filter((l) => l.unitPrice !== ''));
    set({
      lines,
      selectedKey: lines.at(-1)?.key ?? null,
      flashKey: null,
      channel: r.channel,
      customer: r.customer.isWalkIn
        ? null
        : { id: r.customer.id, name: r.customer.name, groupId: r.customer.groupId, groupName: r.customer.groupName },
      totalTarget: dec(r.discountAmount).gt(0) ? dec(sub).minus(r.discountAmount).toFixed(2) : null,
      otherCharges: r.otherCharges,
      otherChargesNote: r.otherChargesNote,
      pickupLater: false,
    });
  },

  // The mode (Kasir / Faktur) stays for the next customer; everything else starts fresh.
  clear: () =>
    set({
      lines: [],
      selectedKey: null,
      customer: null,
      totalTarget: null,
      flashKey: null,
      otherCharges: '0',
      otherChargesNote: null,
      pickupLater: false,
    }),
}));

// ------------------------------------------------------------------ derived values

export const lineAmount = (l: CartLine): string | null => (l.unitPrice === '' ? null : lineTotal(l));

export function cartTotals(lines: readonly CartLine[], totalTarget: string | null, otherCharges = '0') {
  const priced = lines.filter((l) => l.unitPrice !== '');
  const sub = sumLines(priced);
  const discount = totalTarget === null ? '0.00' : (discountForTarget(sub, totalTarget) ?? '0.00');
  return {
    subtotal: sub,
    discount,
    otherCharges: dec(otherCharges).toFixed(2),
    total: dec(sub).minus(discount).plus(otherCharges).toFixed(2),
    missingPrice: lines.length - priced.length,
    itemCount: lines.length,
  };
}

/** Base units this cart takes of a product (all its lines), for the stock warning. */
export function baseQtyInCart(lines: readonly CartLine[], productId: string): string {
  return toQty(
    lines
      .filter((l) => l.product.id === productId)
      .reduce((s, l) => s.plus(dec(l.qty).times(unitOf(l).conversionQty)), dec(0)),
  );
}

/** True when the cart wants more than is available (warning only — the server decides, S6). */
export function isShort(lines: readonly CartLine[], line: CartLine): boolean {
  return line.product.trackStock && dec(baseQtyInCart(lines, line.product.id)).gt(line.product.availableQty);
}
