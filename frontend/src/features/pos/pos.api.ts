import {
  cashMovementResponseSchema,
  cashShiftResponseSchema,
  currentCashShiftResponseSchema,
  listCashMovementsResponseSchema,
  listSalesResponseSchema,
  saleResponseSchema,
  type CashMovement,
  type CashShift,
  type CloseCashShiftRequest,
  type CloseSaleRequest,
  type CreateCashMovementRequest,
  type CounterCheckoutRequest,
  type ListSalesQuery,
  type OpenCashShiftRequest,
  type ReturnSaleRequest,
  type Sale,
  type SaleLineInput,
  type TabCheckoutRequest,
} from '@panesypan/shared';
import { apiJson } from '@/lib/api-client';

export const posKeys = {
  all: ['pos'] as const,
  shift: ['pos', 'shift'] as const,
  movements: ['pos', 'shift', 'movements'] as const,
  suggestedOpening: ['pos', 'suggested-opening'] as const,
  tabs: ['pos', 'tabs'] as const,
  sales: (query: Partial<ListSalesQuery>) => ['pos', 'sales', query] as const,
  sale: (id: string) => ['pos', 'sale', id] as const,
};

// ── Caja ───────────────────────────────────────────────────────────

export async function getCurrentShift(signal?: AbortSignal): Promise<CashShift | null> {
  const { shift } = await apiJson('/api/v1/cash-shifts/current', currentCashShiftResponseSchema, {
    signal,
  });
  return shift;
}

/** Base que dejó el último cierre en el cajón (null si no se indicó). */
export async function getSuggestedOpening(signal?: AbortSignal): Promise<number | null> {
  const { suggestedOpeningAmount } = await apiJson(
    '/api/v1/cash-shifts/current',
    currentCashShiftResponseSchema,
    { signal },
  );
  return suggestedOpeningAmount;
}

export async function openShift(input: OpenCashShiftRequest): Promise<CashShift> {
  const { shift } = await apiJson('/api/v1/cash-shifts', cashShiftResponseSchema, {
    method: 'POST',
    body: input,
  });
  return shift;
}

export async function listMovements(signal?: AbortSignal): Promise<CashMovement[]> {
  const { items } = await apiJson(
    '/api/v1/cash-shifts/current/movements',
    listCashMovementsResponseSchema,
    { signal },
  );
  return items;
}

export async function createMovement(input: CreateCashMovementRequest): Promise<CashMovement> {
  const { movement } = await apiJson(
    '/api/v1/cash-shifts/current/movements',
    cashMovementResponseSchema,
    { method: 'POST', body: input },
  );
  return movement;
}

export async function closeShift(input: CloseCashShiftRequest): Promise<CashShift> {
  const { shift } = await apiJson('/api/v1/cash-shifts/current/close', cashShiftResponseSchema, {
    method: 'POST',
    body: input,
  });
  return shift;
}

// ── Ventas ─────────────────────────────────────────────────────────

const saleRequest = async (
  path: string,
  method: 'POST' | 'PATCH' | 'DELETE',
  body?: unknown,
): Promise<Sale> => {
  const { sale } = await apiJson(path, saleResponseSchema, { method, body });
  return sale;
};

export function checkoutCounter(input: CounterCheckoutRequest): Promise<Sale> {
  return saleRequest('/api/v1/sales/checkout', 'POST', input);
}

export async function listSales(
  query: Partial<ListSalesQuery>,
  signal?: AbortSignal,
): Promise<Sale[]> {
  const params = new URLSearchParams();
  if (query.date !== undefined) params.set('date', query.date);
  if (query.shiftId !== undefined) params.set('shiftId', query.shiftId);
  if (query.status !== undefined) params.set('status', query.status);
  if (query.from !== undefined) params.set('from', query.from);
  if (query.to !== undefined) params.set('to', query.to);
  if (query.method !== undefined) params.set('method', query.method);
  if (query.number !== undefined) params.set('number', query.number);
  const suffix = params.size > 0 ? `?${params.toString()}` : '';
  const { items } = await apiJson(`/api/v1/sales${suffix}`, listSalesResponseSchema, { signal });
  return items;
}

export async function getSale(id: string, signal?: AbortSignal): Promise<Sale> {
  const { sale } = await apiJson(`/api/v1/sales/${id}`, saleResponseSchema, { signal });
  return sale;
}

export function returnSale(id: string, input: ReturnSaleRequest): Promise<Sale> {
  return saleRequest(`/api/v1/sales/${id}/returns`, 'POST', input);
}

export function voidSale(id: string, input: CloseSaleRequest): Promise<Sale> {
  return saleRequest(`/api/v1/sales/${id}/void`, 'POST', input);
}

// ── Mesas ──────────────────────────────────────────────────────────

export async function listOpenTabs(signal?: AbortSignal): Promise<Sale[]> {
  const { items } = await apiJson('/api/v1/tabs', listSalesResponseSchema, { signal });
  return items;
}

export function openTab(tableNumber: number): Promise<Sale> {
  return saleRequest('/api/v1/tabs', 'POST', { tableNumber });
}

export function moveTab(id: string, tableNumber: number): Promise<Sale> {
  return saleRequest(`/api/v1/tabs/${id}`, 'PATCH', { tableNumber });
}

export function addTabLine(id: string, input: SaleLineInput): Promise<Sale> {
  return saleRequest(`/api/v1/tabs/${id}/lines`, 'POST', input);
}

export function updateTabLine(id: string, lineId: string, quantity: number): Promise<Sale> {
  return saleRequest(`/api/v1/tabs/${id}/lines/${lineId}`, 'PATCH', { quantity });
}

export function removeTabLine(id: string, lineId: string): Promise<Sale> {
  return saleRequest(`/api/v1/tabs/${id}/lines/${lineId}`, 'DELETE');
}

export function checkoutTab(id: string, input: TabCheckoutRequest): Promise<Sale> {
  return saleRequest(`/api/v1/tabs/${id}/checkout`, 'POST', input);
}

export function cancelTab(id: string, input: CloseSaleRequest): Promise<Sale> {
  return saleRequest(`/api/v1/tabs/${id}/cancel`, 'POST', input);
}
