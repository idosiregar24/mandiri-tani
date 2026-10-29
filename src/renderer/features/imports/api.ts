import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  CommitIposArApInput,
  CommitIposInput,
  ImportBatch,
  IposArApInspectResult,
  IposInspectResult,
  IposStockInspectResult,
  ResetPreparationInput,
  ResetResult,
} from '@shared/schemas/imports';
import { apiGet, apiPost } from '@/lib/api-client';

export const importKeys = {
  batches: ['imports', 'batches'] as const,
};

export function useImportBatches(enabled = true) {
  return useQuery({ queryKey: importKeys.batches, queryFn: () => apiGet<ImportBatch[]>('/imports/batches'), enabled });
}

export function useInspectIpos() {
  return useMutation({ mutationFn: () => apiPost<IposInspectResult>('/imports/ipos/inspect', {}) });
}

/** Every master list changes after an import or a reset — refetch all of them. */
function useRefreshAll() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries();
}

export function useCommitIpos() {
  const refresh = useRefreshAll();
  return useMutation({
    mutationFn: (input: CommitIposInput) => apiPost<ImportBatch>('/imports/ipos/commit', input),
    onSuccess: () => void refresh(),
  });
}

export function useResetPreparation() {
  const refresh = useRefreshAll();
  return useMutation({
    mutationFn: (input: ResetPreparationInput) => apiPost<ResetResult>('/imports/reset', input),
    onSuccess: () => void refresh(),
  });
}

export function useInspectStock() {
  return useMutation({ mutationFn: () => apiPost<IposStockInspectResult>('/imports/ipos/stock/inspect', {}) });
}

export function useCommitStock() {
  const refresh = useRefreshAll();
  return useMutation({
    mutationFn: (input: CommitIposInput) => apiPost<ImportBatch>('/imports/ipos/stock/commit', input),
    onSuccess: () => void refresh(),
  });
}

export function useInspectArAp() {
  return useMutation({
    mutationFn: () => apiPost<IposArApInspectResult>('/imports/ipos/receivables/inspect', {}),
  });
}

export function useCommitArAp() {
  const refresh = useRefreshAll();
  return useMutation({
    mutationFn: (input: CommitIposArApInput) => apiPost<ImportBatch>('/imports/ipos/receivables/commit', input),
    onSuccess: () => void refresh(),
  });
}
