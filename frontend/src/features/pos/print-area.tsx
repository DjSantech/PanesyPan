import type { ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';

/**
 * Imprime un contenido con el diálogo de impresión del navegador (se elige la impresora
 * térmica). Mientras imprime, en la página solo queda visible ese contenido (ver index.css).
 */
export function printArea(content: ReactNode): void {
  const container = document.createElement('div');
  container.className = 'print-area';
  document.body.append(container);
  const root = createRoot(container);
  flushSync(() => {
    root.render(
      <>
        <style>{'@page { margin: 0; }'}</style>
        {content}
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
