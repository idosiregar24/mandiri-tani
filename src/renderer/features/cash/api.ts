// Cash book (sprint-10 S10-7): balances per account, the ledger, manual cash in/out, transfers, and
// the Owner's expense categories.
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  CashAccountBalance,
  CashCategory,
  CashCategoryInput,
  CashEntryInput,
  CashTransaction,
  CashTransferInput,
} from '@shared/schemas/cash';
import { apiGet, apiGetPage, apiPost, apiPut, toQuery } from '@/lib/api-client';
import { reportKeys } from '@/features/reports/api';

export const cashKeys = {
  all: ['cash'] as const,
  balances: ['cash', 'balances'] as const,
  list: (p: object) => ['cash', 'list', p] as const,
  categories: ['cash', 'categories'] as const,
};

export function useCashBalances() {
  return useQuery({ queryKey: cashKeys.balances, queryFn: () => apiGet<CashAccountBalance[]>('/cash/balances') });
}

export function useCashTransactions(p: { accountId?: string; from?: string; to?: string; page: number }) {
  return useQuery({
    queryKey: cashKeys.list(p),
    queryFn: () => apiGetPage<CashTransaction>(`/cash-transactions${toQuery({ ...p, pageSize: 30 })}`),
    placeholderData: keepPreviousData,
  });
}

export function useCashCategories() {
  return useQuery({ queryKey: cashKeys.categories, queryFn: () => apiGet<CashCategory[]>('/cash-categories') });
}

function useInvalidateCash() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: cashKeys.all });
    void qc.invalidateQueries({ queryKey: reportKeys.all });
  };
}

export function useAddCashEntry() {
  const done = useInvalidateCash();
  return useMutation({
    mutationFn: (input: CashEntryInput) => apiPost<CashTransaction>('/cash-transactions', input),
    onSuccess: done,
  });
}

export function useCashTransfer() {
  const done = useInvalidateCash();
  return useMutation({
    mutationFn: (input: CashTransferInput) => apiPost<CashTransaction>('/cash-transfers', input),
    onSuccess: done,
  });
}

export function useSaveCashCategory() {
  const done = useInvalidateCash();
  return useMutation({
    mutationFn: ({ id, ...input }: CashCategoryInput & { id?: string }) =>
      id ? apiPut<CashCategory>(`/cash-categories/${id}`, input) : apiPost<CashCategory>('/cash-categories', input),
    onSuccess: done,
  });
}
