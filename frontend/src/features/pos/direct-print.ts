import type { BusinessSettings, Sale } from '@panesypan/shared';
import { toast } from 'sonner';
import { loadPrinterConfig } from '@/lib/printer/config';
import {
  isDirectPrintingConfigured,
  openDrawer,
  printReceipt as printReceiptDirect,
} from '@/lib/printer/printer';
import { printReceipt as printReceiptBrowser } from './print-receipt';

const reason = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * Imprime el tiquete: directo a la impresora si este equipo la tiene configurada y, si no (o si
 * falla), con el diálogo de impresión del navegador. Nunca lanza errores.
 */
export async function printTicket(sale: Sale, settings: BusinessSettings): Promise<void> {
  if (!isDirectPrintingConfigured()) {
    printReceiptBrowser(sale, settings);
    return;
  }
  try {
    await printReceiptDirect(sale, settings);
  } catch (error) {
    toast.error(`No se pudo imprimir el tiquete: ${reason(error)}`, {
      duration: 15_000,
      action: {
        label: 'Imprimir con el navegador',
        onClick: () => {
          printReceiptBrowser(sale, settings);
        },
      },
    });
  }
}

/**
 * Lo que hace el hardware al terminar un cobro: abre el cajón si se pagó en efectivo e imprime
 * el tiquete (si la venta lleva factura electrónica se espera su CUFE y se imprime a mano desde
 * el diálogo de la venta). Devuelve si se mandó abrir el cajón. Nunca bloquea la venta.
 */
export async function runAfterSale(
  sale: Sale,
  settings: BusinessSettings | undefined,
): Promise<boolean> {
  const config = loadPrinterConfig();
  if (!isDirectPrintingConfigured(config)) return false;
  let drawerOpened = false;
  const paidCash = sale.payments.some((payment) => payment.method === 'CASH');
  if (paidCash && config.autoOpenOnCash) {
    try {
      await openDrawer(config);
      drawerOpened = true;
    } catch (error) {
      toast.error(`No se pudo abrir el cajón: ${reason(error)}`);
    }
  }
  if (settings !== undefined && sale.einvoice === null) await printTicket(sale, settings);
  return drawerOpened;
}
