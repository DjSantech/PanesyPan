import {
  listUsersResponseSchema,
  userResponseSchema,
  userWithTemporaryPasswordSchema,
  type CreateUserRequest,
  type ListUsersQuery,
  type UpdateUserRequest,
  type User,
  type UserWithTemporaryPassword,
} from '@panesypan/shared';
import { apiJson } from '@/lib/api-client';

export const usersKeys = {
  all: ['users'] as const,
  list: (query: Partial<ListUsersQuery>) => ['users', 'list', query] as const,
};

export async function listUsers(
  query: Partial<ListUsersQuery>,
  signal?: AbortSignal,
): Promise<User[]> {
  const params = new URLSearchParams();
  if (query.status !== undefined) params.set('status', query.status);
  if (query.role !== undefined) params.set('role', query.role);
  if (query.search !== undefined && query.search.trim() !== '')
    params.set('search', query.search.trim());
  const suffix = params.size > 0 ? `?${params.toString()}` : '';
  const { items } = await apiJson(`/api/v1/users${suffix}`, listUsersResponseSchema, { signal });
  return items;
}

export function createUser(input: CreateUserRequest): Promise<UserWithTemporaryPassword> {
  return apiJson('/api/v1/users', userWithTemporaryPasswordSchema, { method: 'POST', body: input });
}

export async function updateUser(id: string, input: UpdateUserRequest): Promise<User> {
  const { user } = await apiJson(`/api/v1/users/${id}`, userResponseSchema, {
    method: 'PATCH',
    body: input,
  });
  return user;
}

export async function setUserStatus(id: string, isActive: boolean): Promise<User> {
  const { user } = await apiJson(`/api/v1/users/${id}/status`, userResponseSchema, {
    method: 'PATCH',
    body: { isActive },
  });
  return user;
}

export function resetUserPassword(id: string): Promise<UserWithTemporaryPassword> {
  return apiJson(`/api/v1/users/${id}/reset-password`, userWithTemporaryPasswordSchema, {
    method: 'POST',
  });
}

export async function resetUserPin(id: string): Promise<User> {
  const { user } = await apiJson(`/api/v1/users/${id}/reset-pin`, userResponseSchema, {
    method: 'POST',
  });
  return user;
}

export async function unlockUser(id: string): Promise<User> {
  const { user } = await apiJson(`/api/v1/users/${id}/unlock`, userResponseSchema, {
    method: 'POST',
  });
  return user;
}
