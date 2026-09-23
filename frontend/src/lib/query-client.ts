import { QueryClient } from '@tanstack/react-query';
import { ApiError } from './api-errors';

/** Errores que no vale la pena reintentar: la respuesta sería la misma. */
const NON_RETRYABLE_STATUS = new Set([400, 401, 403, 404, 409, 423]);

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      retry: (failureCount, error) =>
        !(error instanceof ApiError && NON_RETRYABLE_STATUS.has(error.status)) && failureCount < 2,
    },
    mutations: { retry: false },
  },
});

/** Clave de la sesión actual en la caché de TanStack Query. */
export const SESSION_QUERY_KEY = ['session'] as const;
