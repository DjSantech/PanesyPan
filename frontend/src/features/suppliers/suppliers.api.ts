import {
  listSuppliersResponseSchema,
  supplierResponseSchema,
  type CreateSupplierRequest,
  type ListSuppliersQuery,
  type Supplier,
  type UpdateSupplierRequest,
} from '@panesypan/shared';
import { apiJson } from '@/lib/api-client';

export const suppliersKeys = {
  all: ['suppliers'] as const,
  list: (query: Partial<ListSuppliersQuery>) => ['suppliers', 'list', query] as const,
};

export async function listSuppliers(
  query: Partial<ListSuppliersQuery>,
  signal?: AbortSignal,
): Promise<Supplier[]> {
  const params = new URLSearchParams();
  if (query.status !== undefined) params.set('status', query.status);
  if (query.search !== undefined && query.search.trim() !== '') {
    params.set('search', query.search.trim());
  }
  const suffix = params.size > 0 ? `?${params.toString()}` : '';
  const { items } = await apiJson(`/api/v1/suppliers${suffix}`, listSuppliersResponseSchema, {
    signal,
  });
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
  const { supplier } = await apiJson(`/api/v1/suppliers/${id}`, supplierResponseSchema, {
    method: 'PATCH',
    body: input,
  });
  return supplier;
}
