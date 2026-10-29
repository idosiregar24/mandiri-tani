import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { Customer, PaymentMethod } from '@shared/schemas/master';
import type { PosLookupResult, PosProduct } from '@shared/schemas/pos';
import type { OutstandingLine } from '@shared/schemas/pickups';
import type {
  CompleteSaleInput,
  HeldSaleItem,
  HoldSaleInput,
  LastPrice,
  RecalledSale,
  Sale,
  SaleListItem,
} from '@shared/schemas/sales';
import type { PosSettings, StoreSettings } from '@shared/schemas/settings';
import { apiGet, apiGetPage, apiPost, toQuery } from '@/lib/api-client';

export const posKeys = {
  search: (q: string) => ['pos', 'products', q] as const,
  customers: (q: string) => ['pos', 'customers', q] as const,
};

/** Search as the cashier types (S5-2). Stale results stay visible while the next ones load. */
export function usePosSearch(q: string) {
  return useQuery({
    queryKey: posKeys.search(q),
    queryFn: ({ signal }) => apiGet<PosProduct[]>(`/pos/products${toQuery({ q })}`, { signal }),
    enabled: q.trim().length > 0,
    placeholderData: keepPreviousData,
    staleTime: 10_000,
  });
}

/** Exact barcode / SKU → product + unit; null when nothing matches. */
export async function lookupCode(code: string): Promise<PosLookupResult | null> {
  try {
    return await apiGet<PosLookupResult>(`/pos/lookup${toQuery({ code })}`);
  } catch (err) {
    if (err && typeof err === 'object' && 'code' in err && err.code === 'PRODUCT_NOT_FOUND') return null;
    throw err;
  }
}

export function useCustomerSearch(q: string, enabled: boolean) {
  return useQuery({
    queryKey: posKeys.customers(q),
    queryFn: ({ signal }) => apiGetPage<Customer>(`/customers${toQuery({ q, pageSize: 20 })}`, { signal }),
    enabled,
    placeholderData: keepPreviousData,
  });
}

// ------------------------------------------------------------------ Sprint 6: pay, print, history

export interface ReceiptSettings {
  store: StoreSettings;
  pos: PosSettings;
}

export function useReceiptSettings() {
  return useQuery({
    queryKey: ['pos', 'receipt-settings'],
    queryFn: () => apiGet<ReceiptSettings>('/settings/receipt'),
    staleTime: 5 * 60_000,
  });
}

export function usePaymentMethods() {
  return useQuery({
    queryKey: ['pos', 'payment-methods'],
    queryFn: () => apiGet<PaymentMethod[]>('/payment-methods'),
    select: (rows) => rows.filter((m) => m.isActive && m.kind !== 'CREDIT').sort((a, b) => a.sortOrder - b.sortOrder),
    staleTime: 5 * 60_000,
  });
}

/** POST /sales with the Idempotency-Key of this checkout and, after an Owner PIN, the grant. */
export function completeSale(input: CompleteSaleInput, opts: { idempotencyKey: string; grant?: string }) {
  const headers: Record<string, string> = { 'Idempotency-Key': opts.idempotencyKey };
  if (opts.grant) headers['X-Authorization-Grant'] = opts.grant;
  return apiPost<Sale>('/sales', input, { headers });
}

export function voidSale(id: string, reason: string, grant?: string) {
  return apiPost<Sale>(
    `/sales/${id}/void`,
    { reason },
    grant ? { headers: { 'X-Authorization-Grant': grant } } : undefined,
  );
}

export function fetchSale(id: string) {
  return apiGet<Sale>(`/sales/${id}`);
}

export function useTodaySales(enabled: boolean, q: string, allDates = false) {
  return useQuery({
    queryKey: ['pos', 'sales', allDates ? 'all' : 'today', q],
    queryFn: () =>
      apiGetPage<SaleListItem>(`/sales${toQuery({ date: allDates ? undefined : todayJakarta(), q, pageSize: 50 })}`),
    enabled,
    placeholderData: keepPreviousData,
  });
}

/** YYYY-MM-DD in Asia/Jakarta (today, or of the given instant). */
export function todayJakarta(at: string | Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date(at));
}

// ------------------------------------------------------------------ Sprint 7: held notes, last prices, pickups

export const holdSale = (input: HoldSaleInput) => apiPost<HeldSaleItem>('/sales/held', input);
export const recallSale = (id: string) => apiPost<RecalledSale>(`/sales/held/${id}/recall`, undefined);

export function useHeldSales(enabled: boolean) {
  return useQuery({ queryKey: ['pos', 'held'], queryFn: () => apiGet<HeldSaleItem[]>('/sales/held'), enabled });
}

export function useLastPrices(customerId: string | null, productUnitId: string) {
  return useQuery({
    queryKey: ['pos', 'last-prices', customerId, productUnitId],
    queryFn: () => apiGet<LastPrice[]>(`/pos/last-prices${toQuery({ customerId, productUnitId })}`),
    enabled: customerId !== null,
  });
}

export function useOutstanding(params: { customerId?: string | null; q?: string }) {
  const enabled = Boolean(params.customerId || params.q);
  return useQuery({
    queryKey: ['pickups', 'outstanding', params.customerId ?? null, params.q ?? ''],
    queryFn: () =>
      apiGet<OutstandingLine[]>(
        `/pickups/outstanding${toQuery({ customerId: params.customerId ?? undefined, q: params.q })}`,
      ),
    enabled,
  });
}
