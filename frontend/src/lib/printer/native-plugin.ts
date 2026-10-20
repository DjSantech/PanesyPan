import { Capacitor, registerPlugin } from '@capacitor/core';

/** Puente con el plugin nativo de la app Android (impresora por USB o puerto serie). */
export interface PrinterTarget {
  id: string;
  kind: 'usb' | 'serial';
  label: string;
}

export interface EscPosPrinterPlugin {
  listTargets(): Promise<{ targets: PrinterTarget[] }>;
  write(options: { target: string; data: string; baud?: number }): Promise<{ bytes: number }>;
  readStatus(options: { target: string; baud?: number }): Promise<{ drawerOpen: boolean | null }>;
}

export const EscPosPrinter = registerPlugin<EscPosPrinterPlugin>('EscPosPrinter');

export const isNativeApp = (): boolean => Capacitor.isNativePlatform();
