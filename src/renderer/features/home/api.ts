import { useQuery } from '@tanstack/react-query';
import { apiGet, apiGetPage } from '@/lib/api-client';

export interface Health {
  version: string;
  server_time: string;
  db: { ok: boolean; version?: string; latency_ms?: number; error?: string };
}

export function useHealth() {
  return useQuery({ queryKey: ['health'], queryFn: () => apiGet<Health>('/health'), refetchInterval: 10_000 });
}

export interface MasterTotals {
  products: number;
  customers: number;
  suppliers: number;
}

/** Totals for the sidebar badges and the home cards — one-row pages, so only `meta.total` travels. */
export function useMasterTotals() {
  return useQuery({
    // Under 'masters' so every product/customer/supplier save (which invalidates masterKeys.all) refreshes it.
    queryKey: ['masters', 'totals'],
    staleTime: 30_000,
    queryFn: async (): Promise<MasterTotals> => {
      const [p, c, s] = await Promise.all(
        ['/products', '/customers', '/suppliers'].map((path) => apiGetPage<unknown>(`${path}?pageSize=1`)),
      );
      return { products: p!.meta.total, customers: c!.meta.total, suppliers: s!.meta.total };
    },
  });
}
