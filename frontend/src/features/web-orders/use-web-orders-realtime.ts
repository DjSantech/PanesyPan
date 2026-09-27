import { REALTIME_PATH, WEB_ORDERS_CHANGED_EVENT } from '@panesypan/shared';
import { useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { getApiBaseUrl } from '@/lib/api-client';

export type RealtimeStatus = 'connecting' | 'live' | 'offline';

/**
 * Avisa con `onChange` cada vez que llega o cambia un pedido web (el socket no trae datos).
 * Al reconectar también avisa, por si hubo cambios mientras estuvo caído.
 */
export function useWebOrdersRealtime(onChange: () => void, enabled = true): RealtimeStatus {
  const [status, setStatus] = useState<RealtimeStatus>('connecting');
  const handler = useRef(onChange);

  useEffect(() => {
    handler.current = onChange;
  }, [onChange]);

  useEffect(() => {
    if (!enabled) return;
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
    socket.on(WEB_ORDERS_CHANGED_EVENT, () => {
      handler.current();
    });

    return () => {
      socket.close();
    };
  }, [enabled]);

  return status;
}
