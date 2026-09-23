import { useEffect, useRef } from 'react';
import { useSessionStore } from '@/stores/session.store';
import { lockSession, touchSession } from './auth.api';

const ACTIVITY_EVENTS = ['pointerdown', 'keydown', 'touchstart', 'wheel'] as const;
const CHECK_INTERVAL_MS = 15_000;
/** Cada cuánto se avisa al servidor que la persona sigue usando la pantalla. */
const HEARTBEAT_INTERVAL_MS = 2 * 60_000;

/**
 * Bloquea la pantalla tras X minutos sin tocarla y, mientras se usa, avisa al servidor
 * para que no la bloquee por su lado (por ejemplo, mientras se arma un pedido largo).
 */
export function useIdleLock(enabled: boolean): void {
  const idleLockMinutes = useSessionStore((state) => state.idleLockMinutes);
  const lastActivity = useRef(0);
  const lastHeartbeat = useRef(0);

  useEffect(() => {
    if (!enabled) return undefined;
    lastActivity.current = Date.now();
    lastHeartbeat.current = Date.now();

    const onActivity = () => {
      const now = Date.now();
      lastActivity.current = now;
      if (now - lastHeartbeat.current > HEARTBEAT_INTERVAL_MS) {
        lastHeartbeat.current = now;
        void touchSession();
      }
    };

    const check = () => {
      if (Date.now() - lastActivity.current > idleLockMinutes * 60_000) {
        void lockSession();
      }
    };

    // Al volver a la pestaña se revisa de inmediato (el celular pudo quedar en el bolsillo).
    const onVisibility = () => {
      if (document.visibilityState === 'visible') check();
    };

    for (const event of ACTIVITY_EVENTS)
      window.addEventListener(event, onActivity, { passive: true });
    document.addEventListener('visibilitychange', onVisibility);
    const timer = window.setInterval(check, CHECK_INTERVAL_MS);

    return () => {
      for (const event of ACTIVITY_EVENTS) window.removeEventListener(event, onActivity);
      document.removeEventListener('visibilitychange', onVisibility);
      window.clearInterval(timer);
    };
  }, [enabled, idleLockMinutes]);
}
