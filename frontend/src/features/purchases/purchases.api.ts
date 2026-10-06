import {
  listPurchasesResponseSchema,
  listSuppliersResponseSchema,
  orderSuggestionsResponseSchema,
  purchaseResponseSchema,
  supplierResponseSchema,
  type CreatePurchaseRequest,
  type CreateSupplierRequest,
  type ListPurchasesQuery,
  type OrderSuggestion,
  type Purchase,
  type Supplier,
  type UpdateSupplierRequest,
} from '@panesypan/shared';
import { useQuery } from '@tanstack/react-query';
import { apiJson } from '@/lib/api-client';

export const purchaseKeys = {
  all: ['purchases'] as const,
  suppliers: (all: boolean) => ['purchases', 'suppliers', all] as const,
  list: (query: ListPurchasesQuery) => ['purchases', 'list', query] as const,
  suggestions: ['purchases', 'suggestions'] as const,
};

export async function listSuppliers(all: boolean, signal?: AbortSignal): Promise<Supplier[]> {
  const { items } = await apiJson(
    `/api/v1/suppliers${all ? '?all=true' : ''}`,
    listSuppliersResponseSchema,
    { signal },
  );
  return items;
}

export async function createSupplier(input: CreateSupplierRequest): Promise<Supplier> {
  const { supplier } = await apiJson('/api/v1/suppliers', supplierResponseSchema, {
    method: 'POST',
    body: input,
  });
  return supplier;
}

export async function updateSupplier(id: string, input: UpdateSupplierRequest): Promise<Supplier> {
  const { supplier } = await apiJson(
    `/api/v1/suppliers/${encodeURIComponent(id)}`,
    supplierResponseSchema,
    { method: 'PATCH', body: input },
  );
  return supplier;
}

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

export async function getOrderSuggestions(signal?: AbortSignal): Promise<OrderSuggestion[]> {
  const { groups } = await apiJson(
    '/api/v1/purchases/order-suggestions',
    orderSuggestionsResponseSchema,
    { signal },
  );
  return groups;
}

/** Proveedores (activos, o todos para administrarlos). */
export function useSuppliers(all = false, enabled = true) {
  return useQuery({
    queryKey: purchaseKeys.suppliers(all),
    queryFn: ({ signal }) => listSuppliers(all, signal),
    staleTime: 5 * 60_000,
    enabled,
  });
}
