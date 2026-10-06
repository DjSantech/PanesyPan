import {
  cashShiftDetailSchema,
  cashShiftResponseSchema,
  listCashShiftsResponseSchema,
  type CashShift,
  type CashShiftDetail,
  type ListCashShiftsQuery,
} from '@panesypan/shared';
import { apiJson } from '@/lib/api-client';

export const cashHistoryKeys = {
  all: ['cash-history'] as const,
  list: (query: ListCashShiftsQuery) => ['cash-history', 'list', query] as const,
  detail: (id: string) => ['cash-history', 'detail', id] as const,
};

export async function listShifts(
  query: ListCashShiftsQuery,
  signal?: AbortSignal,
): Promise<CashShift[]> {
  const params = new URLSearchParams({ from: query.from, to: query.to });
  if (query.userId !== undefined) params.set('userId', query.userId);
  const { items } = await apiJson(
    `/api/v1/cash-shifts?${params.toString()}`,
    listCashShiftsResponseSchema,
    { signal },
  );
  return items;
}

export async function getShiftDetail(id: string, signal?: AbortSignal): Promise<CashShiftDetail> {
  return apiJson(`/api/v1/cash-shifts/${encodeURIComponent(id)}`, cashShiftDetailSchema, {
    signal,
  });
}

export async function confirmShift(id: string, note: string): Promise<CashShift> {
  const { shift } = await apiJson(
    `/api/v1/cash-shifts/${encodeURIComponent(id)}/confirm`,
    cashShiftResponseSchema,
    { method: 'POST', body: { note } },
  );
  return shift;
}

/** Nombre de una caja para mostrar: "Caja N.º 12", o la fecha si es anterior al consecutivo. */
export const shiftTitle = (shift: Pick<CashShift, 'number' | 'businessDate'>): string =>
  shift.number === null ? `Caja del ${shift.businessDate}` : `Caja N.º ${String(shift.number)}`;
