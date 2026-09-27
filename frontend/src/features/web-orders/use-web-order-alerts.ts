import { hasPermission } from '@panesypan/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';
import { useCurrentUser } from '../auth/use-session';
import { useWebOrdersRealtime } from './use-web-orders-realtime';
import { listWebOrders, webOrderKeys } from './web-orders.api';
import { newPendingIds } from './web-orders-logic';

const POLL_MS = 30_000;

let audioContext: AudioContext | null = null;

/** Crea el contexto de audio en la primera interacción (antes el navegador lo bloquea). */
function unlockAudio(): void {
  try {
    audioContext ??= new AudioContext();
    if (audioContext.state === 'suspended') void audioContext.resume();
  } catch {
    // Sin soporte de audio: el aviso sigue siendo visual.
  }
}

/** Dos tonos cortos generados en el momento (sin archivos). */
function playChime(): void {
  const context = audioContext;
  if (context?.state !== 'running') return;
  const start = context.currentTime;
  [880, 1320].forEach((frequency, index) => {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const at = start + index * 0.18;
    oscillator.type = 'sine';
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(0.3, at + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.16);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start(at);
    oscillator.stop(at + 0.17);
  });
}

function notifyBrowser(title: string): void {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  try {
    new Notification(title, { body: 'Ábrelo en Pedidos web.', tag: title });
  } catch {
    // Algunos navegadores móviles solo notifican desde el service worker.
  }
}

/**
 * Vigila los pedidos web desde cualquier pantalla: suena, avisa y devuelve cuántos están
 * pendientes (para el menú). En la primera carga no avisa de los que ya estaban.
 */
export function useWebOrderAlerts(): number {
  const user = useCurrentUser();
  const enabled = hasPermission(user.role, 'web-orders:read');
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const seen = useRef<Set<string> | null>(null);

  const orders = useQuery({
    queryKey: webOrderKeys.list({ status: undefined }),
    queryFn: ({ signal }) => listWebOrders({ status: undefined }, signal),
    refetchInterval: POLL_MS,
    enabled,
  });

  const refresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: webOrderKeys.all });
  }, [queryClient]);
  useWebOrdersRealtime(refresh, enabled);

  useEffect(() => {
    window.addEventListener('pointerdown', unlockAudio);
    window.addEventListener('keydown', unlockAudio);
    return () => {
      window.removeEventListener('pointerdown', unlockAudio);
      window.removeEventListener('keydown', unlockAudio);
    };
  }, []);

  useEffect(() => {
    if (orders.data === undefined) return;
    const { fresh, seen: next } = newPendingIds(orders.data, seen.current);
    seen.current = next;
    if (fresh.length === 0) return;
    playChime();
    for (const order of fresh) {
      const title = `Nuevo pedido web #${String(order.number)}`;
      notifyBrowser(title);
      toast(title, {
        description: `${order.customer.name} · ${order.customer.neighborhood}`,
        action: {
          label: 'Ver',
          onClick: () => {
            void navigate('/pedidos-web');
          },
        },
      });
    }
  }, [orders.data, navigate]);

  return enabled ? (orders.data?.filter((order) => order.status === 'PENDING').length ?? 0) : 0;
}
