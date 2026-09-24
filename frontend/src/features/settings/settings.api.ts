import {
  businessSettingsResponseSchema,
  type BusinessSettings,
  type UpdateBusinessSettingsRequest,
} from '@panesypan/shared';
import { useQuery } from '@tanstack/react-query';
import { apiJson } from '@/lib/api-client';

export const SETTINGS_QUERY_KEY = ['settings'] as const;

export async function getSettings(signal?: AbortSignal): Promise<BusinessSettings> {
  const { settings } = await apiJson('/api/v1/settings', businessSettingsResponseSchema, {
    signal,
  });
  return settings;
}

export async function updateSettings(
  input: UpdateBusinessSettingsRequest,
): Promise<BusinessSettings> {
  const { settings } = await apiJson('/api/v1/settings', businessSettingsResponseSchema, {
    method: 'PATCH',
    body: input,
  });
  return settings;
}

/** Configuración del negocio (mesas, tope de descuento, datos del tiquete). */
export function useSettings() {
  return useQuery({
    queryKey: SETTINGS_QUERY_KEY,
    queryFn: ({ signal }) => getSettings(signal),
    staleTime: 5 * 60_000,
  });
}
