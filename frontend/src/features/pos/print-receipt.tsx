import type { BusinessSettings, Sale } from '@panesypan/shared';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { Receipt } from './Receipt';

/**
 * Imprime el tiquete con el diálogo de impresión del navegador (se elige la impresora
 * térmica). Mientras imprime, en la página solo queda visible el tiquete (ver index.css).
 */
export function printReceipt(sale: Sale, settings: BusinessSettings): void {
  const container = document.createElement('div');
  container.className = 'print-area';
  document.body.append(container);
  const root = createRoot(container);
  flushSync(() => {
    root.render(
      <>
        <style>{'@page { margin: 0; }'}</style>
        <Receipt sale={sale} settings={settings} className="px-[2mm] py-[3mm]" />
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
  // Algunos navegadores no disparan "afterprint": se limpia de todas formas.
  window.setTimeout(cleanup, 60_000);
}
