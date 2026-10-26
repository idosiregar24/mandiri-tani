// Small masters: units, categories, brands, warehouses, customer groups, bank accounts and
// payment methods (Sprint 3 C1/C3). Short lists → no paging; every mutation refreshes its list.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  Brand,
  CashAccount,
  Category,
  CustomerGroup,
  PaymentMethod,
  Unit,
  Warehouse,
} from '@shared/schemas/master';
import { apiDelete, apiGet, apiPost, apiPut } from '@/lib/api-client';

export const MASTER_RESOURCES = {
  units: '/units',
  categories: '/categories',
  brands: '/brands',
  warehouses: '/warehouses',
  customerGroups: '/customer-groups',
  cashAccounts: '/cash-accounts',
  paymentMethods: '/payment-methods',
} as const;
export type MasterResource = keyof typeof MASTER_RESOURCES;

interface MasterTypes {
  units: Unit;
  categories: Category;
  brands: Brand;
  warehouses: Warehouse;
  customerGroups: CustomerGroup;
  cashAccounts: CashAccount;
  paymentMethods: PaymentMethod;
}

export const masterKeys = {
  all: ['masters'] as const,
  list: (r: MasterResource) => ['masters', r] as const,
};

export function useMasterList<R extends MasterResource>(resource: R) {
  return useQuery({
    queryKey: masterKeys.list(resource),
    queryFn: () => apiGet<MasterTypes[R][]>(MASTER_RESOURCES[resource]),
    staleTime: 30_000,
  });
}

export const useUnits = () => useMasterList('units');
export const useCategories = () => useMasterList('categories');
export const useBrands = () => useMasterList('brands');
export const useCustomerGroups = () => useMasterList('customerGroups');

/** Create (no id) or update (with id) one master row. */
export function useSaveMaster<R extends MasterResource>(resource: R) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id?: string; input: unknown }) =>
      id
        ? apiPut<MasterTypes[R]>(`${MASTER_RESOURCES[resource]}/${id}`, input)
        : apiPost<MasterTypes[R]>(MASTER_RESOURCES[resource], input),
    onSuccess: () => qc.invalidateQueries({ queryKey: masterKeys.all }),
  });
}

export function useRemoveMaster(resource: MasterResource) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiDelete(`${MASTER_RESOURCES[resource]}/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: masterKeys.all }),
  });
}
