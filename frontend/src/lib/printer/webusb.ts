import type { PrinterTarget } from './native-plugin';

/** Impresión por WebUSB (Chrome sin la app nativa). */

// Tipado mínimo de WebUSB: el proyecto no incluye los tipos del estándar.
interface UsbEndpoint {
  endpointNumber: number;
  direction: 'in' | 'out';
  type: string;
}
interface UsbInterface {
  interfaceNumber: number;
  alternate: { interfaceClass: number; endpoints: UsbEndpoint[] };
}
interface UsbDevice {
  vendorId: number;
  productId: number;
  productName?: string;
  manufacturerName?: string;
  opened: boolean;
  configuration: { interfaces: UsbInterface[] } | null;
  open(): Promise<void>;
  selectConfiguration(n: number): Promise<void>;
  claimInterface(n: number): Promise<void>;
  transferOut(endpoint: number, data: Uint8Array): Promise<unknown>;
}
interface Usb {
  getDevices(): Promise<UsbDevice[]>;
  requestDevice(options: { filters: unknown[] }): Promise<UsbDevice>;
}

const PREFIX = 'webusb:';

function getUsb(): Usb | undefined {
  return (navigator as Navigator & { usb?: Usb }).usb;
}

export const isWebUsbAvailable = (): boolean => getUsb() !== undefined;
export const isWebUsbTarget = (id: string): boolean => id.startsWith(PREFIX);

const hex = (n: number) => n.toString(16).padStart(4, '0');
const idOf = (d: UsbDevice) => `${PREFIX}${hex(d.vendorId)}:${hex(d.productId)}`;

function toTarget(d: UsbDevice): PrinterTarget {
  const name = [d.manufacturerName, d.productName].filter(Boolean).join(' ') || 'Sin nombre';
  return { id: idOf(d), kind: 'usb', label: `${name} (${hex(d.vendorId)}:${hex(d.productId)})` };
}

/** Dispositivos USB que el usuario ya autorizó en este navegador. */
export async function listWebUsbTargets(): Promise<PrinterTarget[]> {
  const usb = getUsb();
  if (usb === undefined) return [];
  return (await usb.getDevices()).map(toTarget);
}

/** Abre el selector de Chrome para autorizar una impresora nueva. */
export async function requestWebUsbTarget(): Promise<PrinterTarget> {
  const usb = getUsb();
  if (usb === undefined) throw new Error('Este navegador no soporta WebUSB. Usa Google Chrome.');
  return toTarget(await usb.requestDevice({ filters: [] }));
}

export async function writeWebUsb(target: string, data: Uint8Array): Promise<void> {
  const usb = getUsb();
  if (usb === undefined) throw new Error('Este navegador no soporta WebUSB.');
  const device = (await usb.getDevices()).find((d) => idOf(d) === target);
  if (device === undefined) {
    throw new Error('La impresora no está conectada o no está autorizada en este navegador.');
  }
  if (!device.opened) await device.open();
  if (device.configuration === null) await device.selectConfiguration(1);
  const isBulkOut = (ep: UsbEndpoint) => ep.direction === 'out' && ep.type === 'bulk';
  const iface = device.configuration?.interfaces.find((i) => i.alternate.endpoints.some(isBulkOut));
  const endpoint = iface?.alternate.endpoints.find(isBulkOut);
  if (iface === undefined || endpoint === undefined) {
    throw new Error('La impresora no tiene un canal de salida (bulk OUT).');
  }
  await device.claimInterface(iface.interfaceNumber).catch(() => undefined);
  await device.transferOut(endpoint.endpointNumber, data);
}
