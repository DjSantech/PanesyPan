import {
  listWebOrdersResponseSchema,
  webOrderResponseSchema,
  type ListWebOrdersQuery,
  type WebOrder,
  type WebOrderStatus,
} from '@panesypan/shared';
import { apiJson } from '@/lib/api-client';

export const webOrderKeys = {
  all: ['web-orders'] as const,
  list: (query: ListWebOrdersQuery) => ['web-orders', 'list', query] as const,
};

export async function listWebOrders(
  query: ListWebOrdersQuery,
  signal?: AbortSignal,
): Promise<WebOrder[]> {
  const suffix = query.status === undefined ? '' : `?status=${query.status}`;
  const { orders } = await apiJson(`/api/v1/web-orders${suffix}`, listWebOrdersResponseSchema, {
    signal,
  });
  return orders;
}

export async function updateWebOrderStatus(input: {
  id: string;
  status: WebOrderStatus;
}): Promise<WebOrder> {
  const { order } = await apiJson(`/api/v1/web-orders/${input.id}/status`, webOrderResponseSchema, {
    method: 'PATCH',
    body: { status: input.status },
  });
  return order;
}
