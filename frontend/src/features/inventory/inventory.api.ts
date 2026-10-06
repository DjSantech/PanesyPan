import {
  inventoryItemResponseSchema,
  listInventoryResponseSchema,
  listMovementsResponseSchema,
  type AdjustStockRequest,
  type InventoryItem,
  type ListInventoryResponse,
  type ListMovementsQuery,
  type RegisterProductionRequest,
  type RegisterSelfConsumptionRequest,
  type RegisterWasteRequest,
  type SetMinStockRequest,
  type StockMovement,
} from '@panesypan/shared';
import { apiJson } from '@/lib/api-client';

export const inventoryKeys = {
  all: ['inventory'] as const,
  stock: (lowStock: boolean) => ['inventory', 'stock', lowStock] as const,
  movements: (query: Partial<ListMovementsQuery>) => ['inventory', 'movements', query] as const,
};

export async function listInventory(
  lowStock: boolean,
  signal?: AbortSignal,
): Promise<ListInventoryResponse> {
  return apiJson(
    `/api/v1/inventory${lowStock ? '?lowStock=true' : ''}`,
    listInventoryResponseSchema,
    {
      signal,
    },
  );
}

export async function listMovements(
  query: Partial<ListMovementsQuery>,
  signal?: AbortSignal,
): Promise<StockMovement[]> {
  const params = new URLSearchParams();
  if (query.date !== undefined) params.set('date', query.date);
  if (query.type !== undefined) params.set('type', query.type);
  if (query.productId !== undefined) params.set('productId', query.productId);
  const suffix = params.size > 0 ? `?${params.toString()}` : '';
  const { items } = await apiJson(
    `/api/v1/inventory/movements${suffix}`,
    listMovementsResponseSchema,
    {
      signal,
    },
  );
  return items;
}

async function post(path: string, body: object): Promise<InventoryItem> {
  const { item } = await apiJson(`/api/v1/inventory${path}`, inventoryItemResponseSchema, {
    method: 'POST',
    body,
  });
  return item;
}

export const registerProduction = (input: RegisterProductionRequest) => post('/production', input);
export const registerWaste = (input: RegisterWasteRequest) => post('/waste', input);
export const registerSelfConsumption = (input: RegisterSelfConsumptionRequest) =>
  post('/self-consumption', input);
export const adjustStock = (input: AdjustStockRequest) => post('/adjustments', input);

export async function setMinStock(
  productId: string,
  input: SetMinStockRequest,
): Promise<InventoryItem> {
  const { item } = await apiJson(
    `/api/v1/inventory/${productId}/min-stock`,
    inventoryItemResponseSchema,
    { method: 'PATCH', body: input },
  );
  return item;
}
