import { hasPermission, type Permission, type SessionUser } from '@panesypan/shared';
import { useQuery } from '@tanstack/react-query';
import { SESSION_QUERY_KEY } from '@/lib/query-client';
import { fetchSession } from './auth.api';

export function useSessionQuery() {
  return useQuery({
    queryKey: SESSION_QUERY_KEY,
    queryFn: ({ signal }) => fetchSession(signal),
    staleTime: Number.POSITIVE_INFINITY,
  });
}

/** Usuario actual. Solo se usa dentro de rutas protegidas (RequireAuth garantiza que existe). */
export function useCurrentUser(): SessionUser {
  const { data } = useSessionQuery();
  if (data === undefined || data === null) {
    throw new Error('useCurrentUser se usó fuera de una ruta protegida');
  }
  return data.user;
}

export function useCan(permission: Permission): boolean {
  const { data } = useSessionQuery();
  return data !== undefined && data !== null && hasPermission(data.user.role, permission);
}
