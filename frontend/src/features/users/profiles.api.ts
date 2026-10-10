import {
  listProfilesResponseSchema,
  profileResponseSchema,
  USER_ROLE_LABELS,
  userResponseSchema,
  type CreateProfileRequest,
  type Profile,
  type UpdateProfileRequest,
  type User,
} from '@panesypan/shared';
import { useQuery } from '@tanstack/react-query';
import { apiJson } from '@/lib/api-client';

export const profilesKeys = { all: ['profiles'] as const };

export function useProfiles() {
  return useQuery({
    queryKey: profilesKeys.all,
    queryFn: ({ signal }) => listProfiles(signal),
  });
}

/** Nombre del perfil que usa un usuario (el de su rol si no tiene uno asignado). */
export function profileLabel(user: User, profiles: readonly Profile[] | undefined): string {
  if (user.role === 'ADMIN') return 'Administrador (todos los permisos)';
  const assigned = profiles?.find((p) => p.id === user.profileId && p.isActive);
  if (assigned !== undefined) return assigned.name;
  return `${USER_ROLE_LABELS[user.role]} (por defecto)`;
}

export async function listProfiles(signal?: AbortSignal): Promise<Profile[]> {
  const { items } = await apiJson('/api/v1/profiles', listProfilesResponseSchema, { signal });
  return items;
}

export async function createProfile(input: CreateProfileRequest): Promise<Profile> {
  const { profile } = await apiJson('/api/v1/profiles', profileResponseSchema, {
    method: 'POST',
    body: input,
  });
  return profile;
}

export async function updateProfile(id: string, input: UpdateProfileRequest): Promise<Profile> {
  const { profile } = await apiJson(`/api/v1/profiles/${id}`, profileResponseSchema, {
    method: 'PATCH',
    body: input,
  });
  return profile;
}

/** null vuelve al perfil por defecto de su rol. */
export async function setUserProfile(id: string, profileId: string | null): Promise<User> {
  const { user } = await apiJson(`/api/v1/users/${id}/profile`, userResponseSchema, {
    method: 'PATCH',
    body: { profileId },
  });
  return user;
}
