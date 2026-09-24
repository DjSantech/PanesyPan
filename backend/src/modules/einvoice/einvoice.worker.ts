import type { Logger } from 'pino';
import { processDueDocuments } from './einvoice.service';

/**
 * Proceso que envía las facturas en cola. Corre dentro de la API: revisa la cola cada
 * 30 segundos y además se "despierta" apenas se cobra o se anula una venta.
 * Nunca corre dos envíos a la vez en el mismo servidor.
 */
const INTERVAL_MS = 30_000;

interface WorkerState {
  logger: Logger;
  timer: NodeJS.Timeout;
  running: Promise<void> | null;
  again: boolean;
  stopped: boolean;
}

let state: WorkerState | null = null;

function run(): void {
  const current = state;
  if (current === null || current.stopped) return;
  if (current.running !== null) {
    current.again = true;
    return;
  }
  current.running = processDueDocuments({ logger: current.logger })
    .then(() => undefined)
    .catch((error: unknown) => {
      current.logger.error(
        { reason: error instanceof Error ? error.message : String(error) },
        'Falló el envío de facturas electrónicas',
      );
    })
    .finally(() => {
      current.running = null;
      if (current.again) {
        current.again = false;
        run();
      }
    });
}

export function startEInvoiceWorker(logger: Logger): () => Promise<void> {
  const timer = setInterval(run, INTERVAL_MS);
  timer.unref();
  state = { logger, timer, running: null, again: false, stopped: false };
  run();
  return async () => {
    const current = state;
    if (current === null) return;
    current.stopped = true;
    clearInterval(current.timer);
    await current.running;
    state = null;
  };
}

/** Pide un envío inmediato (no hace nada si el proceso no está corriendo, p. ej. en pruebas). */
export function kickEInvoiceWorker(): void {
  if (state !== null) setImmediate(run);
}
