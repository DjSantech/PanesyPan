import type { BusinessSettings, Sale } from '@panesypan/shared';
import { loadPrinterConfig, type PrinterConfig } from './config';
import { drawerPulseBytes, receiptBytes, testTicketBytes, toBase64 } from './escpos';
import { EscPosPrinter, isNativeApp, type PrinterTarget } from './native-plugin';
import {
  isWebUsbAvailable,
  isWebUsbTarget,
  listWebUsbTargets,
  requestWebUsbTarget,
  writeWebUsb,
} from './webusb';

/**
 * Impresión directa ESC/POS: por el plugin nativo dentro de la app Android o por WebUSB en
 * Chrome. Sin impresora configurada, el POS sigue usando el diálogo de impresión del navegador.
 */

export type { PrinterTarget };

/** Medio por el que este equipo puede hablar con la impresora. */
export function printerTransport(): 'native' | 'webusb' | null {
  if (isNativeApp()) return 'native';
  return isWebUsbAvailable() ? 'webusb' : null;
}

export async function listTargets(): Promise<PrinterTarget[]> {
  const transport = printerTransport();
  if (transport === 'native') return (await EscPosPrinter.listTargets()).targets;
  if (transport === 'webusb') return listWebUsbTargets();
  return [];
}

/** Solo WebUSB: autorizar una impresora nueva (el plugin nativo ya las ve todas). */
export const requestTarget = requestWebUsbTarget;

function usableTarget(config: PrinterConfig): string | null {
  const { target } = config;
  if (target === null) return null;
  const transport = printerTransport();
  if (transport === 'native') return isWebUsbTarget(target) ? null : target;
  if (transport === 'webusb') return isWebUsbTarget(target) ? target : null;
  return null;
}

export function isDirectPrintingConfigured(config = loadPrinterConfig()): boolean {
  return usableTarget(config) !== null;
}

async function send(data: Uint8Array, config: PrinterConfig): Promise<void> {
  const target = usableTarget(config);
  if (target === null) throw new Error('No hay una impresora configurada en este equipo.');
  if (isNativeApp()) {
    await EscPosPrinter.write({ target, data: toBase64(data), baud: config.baud });
  } else {
    await writeWebUsb(target, data);
  }
}

export async function printReceipt(
  sale: Sale,
  settings: BusinessSettings,
  config = loadPrinterConfig(),
): Promise<void> {
  await send(receiptBytes(sale, settings, config.paperWidth), config);
}

export async function printTest(config = loadPrinterConfig()): Promise<void> {
  await send(testTicketBytes(config.paperWidth), config);
}

export async function openDrawer(config = loadPrinterConfig()): Promise<void> {
  await send(drawerPulseBytes(), config);
}

/** Estado del cajón. `null` = no se sabe (la impresora no lo informa o no hay app nativa). */
export async function getDrawerStatus(config = loadPrinterConfig()): Promise<boolean | null> {
  const target = usableTarget(config);
  if (target === null || !isNativeApp()) return null;
  try {
    return (await EscPosPrinter.readStatus({ target, baud: config.baud })).drawerOpen;
  } catch {
    return null;
  }
}

const WATCH_EVERY_MS = 5_000;
const OPEN_TOO_LONG_MS = 60_000;
const WATCH_FOR_MS = 10 * 60_000;

/**
 * Vigila el cajón después de una venta: llama con `true` si sigue abierto más de un minuto y
 * con `false` cuando por fin se cierra. Se rinde si el estado es desconocido. Devuelve la
 * función para dejar de vigilar.
 */
export function watchDrawer(onOpenTooLong: (open: boolean) => void): () => void {
  let stopped = false;
  let openSince: number | null = null;
  let warned = false;
  const started = Date.now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const tick = async () => {
    const open = await getDrawerStatus();
    if (stopped || open === null) return;
    const now = Date.now();
    if (open) {
      openSince ??= now;
      if (!warned && now - openSince >= OPEN_TOO_LONG_MS) {
        warned = true;
        onOpenTooLong(true);
      }
    } else if (openSince !== null) {
      if (warned) onOpenTooLong(false);
      return;
    }
    if (now - started < WATCH_FOR_MS) timer = setTimeout(() => void tick(), WATCH_EVERY_MS);
  };
  timer = setTimeout(() => void tick(), WATCH_EVERY_MS);
  return () => {
    stopped = true;
    clearTimeout(timer);
  };
}
