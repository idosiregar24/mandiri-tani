// Customers and suppliers share one shape on screen: a searchable, paged list + a short form.
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Customer, CustomerInput, Supplier, SupplierInput } from '@shared/schemas/master';
import { apiDelete, apiGetPage, apiPost, apiPut, toQuery } from '@/lib/api-client';
import { masterKeys } from '@/features/masters/api';

export interface PartnerListParams {
  q?: string;
  groupId?: string;
  includeInactive?: boolean;
  page: number;
}

type Kind = 'customers' | 'suppliers';
interface Types {
  customers: { row: Customer; input: CustomerInput };
  suppliers: { row: Supplier; input: SupplierInput };
}

export const partnerKeys = {
  all: (kind: Kind) => [kind] as const,
  list: (kind: Kind, p: PartnerListParams) => [kind, 'list', p] as const,
};

export function usePartners<K extends Kind>(kind: K, params: PartnerListParams) {
  return useQuery({
    queryKey: partnerKeys.list(kind, params),
    queryFn: () => apiGetPage<Types[K]['row']>(`/${kind}${toQuery({ pageSize: 50, ...params })}`),
    placeholderData: keepPreviousData,
  });
}

export function useSavePartner<K extends Kind>(kind: K) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id?: string; input: Types[K]['input'] }) =>
      id ? apiPut<Types[K]['row']>(`/${kind}/${id}`, input) : apiPost<Types[K]['row']>(`/${kind}`, input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: partnerKeys.all(kind) });
      // Customer counts per group.
      void qc.invalidateQueries({ queryKey: masterKeys.all });
    },
  });
}

export function useRemovePartner(kind: Kind) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiDelete(`/${kind}/${id}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: partnerKeys.all(kind) });
      void qc.invalidateQueries({ queryKey: masterKeys.all });
    },
  });
}
