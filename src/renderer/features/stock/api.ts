import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  Adjustment,
  AdjustmentInput,
  ConsistencyProblem,
  CostLayer,
  Opname,
  OpnameCountInput,
  StockCard,
  StockRow,
  StockSummary,
} from '@shared/schemas/stock';
import { apiGet, apiGetPage, apiPost, apiPut, apiDelete, toQuery, type Page } from '@/lib/api-client';

export interface StockListParams {
  q?: string;
  categoryId?: string;
  filter: 'all' | 'low' | 'minus';
  page: number;
}

export const stockKeys = {
  all: ['stock'] as const,
  list: (p: StockListParams) => ['stock', 'list', p] as const,
  card: (id: string, from?: string, to?: string) => ['stock', 'card', id, from, to] as const,
  layers: (id: string) => ['stock', 'layers', id] as const,
  adjustments: (page: number) => ['stock', 'adjustments', page] as const,
  adjustment: (id: string) => ['stock', 'adjustment', id] as const,
  opnames: (page: number) => ['stock', 'opnames', page] as const,
  opname: (id: string) => ['stock', 'opname', id] as const,
  consistency: ['stock', 'consistency'] as const,
};

export type StockPage = Page<StockRow> & { meta: Page<StockRow>['meta'] & { summary: StockSummary } };

export function useStock(params: StockListParams) {
  return useQuery({
    queryKey: stockKeys.list(params),
    queryFn: () => apiGetPage<StockRow>(`/stock${toQuery({ pageSize: 50, ...params })}`) as Promise<StockPage>,
    placeholderData: keepPreviousData,
  });
}

export function useStockCard(productId: string, from?: string, to?: string) {
  return useQuery({
    queryKey: stockKeys.card(productId, from, to),
    queryFn: () => apiGet<StockCard>(`/stock/${productId}/card${toQuery({ from, to })}`),
  });
}

export function useCostLayers(productId: string, enabled: boolean) {
  return useQuery({
    queryKey: stockKeys.layers(productId),
    queryFn: () => apiGet<CostLayer[]>(`/stock/${productId}/layers`),
    enabled,
  });
}

export function useConsistency(enabled: boolean) {
  return useQuery({
    queryKey: stockKeys.consistency,
    queryFn: () => apiGet<ConsistencyProblem[]>('/stock/consistency'),
    enabled,
    staleTime: 60_000,
  });
}

export function useAdjustments(page: number) {
  return useQuery({
    queryKey: stockKeys.adjustments(page),
    queryFn: () => apiGetPage<Adjustment>(`/stock/adjustments${toQuery({ page, pageSize: 50 })}`),
    placeholderData: keepPreviousData,
  });
}

export function useAdjustment(id: string | undefined) {
  return useQuery({
    queryKey: stockKeys.adjustment(id ?? ''),
    queryFn: () => apiGet<Adjustment>(`/stock/adjustments/${id}`),
    enabled: Boolean(id),
  });
}

/** Creates an adjustment. `key` is the Idempotency-Key, made ONCE per form (frontend-standards §2). */
export function useCreateAdjustment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ input, key }: { input: AdjustmentInput; key: string }) =>
      apiPost<Adjustment>('/stock/adjustments', input, { headers: { 'Idempotency-Key': key } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: stockKeys.all }),
  });
}

export function useOpnames(page: number) {
  return useQuery({
    queryKey: stockKeys.opnames(page),
    queryFn: () => apiGetPage<Opname>(`/stock/opnames${toQuery({ page, pageSize: 50 })}`),
    placeholderData: keepPreviousData,
  });
}

export function useOpname(id: string) {
  return useQuery({ queryKey: stockKeys.opname(id), queryFn: () => apiGet<Opname>(`/stock/opnames/${id}`) });
}

function useOpnameMutation<V>(fn: (v: V) => Promise<Opname>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (o) => {
      qc.setQueryData(stockKeys.opname(o.id), o);
      void qc.invalidateQueries({ queryKey: ['stock', 'opnames'] });
      if (o.status === 'POSTED') void qc.invalidateQueries({ queryKey: stockKeys.all });
    },
  });
}

export const useCreateOpname = () =>
  useOpnameMutation((note: string | null) => apiPost<Opname>('/stock/opnames', { note }));
export const useCountOpname = (id: string) =>
  useOpnameMutation((input: OpnameCountInput) => apiPut<Opname>(`/stock/opnames/${id}/lines`, input));
export const useRemoveOpnameLine = (id: string) =>
  useOpnameMutation(async (lineId: string) => {
    await apiDelete(`/stock/opnames/${id}/lines/${lineId}`);
    return apiGet<Opname>(`/stock/opnames/${id}`);
  });
export const usePostOpname = (id: string) => useOpnameMutation(() => apiPost<Opname>(`/stock/opnames/${id}/post`, {}));
export const useCancelOpname = (id: string) =>
  useOpnameMutation(() => apiPost<Opname>(`/stock/opnames/${id}/cancel`, {}));
