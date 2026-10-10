import {
  listPurchasesResponseSchema,
  orderSuggestionsResponseSchema,
  purchaseResponseSchema,
  type CreatePurchaseRequest,
  type ListPurchasesQuery,
  type OrderSuggestion,
  type Purchase,
} from '@panesypan/shared';
import { useQuery } from '@tanstack/react-query';
import { apiJson } from '@/lib/api-client';
import { listSuppliers, suppliersKeys } from '../suppliers/suppliers.api';

export const purchaseKeys = {
  all: ['purchases'] as const,
  list: (query: ListPurchasesQuery) => ['purchases', 'list', query] as const,
  suggestions: ['purchases', 'suggestions'] as const,
};

export async function listPurchases(
  query: ListPurchasesQuery,
  signal?: AbortSignal,
): Promise<{ items: Purchase[]; total: number }> {
  const params = new URLSearchParams({ from: query.from, to: query.to });
  if (query.supplierId !== undefined) params.set('supplierId', query.supplierId);
  return apiJson(`/api/v1/purchases?${params.toString()}`, listPurchasesResponseSchema, {
    signal,
  });
}

export async function createPurchase(input: CreatePurchaseRequest): Promise<Purchase> {
  const { purchase } = await apiJson('/api/v1/purchases', purchaseResponseSchema, {
    method: 'POST',
    body: input,
  });
  return purchase;
}

/** Sube la foto de la factura de una compra (ya reducida en el navegador). */
export async function uploadPurchaseReceipt(id: string, image: Blob): Promise<Purchase> {
  const { purchase } = await apiJson(`/api/v1/purchases/${id}/receipt`, purchaseResponseSchema, {
    method: 'POST',
    rawBody: image,
  });
  return purchase;
}

export async function getOrderSuggestions(signal?: AbortSignal): Promise<OrderSuggestion[]> {
  const { groups } = await apiJson(
    '/api/v1/purchases/order-suggestions',
    orderSuggestionsResponseSchema,
    { signal },
  );
  return groups;
}

/** Proveedores activos, para elegirlos en una compra o en el producto. */
export function useSuppliers(enabled = true) {
  return useQuery({
    queryKey: suppliersKeys.list({ status: 'active' }),
    queryFn: ({ signal }) => listSuppliers({ status: 'active' }, signal),
    staleTime: 5 * 60_000,
    enabled,
  });
}
