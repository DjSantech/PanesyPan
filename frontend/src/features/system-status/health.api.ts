import {
  databaseHealthResponseSchema,
  healthResponseSchema,
  type DatabaseHealthResponse,
  type HealthResponse,
} from '@panesypan/shared';
import { apiGet, apiRequest, toApiError } from '@/lib/api-client';

export function fetchApiHealth(signal?: AbortSignal): Promise<HealthResponse> {
  return apiGet('/api/health', healthResponseSchema, signal);
}

/** El endpoint responde 503 cuando la base de datos está caída: eso también es un estado válido. */
export async function fetchDatabaseHealth(signal?: AbortSignal): Promise<DatabaseHealthResponse> {
  const { status, body, requestId } = await apiRequest('/api/health/db', { method: 'GET', signal });
  if (status === 200 || status === 503) {
    const parsed = databaseHealthResponseSchema.safeParse(body);
    if (parsed.success) return parsed.data;
  }
  throw toApiError(status, body, requestId);
}
