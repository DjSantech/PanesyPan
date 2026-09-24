import {
  einvoiceStatusResponseSchema,
  electronicDocumentResponseSchema,
  listElectronicDocumentsResponseSchema,
  type EInvoiceStatusResponse,
  type ElectronicDocument,
  type ListElectronicDocumentsQuery,
} from '@panesypan/shared';
import { useQuery } from '@tanstack/react-query';
import { apiJson } from '@/lib/api-client';

export const einvoiceKeys = {
  all: ['einvoices'] as const,
  status: ['einvoices', 'status'] as const,
  list: (query: ListElectronicDocumentsQuery) => ['einvoices', 'list', query] as const,
};

export function getEInvoiceStatus(signal?: AbortSignal): Promise<EInvoiceStatusResponse> {
  return apiJson('/api/v1/einvoices/status', einvoiceStatusResponseSchema, { signal });
}

export async function listElectronicDocuments(
  query: ListElectronicDocumentsQuery,
  signal?: AbortSignal,
): Promise<ElectronicDocument[]> {
  const params = new URLSearchParams();
  if (query.status !== undefined) params.set('status', query.status);
  if (query.kind !== undefined) params.set('kind', query.kind);
  const suffix = params.size > 0 ? `?${params.toString()}` : '';
  const { items } = await apiJson(
    `/api/v1/einvoices${suffix}`,
    listElectronicDocumentsResponseSchema,
    { signal },
  );
  return items;
}

export async function retryElectronicDocument(id: string): Promise<ElectronicDocument> {
  const { document } = await apiJson(
    `/api/v1/einvoices/${id}/retry`,
    electronicDocumentResponseSchema,
    { method: 'POST' },
  );
  return document;
}

/** Proveedor, ambiente y documentos por estado (solo administrador). */
export function useEInvoiceStatus(enabled = true) {
  return useQuery({
    queryKey: einvoiceKeys.status,
    queryFn: ({ signal }) => getEInvoiceStatus(signal),
    enabled,
    staleTime: 30_000,
  });
}
