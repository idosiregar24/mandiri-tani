import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  PriceHistoryRow,
  Purchase,
  PurchaseInput,
  PurchaseListItem,
  PurchaseReturnInput,
  SaleReturnInput,
  SaleReturnResult,
} from '@shared/schemas/purchases';
import { apiGet, apiGetPage, apiPost, toQuery } from '@/lib/api-client';

export const purchaseKeys = {
  all: ['purchases'] as const,
  list: (p: { q?: string; page: number }) => ['purchases', 'list', p] as const,
  detail: (id: string) => ['purchases', 'detail', id] as const,
};

export function usePurchases(params: { q?: string; page: number }) {
  return useQuery({
    queryKey: purchaseKeys.list(params),
    queryFn: () => apiGetPage<PurchaseListItem>(`/purchases${toQuery({ ...params, pageSize: 30 })}`),
    placeholderData: keepPreviousData,
  });
}

export function usePurchase(id: string) {
  return useQuery({ queryKey: purchaseKeys.detail(id), queryFn: () => apiGet<Purchase>(`/purchases/${id}`) });
}

export const priceHistory = (productId: string) =>
  apiGet<PriceHistoryRow[]>(`/purchases/price-history${toQuery({ productId })}`);

export function useCreatePurchase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ input, key }: { input: PurchaseInput; key: string }) =>
      apiPost<Purchase>('/purchases', input, { headers: { 'Idempotency-Key': key } }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: purchaseKeys.all }),
  });
}

export function useCreatePurchaseReturn(invoiceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ input, key }: { input: PurchaseReturnInput; key: string }) =>
      apiPost<Purchase>(`/purchases/${invoiceId}/returns`, input, { headers: { 'Idempotency-Key': key } }),
    onSuccess: (p) => {
      qc.setQueryData(purchaseKeys.detail(invoiceId), p);
      void qc.invalidateQueries({ queryKey: purchaseKeys.all });
    },
  });
}

/** POST /sales/:id/returns — 423 → Owner PIN → retry with the grant. */
export function createSaleReturn(saleId: string, input: SaleReturnInput, key: string, grant?: string) {
  const headers: Record<string, string> = { 'Idempotency-Key': key };
  if (grant) headers['X-Authorization-Grant'] = grant;
  return apiPost<SaleReturnResult>(`/sales/${saleId}/returns`, input, { headers });
}
