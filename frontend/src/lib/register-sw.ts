import { registerSW } from 'virtual:pwa-register';
import { toast } from 'sonner';

const UPDATE_TOAST_ID = 'app-update';

/**
 * Registra el service worker (solo en producción). Cuando hay una versión nueva avisa en
 * pantalla y espera a que la persona toque "Actualizar", para no recargar en plena venta.
 */
export function setupServiceWorker(): void {
  if (!import.meta.env.PROD) return;
  const update = registerSW({
    onNeedRefresh() {
      toast('Hay una versión nueva del sistema', {
        id: UPDATE_TOAST_ID,
        duration: Number.POSITIVE_INFINITY,
        action: {
          label: 'Actualizar',
          onClick: () => {
            void update(true);
          },
        },
      });
    },
  });
}
