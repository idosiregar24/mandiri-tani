import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Product, ProductInput, ProductListItem } from '@shared/schemas/master';
import { apiDelete, apiGet, apiGetPage, apiPost, apiPut, toQuery } from '@/lib/api-client';
import { masterKeys } from '@/features/masters/api';

export interface ProductListParams {
  q?: string;
  categoryId?: string;
  includeInactive?: boolean;
  page: number;
  pageSize?: number;
}

export const productKeys = {
  all: ['products'] as const,
  list: (p: ProductListParams) => ['products', 'list', p] as const,
  detail: (id: string) => ['products', 'detail', id] as const,
};

export function useProducts(params: ProductListParams) {
  return useQuery({
    queryKey: productKeys.list(params),
    queryFn: () => apiGetPage<ProductListItem>(`/products${toQuery({ pageSize: 50, ...params })}`),
    placeholderData: keepPreviousData,
  });
}

export function useProduct(id: string | undefined) {
  return useQuery({
    queryKey: productKeys.detail(id ?? ''),
    queryFn: () => apiGet<Product>(`/products/${id}`),
    enabled: Boolean(id),
  });
}

export function useSaveProduct() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id?: string; input: ProductInput }) =>
      id ? apiPut<Product>(`/products/${id}`, input) : apiPost<Product>('/products', input),
    onSuccess: (p) => {
      qc.setQueryData(productKeys.detail(p.id), p);
      void qc.invalidateQueries({ queryKey: productKeys.all });
      // Unit / category product counts change too.
      void qc.invalidateQueries({ queryKey: masterKeys.all });
    },
  });
}

export function useRemoveProduct() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiDelete(`/products/${id}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: productKeys.all });
      void qc.invalidateQueries({ queryKey: masterKeys.all });
    },
  });
}
