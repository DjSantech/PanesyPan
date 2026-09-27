import type { BusinessSettings, WebOrder } from '@panesypan/shared';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { WebOrderTicket } from './WebOrderTicket';

/** Imprime la comanda con el mismo mecanismo que el tiquete del POS (ver print-receipt). */
export function printWebOrder(order: WebOrder, settings: BusinessSettings): void {
  const container = document.createElement('div');
  container.className = 'print-area';
  document.body.append(container);
  const root = createRoot(container);
  flushSync(() => {
    root.render(
      <>
        <style>{'@page { margin: 0; }'}</style>
        <WebOrderTicket order={order} settings={settings} />
      </>,
    );
  });

  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    window.removeEventListener('afterprint', cleanup);
    root.unmount();
    container.remove();
  };
  window.addEventListener('afterprint', cleanup);
  window.print();
  window.setTimeout(cleanup, 60_000);
}
