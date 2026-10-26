import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  CommitIposInput,
  ImportBatch,
  IposInspectResult,
  ResetPreparationInput,
  ResetResult,
} from '@shared/schemas/imports';
import { apiGet, apiPost } from '@/lib/api-client';

export const importKeys = {
  batches: ['imports', 'batches'] as const,
};

export function useImportBatches() {
  return useQuery({ queryKey: importKeys.batches, queryFn: () => apiGet<ImportBatch[]>('/imports/batches') });
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
