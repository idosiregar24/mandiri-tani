import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  DeviceItem,
  NetworkInfo,
  PairingCodeInput,
  PairingCodeResult,
} from '@shared/schemas/devices';
import { apiGet, apiPost } from '@/lib/api-client';

export const deviceKeys = {
  all: ['devices'] as const,
  list: () => ['devices', 'list'] as const,
  network: () => ['devices', 'network'] as const,
};

export function useDevices() {
  return useQuery({
    queryKey: deviceKeys.list(),
    queryFn: () => apiGet<DeviceItem[]>('/devices'),
    refetchInterval: 10_000, // auto-refresh status every 10s
  });
}

export function useNetworkInfo() {
  return useQuery({
    queryKey: deviceKeys.network(),
    queryFn: () => apiGet<NetworkInfo>('/devices/network-info'),
  });
}

export function useCreatePairingCode() {
  return useMutation({
    mutationFn: (input: PairingCodeInput) =>
      apiPost<PairingCodeResult>('/devices/pairing-codes', input),
  });
}

export function useRevokeDevice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (deviceId: string) =>
      apiPost<{ message: string }>(`/devices/${deviceId}/revoke`, {}),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: deviceKeys.all });
    },
  });
}

