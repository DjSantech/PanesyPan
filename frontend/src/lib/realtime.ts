import { REALTIME_PATH } from '@panesypan/shared';
import { useEffect, useRef, useState } from 'react';
import type { Socket } from 'socket.io-client';
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
let connecting: Promise<Socket> | null = null;
let subscribers = 0;

/**
 * socket.io se descarga aparte, después de pintar la pantalla: así no retrasa la primera carga
 * del punto de venta (son ~100 KB que solo hacen falta para los avisos en vivo).
 */
async function acquire(): Promise<Socket> {
  subscribers += 1;
  const pending = (connecting ??= import('socket.io-client').then(({ io }) => {
    const socket = io(getApiBaseUrl(), {
      path: REALTIME_PATH,
      withCredentials: true,
      transports: ['websocket', 'polling'],
    });
    // Si todos se fueron mientras se descargaba, no deja una conexión abierta.
    if (connecting !== pending) socket.close();
    else shared = socket;
    return socket;
  }));
  return pending;
}

function release(): void {
  subscribers -= 1;
  if (subscribers <= 0) {
    shared?.close();
    shared = null;
    connecting = null;
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
    let active = true;
    let detach: (() => void) | null = null;

    void acquire().then((socket) => {
      if (!active) return;
      let firstConnection = !socket.connected;
      if (socket.connected) setStatus('live');

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
      detach = () => {
        socket.off('connect', onConnect);
        socket.off('disconnect', onOffline);
        socket.off('connect_error', onOffline);
        socket.off(event, onEvent);
      };
    });

    return () => {
      active = false;
      detach?.();
      release();
    };
  }, [event, enabled]);

  return status;
}
