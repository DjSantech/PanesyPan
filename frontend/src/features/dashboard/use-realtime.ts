import { DASHBOARD_CHANGED_EVENT, REALTIME_PATH } from '@panesypan/shared';
import { useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { getApiBaseUrl } from '@/lib/api-client';

export type RealtimeStatus = 'connecting' | 'live' | 'offline';

/** Cada cuánto se consulta la API si el tiempo real no está disponible. */
export const FALLBACK_POLL_MS = 30_000;

/**
 * Conecta con el servidor de tiempo real y llama a `onChange` cada vez que el dashboard
 * cambia. El socket no trae datos: solo avisa, y el llamador vuelve a pedirlos por la API.
 * Al reconectar también se llama, porque pudieron pasar cambios mientras estuvo caído.
 */
export function useDashboardRealtime(onChange: () => void): RealtimeStatus {
  const [status, setStatus] = useState<RealtimeStatus>('connecting');
  const handler = useRef(onChange);

  useEffect(() => {
    handler.current = onChange;
  }, [onChange]);

  useEffect(() => {
    const socket = io(getApiBaseUrl(), {
      path: REALTIME_PATH,
      withCredentials: true,
      transports: ['websocket', 'polling'],
    });
    let firstConnection = true;

    socket.on('connect', () => {
      setStatus('live');
      if (!firstConnection) handler.current();
      firstConnection = false;
    });
    socket.on('disconnect', () => {
      setStatus('offline');
    });
    socket.on('connect_error', () => {
      setStatus('offline');
    });
    socket.on(DASHBOARD_CHANGED_EVENT, () => {
      handler.current();
    });

    return () => {
      socket.close();
    };
  }, []);

  return status;
}
