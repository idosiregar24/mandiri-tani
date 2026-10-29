import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { Customer } from '@shared/schemas/master';
import type { PosLookupResult, PosProduct } from '@shared/schemas/pos';
import { apiGet, apiGetPage, toQuery } from '@/lib/api-client';

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
