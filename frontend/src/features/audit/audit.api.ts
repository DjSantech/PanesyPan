import { auditLogPageSchema, type AuditAction, type AuditLogPage } from '@panesypan/shared';
import { apiJson } from '@/lib/api-client';

export interface AuditFilters {
  action?: AuditAction | undefined;
  from?: string | undefined;
  to?: string | undefined;
}

export const auditKeys = {
  list: (filters: AuditFilters) => ['audit-logs', filters] as const,
};

export function listAuditLogs(
  filters: AuditFilters,
  cursor: string | null,
  signal?: AbortSignal,
): Promise<AuditLogPage> {
  const params = new URLSearchParams({ limit: '30' });
  if (filters.action !== undefined) params.set('action', filters.action);
  if (filters.from !== undefined && filters.from !== '') params.set('from', filters.from);
  if (filters.to !== undefined && filters.to !== '') params.set('to', filters.to);
  if (cursor !== null) params.set('cursor', cursor);
  return apiJson(`/api/v1/audit-logs?${params.toString()}`, auditLogPageSchema, { signal });
}
