import {
  listPurchasesResponseSchema,
  listSupplierReturnsResponseSchema,
  supplierReturnResponseSchema,
  type CreateSupplierReturnRequest,
  type SupplierReturn,
  type VoidPurchaseRequest,
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
  returns: (query: ListPurchasesQuery) => ['purchases', 'returns', query] as const,
};

const rangeParams = (query: ListPurchasesQuery): string => {
  const params = new URLSearchParams({ from: query.from, to: query.to });
  if (query.supplierId !== undefined) params.set('supplierId', query.supplierId);
  return params.toString();
};

export async function listPurchases(
  query: ListPurchasesQuery,
  signal?: AbortSignal,
): Promise<{ items: Purchase[]; total: number }> {
  return apiJson(`/api/v1/purchases?${rangeParams(query)}`, listPurchasesResponseSchema, {
    signal,
  });
}

export async function voidPurchase(id: string, input: VoidPurchaseRequest): Promise<Purchase> {
  const { purchase } = await apiJson(
    `/api/v1/purchases/${encodeURIComponent(id)}/void`,
    purchaseResponseSchema,
    { method: 'POST', body: input },
  );
  return purchase;
}

export async function listSupplierReturns(
  query: ListPurchasesQuery,
  signal?: AbortSignal,
): Promise<{ items: SupplierReturn[]; total: number }> {
  return apiJson(
    `/api/v1/supplier-returns?${rangeParams(query)}`,
    listSupplierReturnsResponseSchema,
    { signal },
  );
}

export async function createSupplierReturn(
  input: CreateSupplierReturnRequest,
): Promise<SupplierReturn> {
  const { supplierReturn } = await apiJson(
    '/api/v1/supplier-returns',
    supplierReturnResponseSchema,
    {
      method: 'POST',
      body: input,
    },
  );
  return supplierReturn;
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
