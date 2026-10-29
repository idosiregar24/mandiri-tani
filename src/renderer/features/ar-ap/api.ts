// Receivables (piutang) & payables (hutang): due list/aging, open notes, payments BP/BH, opening balances.
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AgingRow,
  AgingTotals,
  DueFilter,
  OpenDoc,
  OpeningPayableInput,
  OpeningReceivableInput,
  PartyPayment,
  PaymentListItem,
} from '@shared/schemas/ar-ap';
import { apiGet, apiGetPage, apiPost, toQuery } from '@/lib/api-client';

export type Side = 'AR' | 'AP';

/** Paths and words per side — the screens are the same for customers and suppliers. */
export const SIDE = {
  AR: {
    docs: '/receivables',
    payments: '/receivable-payments',
    partyParam: 'customerId',
    party: 'Pelanggan',
    open: 'Piutang',
    pay: 'Terima pembayaran',
  },
  AP: {
    docs: '/payables',
    payments: '/payable-payments',
    partyParam: 'supplierId',
    party: 'Supplier',
    open: 'Hutang',
    pay: 'Bayar hutang',
  },
} as const;

export const arApKeys = {
  all: (side: Side) => ['ar-ap', side] as const,
  aging: (side: Side, p: object) => ['ar-ap', side, 'aging', p] as const,
  docs: (side: Side, partyId: string) => ['ar-ap', side, 'docs', partyId] as const,
  payments: (side: Side, partyId: string) => ['ar-ap', side, 'payments', partyId] as const,
};

export interface AgingResponse {
  data: AgingRow[];
  meta: { total: number; page: number; pageSize: number; totals: AgingTotals };
}

export function useAging(side: Side, params: { q?: string; due: DueFilter; page: number }) {
  return useQuery({
    queryKey: arApKeys.aging(side, params),
    // meta also carries the totals (aging buckets, badge counts).
    queryFn: async () => (await apiGetPage<AgingRow>(`${SIDE[side].docs}/summary${toQuery(params)}`)) as AgingResponse,
    placeholderData: keepPreviousData,
  });
}

export function useOpenDocs(side: Side, partyId: string | null) {
  return useQuery({
    queryKey: arApKeys.docs(side, partyId ?? ''),
    queryFn: () => apiGet<OpenDoc[]>(`${SIDE[side].docs}${toQuery({ [SIDE[side].partyParam]: partyId })}`),
    enabled: !!partyId,
  });
}

export function usePartyPayments(side: Side, partyId: string) {
  return useQuery({
    queryKey: arApKeys.payments(side, partyId),
    queryFn: () => apiGet<PaymentListItem[]>(`${SIDE[side].payments}${toQuery({ [SIDE[side].partyParam]: partyId })}`),
  });
}

export const fetchPayment = (side: Side, id: string) => apiGet<PartyPayment>(`${SIDE[side].payments}/${id}`);

export interface PayInput {
  partyId: string;
  paymentMethodId: string;
  amount: string;
  allocations: { documentId: string; amount: string }[] | null;
  reference: string | null;
  note: string | null;
}

export function usePay(side: Side) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ input: { partyId, ...rest }, key }: { input: PayInput; key: string }) =>
      apiPost<PartyPayment>(
        SIDE[side].payments,
        { [SIDE[side].partyParam]: partyId, ...rest },
        // Only receivable payments are idempotent: payable_payments has no client_op_id (sprint-9 S9-3).
        side === 'AR' ? { headers: { 'Idempotency-Key': key } } : undefined,
      ),
    onSuccess: () => void qc.invalidateQueries({ queryKey: arApKeys.all(side) }),
  });
}

export function useAddOpening(side: Side) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: OpeningReceivableInput | OpeningPayableInput) =>
      apiPost<OpenDoc>(`${SIDE[side].docs}/opening`, input),
    onSuccess: () => void qc.invalidateQueries({ queryKey: arApKeys.all(side) }),
  });
}
