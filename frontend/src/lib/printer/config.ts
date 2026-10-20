import { useSyncExternalStore } from 'react';
import { z } from 'zod';

/** Configuración de la impresora de tiquetes de ESTE equipo (se guarda en el navegador). */
const STORAGE_KEY = 'pyp-printer';
const listeners = new Set<() => void>();

export const BAUD_RATES = [115200, 9600] as const;

const printerConfigSchema = z.object({
  /** Impresora elegida (id que entrega listTargets) o null para imprimir con el navegador. */
  target: z.string().min(1).nullable().catch(null),
  baud: z.union([z.literal(115200), z.literal(9600)]).catch(115200),
  paperWidth: z.enum(['58', '80']).catch('80'),
  /** Abrir el cajón al cobrar en efectivo. */
  autoOpenOnCash: z.boolean().catch(true),
});
export type PrinterConfig = z.infer<typeof printerConfigSchema>;

export const DEFAULT_PRINTER_CONFIG: PrinterConfig = {
  target: null,
  baud: 115200,
  paperWidth: '80',
  autoOpenOnCash: true,
};

let cached: { raw: string | null; config: PrinterConfig } | null = null;

export function loadPrinterConfig(): PrinterConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (cached?.raw === raw) return cached.config;
    let config = DEFAULT_PRINTER_CONFIG;
    if (raw !== null) {
      const parsed = printerConfigSchema.safeParse(JSON.parse(raw));
      if (parsed.success) config = parsed.data;
    }
    cached = { raw, config };
    return config;
  } catch {
    return DEFAULT_PRINTER_CONFIG;
  }
}

/** Guarda la configuración; `false` si el navegador no deja escribir (modo privado, etc.). */
export function savePrinterConfig(config: PrinterConfig): boolean {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
    return true;
  } catch {
    return false;
  } finally {
    for (const listener of listeners) listener();
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** La configuración actual, que se actualiza al guardarla. */
export function usePrinterConfig(): PrinterConfig {
  return useSyncExternalStore(subscribe, loadPrinterConfig);
}
