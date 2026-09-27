import {
  listWebOrdersResponseSchema,
  saleSchema,
  type CancelWebOrderRequest,
  type Sale,
  type WebOrderCheckoutRequest,
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

const checkoutResponseSchema = webOrderResponseSchema.extend({ sale: saleSchema });

/** Cobra el pedido en la caja abierta de quien cobra; el domicilio no entra a la venta. */
export async function checkoutWebOrder(
  id: string,
  input: WebOrderCheckoutRequest,
): Promise<{ order: WebOrder; sale: Sale }> {
  return apiJson(`/api/v1/web-orders/${id}/checkout`, checkoutResponseSchema, {
    method: 'POST',
    body: input,
  });
}

export async function cancelWebOrder(id: string, input: CancelWebOrderRequest): Promise<WebOrder> {
  const { order } = await apiJson(`/api/v1/web-orders/${id}/cancel`, webOrderResponseSchema, {
    method: 'POST',
    body: input,
  });
  return order;
}
