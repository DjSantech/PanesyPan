import { DASHBOARD_CHANGED_EVENT } from '@panesypan/shared';
import { useRealtimeEvent, type RealtimeStatus } from '@/lib/realtime';

export { FALLBACK_POLL_MS, type RealtimeStatus } from '@/lib/realtime';

/** Llama a `onChange` cada vez que el dashboard cambia (usa la conexión compartida). */
export function useDashboardRealtime(onChange: () => void): RealtimeStatus {
  return useRealtimeEvent(DASHBOARD_CHANGED_EVENT, onChange);
}
