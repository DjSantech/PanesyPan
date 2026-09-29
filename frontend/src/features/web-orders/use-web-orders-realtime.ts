import { WEB_ORDERS_CHANGED_EVENT } from '@panesypan/shared';
import { useRealtimeEvent, type RealtimeStatus } from '@/lib/realtime';

export type { RealtimeStatus } from '@/lib/realtime';

/** Avisa con `onChange` cada vez que llega o cambia un pedido web (conexión compartida). */
export function useWebOrdersRealtime(onChange: () => void, enabled = true): RealtimeStatus {
  return useRealtimeEvent(WEB_ORDERS_CHANGED_EVENT, onChange, enabled);
}
