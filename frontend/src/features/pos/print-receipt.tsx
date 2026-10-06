import type { BusinessSettings, Sale } from '@panesypan/shared';
import { printArea } from './print-area';
import { Receipt } from './Receipt';

/** Imprime el tiquete de una venta en la impresora térmica. */
export function printReceipt(sale: Sale, settings: BusinessSettings): void {
  printArea(<Receipt sale={sale} settings={settings} className="px-[2mm] py-[3mm]" />);
}
