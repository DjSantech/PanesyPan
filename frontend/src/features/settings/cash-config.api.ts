import {
  cashConceptResponseSchema,
  listCashConceptsResponseSchema,
  listStaffResponseSchema,
  staffMemberResponseSchema,
  type CashConcept,
  type CreateCashConceptRequest,
  type CreateStaffMemberRequest,
  type StaffMember,
  type UpdateCashConceptRequest,
  type UpdateStaffMemberRequest,
} from '@panesypan/shared';
import { useQuery } from '@tanstack/react-query';
import { apiJson } from '@/lib/api-client';

export const cashConfigKeys = {
  all: ['cash-config'] as const,
  concepts: (all: boolean) => ['cash-config', 'concepts', all] as const,
  staff: (all: boolean) => ['cash-config', 'staff', all] as const,
};

const listQuery = (all: boolean) => (all ? '?all=true' : '');

export async function listCashConcepts(all: boolean, signal?: AbortSignal): Promise<CashConcept[]> {
  const { items } = await apiJson(
    `/api/v1/cash-concepts${listQuery(all)}`,
    listCashConceptsResponseSchema,
    { signal },
  );
  return items;
}

export async function createCashConcept(input: CreateCashConceptRequest): Promise<CashConcept> {
  const { concept } = await apiJson('/api/v1/cash-concepts', cashConceptResponseSchema, {
    method: 'POST',
    body: input,
  });
  return concept;
}

export async function updateCashConcept(
  id: string,
  input: UpdateCashConceptRequest,
): Promise<CashConcept> {
  const { concept } = await apiJson(
    `/api/v1/cash-concepts/${encodeURIComponent(id)}`,
    cashConceptResponseSchema,
    { method: 'PATCH', body: input },
  );
  return concept;
}

export async function listStaff(all: boolean, signal?: AbortSignal): Promise<StaffMember[]> {
  const { items } = await apiJson(`/api/v1/staff${listQuery(all)}`, listStaffResponseSchema, {
    signal,
  });
  return items;
}

export async function createStaffMember(input: CreateStaffMemberRequest): Promise<StaffMember> {
  const { member } = await apiJson('/api/v1/staff', staffMemberResponseSchema, {
    method: 'POST',
    body: input,
  });
  return member;
}

export async function updateStaffMember(
  id: string,
  input: UpdateStaffMemberRequest,
): Promise<StaffMember> {
  const { member } = await apiJson(
    `/api/v1/staff/${encodeURIComponent(id)}`,
    staffMemberResponseSchema,
    { method: 'PATCH', body: input },
  );
  return member;
}

/** Tipos de movimiento (activos, o todos para administrarlos). */
export function useCashConcepts(all = false) {
  return useQuery({
    queryKey: cashConfigKeys.concepts(all),
    queryFn: ({ signal }) => listCashConcepts(all, signal),
    staleTime: 5 * 60_000,
  });
}

/** Personal (activo, o todo para administrarlo). */
export function useStaff(all = false) {
  return useQuery({
    queryKey: cashConfigKeys.staff(all),
    queryFn: ({ signal }) => listStaff(all, signal),
    staleTime: 5 * 60_000,
  });
}
