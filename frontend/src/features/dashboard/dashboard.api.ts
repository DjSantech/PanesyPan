import {
  dashboardSummarySchema,
  type DashboardSummary,
  type ExportKind,
  type ExportQuery,
} from '@panesypan/shared';
import { apiDownload, apiJson } from '@/lib/api-client';

export const dashboardKeys = {
  summary: ['dashboard', 'summary'] as const,
};

export function getDashboard(signal?: AbortSignal): Promise<DashboardSummary> {
  return apiJson('/api/v1/reports/dashboard', dashboardSummarySchema, { signal });
}

/** Pide un archivo a la API y lo guarda con el navegador. */
export async function downloadFile(path: string, filename: string): Promise<void> {
  const blob = await apiDownload(path);
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

/** Pide el CSV a la API y lo guarda con el navegador. */
export function downloadReport(kind: ExportKind, { from, to }: ExportQuery): Promise<void> {
  return downloadFile(
    `/api/v1/reports/export/${kind}?from=${from}&to=${to}`,
    `panesypan-${kind}-${from}_${to}.csv`,
  );
}
