import { REALTIME_PATH } from '@panesypan/shared';
import { useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import { getApiBaseUrl } from '@/lib/api-client';

export type RealtimeStatus = 'connecting' | 'live' | 'offline';

/** Cada cuánto se consulta la API si el tiempo real no está disponible. */
export const FALLBACK_POLL_MS = 30_000;

/**
 * Una sola conexión de tiempo real para toda la app: el dashboard, los pedidos web y el aviso
 * de pedido nuevo se suscriben a ella. Se abre con el primer suscriptor y se cierra con el
 * último (al cerrar sesión se desmontan todos y la conexión se cierra).
 */
let shared: Socket | null = null;
let subscribers = 0;

function acquire(): Socket {
  shared ??= io(getApiBaseUrl(), {
    path: REALTIME_PATH,
    withCredentials: true,
    transports: ['websocket', 'polling'],
  });
  subscribers += 1;
  return shared;
}

function release(): void {
  subscribers -= 1;
  if (subscribers <= 0 && shared !== null) {
    shared.close();
    shared = null;
    subscribers = 0;
  }
}

/**
 * Llama a `onChange` cada vez que el servidor emite `event` (los eventos no traen datos: el
 * llamador vuelve a pedirlos por la API). Al reconectar también se llama, porque pudieron pasar
 * cambios mientras estuvo caído.
 */
export function useRealtimeEvent(
  event: string,
  onChange: () => void,
  enabled = true,
): RealtimeStatus {
  // Si la conexión compartida ya está abierta (otra pantalla la abrió), arranca en vivo.
  const [status, setStatus] = useState<RealtimeStatus>(() =>
    shared?.connected === true ? 'live' : 'connecting',
  );
  const handler = useRef(onChange);

  useEffect(() => {
    handler.current = onChange;
  }, [onChange]);

  useEffect(() => {
    if (!enabled) return;
    const socket = acquire();
    let firstConnection = !socket.connected;

    const onConnect = () => {
      setStatus('live');
      if (!firstConnection) handler.current();
      firstConnection = false;
    };
    const onOffline = () => {
      setStatus('offline');
    };
    const onEvent = () => {
      handler.current();
    };

    socket.on('connect', onConnect);
    socket.on('disconnect', onOffline);
    socket.on('connect_error', onOffline);
    socket.on(event, onEvent);

    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onOffline);
      socket.off('connect_error', onOffline);
      socket.off(event, onEvent);
      release();
    };
  }, [event, enabled]);

  return status;
}
