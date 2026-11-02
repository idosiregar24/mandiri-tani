// Reports (sprint-10): one generic query hook — every report is a GET with plain query params — plus
// the Excel download of the same URL with ?format=xlsx.
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { DashboardReport } from '@shared/schemas/reports';
import { apiDownload, apiGet, toQuery } from '@/lib/api-client';

export type ReportParams = Record<string, string | number | undefined>;

export const reportKeys = {
  all: ['reports'] as const,
  one: (path: string, params: ReportParams) => ['reports', path, params] as const,
};

export function useReport<T>(path: string, params: ReportParams, enabled = true) {
  return useQuery({
    queryKey: reportKeys.one(path, params),
    queryFn: () => apiGet<T>(`${path}${toQuery(params)}`),
    placeholderData: keepPreviousData,
    enabled,
  });
}

export function useDashboard() {
  return useQuery({
    queryKey: reportKeys.one('/reports/dashboard', {}),
    queryFn: () => apiGet<DashboardReport>('/reports/dashboard'),
    refetchInterval: 60_000,
  });
}

export function downloadReportXlsx(path: string, params: ReportParams, fileName: string): Promise<void> {
  return apiDownload(`${path}${toQuery({ ...params, format: 'xlsx' })}`, `${fileName}.xlsx`);
}
