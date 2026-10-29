// The cashier's active cart (sprint-5 C3, S5-3). Client state only — never persisted; held notes
// go to the server (Sprint 7). Prices come from resolvePrice(), the same function the server uses.
import { create } from 'zustand';
import { dec, toQty } from '@shared/money';
import { discountForTarget, lineTotal, subtotal as sumLines } from '@shared/pos';
import { resolvePrice, type PriceSource } from '@shared/pricing';
import type { PosProduct, PosUnit } from '@shared/schemas/pos';

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
  addProduct: (product: PosProduct, unitId?: string, qty?: string) => string;
  setQty: (key: string, qty: string) => void;
  changeUnit: (key: string, unitId: string) => void;
  setPrice: (key: string, price: string) => void;
  removeLine: (key: string) => void;
  select: (key: string | null) => void;
  moveSelection: (delta: 1 | -1) => void;
  setCustomer: (c: CartCustomer | null) => void;
  setTotalTarget: (target: string | null) => void;
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

  clear: () => set({ lines: [], selectedKey: null, customer: null, totalTarget: null, flashKey: null }),
}));

// ------------------------------------------------------------------ derived values

export const lineAmount = (l: CartLine): string | null => (l.unitPrice === '' ? null : lineTotal(l));

export function cartTotals(lines: readonly CartLine[], totalTarget: string | null) {
  const priced = lines.filter((l) => l.unitPrice !== '');
  const sub = sumLines(priced);
  const discount = totalTarget === null ? '0.00' : (discountForTarget(sub, totalTarget) ?? '0.00');
  return {
    subtotal: sub,
    discount,
    total: dec(sub).minus(discount).toFixed(2),
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
