import { useState } from 'react';
import { Button } from '@/components/ui/button';

/**
 * Página de diagnóstico (sin enlace en el menú) para comprobar si Chrome alcanza la
 * impresora de tickets por WebUSB y si la caja registradora abre con ESC/POS.
 */

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

const ESC = 0x1b;
const GS = 0x1d;
/** Pulso al cajón: pin 2 y luego pin 5 (según cómo esté cableada la caja). */
const OPEN_DRAWER = new Uint8Array([ESC, 0x70, 0x00, 0x19, 0xfa, ESC, 0x70, 0x01, 0x19, 0xfa]);

function hex(n: number) {
  return '0x' + n.toString(16).padStart(4, '0');
}

function describe(d: UsbDevice) {
  const name = [d.manufacturerName, d.productName].filter(Boolean).join(' ') || 'Sin nombre';
  return `${name} (vendor ${hex(d.vendorId)}, product ${hex(d.productId)})`;
}

function ticketBytes() {
  const text = new TextEncoder().encode(
    'PANES & PAN\nPrueba de impresora\n' + new Date().toLocaleString('es-CO') + '\n\n\n\n',
  );
  return new Uint8Array([ESC, 0x40, ...text, GS, 0x56, 0x01]);
}

export function CashDrawerDiagnosticPage() {
  const [device, setDevice] = useState<UsbDevice | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const usb = (navigator as Navigator & { usb?: Usb }).usb;

  const add = (line: string) =>
    setLog((l) => [...l, `${new Date().toLocaleTimeString('es-CO')}  ${line}`]);

  async function connect() {
    if (!usb) {
      add('❌ Este navegador no soporta WebUSB. Usa Google Chrome actualizado.');
      return;
    }
    try {
      const known = await usb.getDevices();
      if (known.length) add(`Ya autorizados: ${known.map(describe).join('; ')}`);
      const d = await usb.requestDevice({ filters: [] });
      add(`✅ Seleccionado: ${describe(d)}`);
      setDevice(d);
    } catch (e) {
      add(`❌ No se eligió dispositivo: ${(e as Error).message}`);
    }
  }

  async function send(data: Uint8Array, label: string) {
    if (!device) {
      add('Primero toca "Buscar impresora".');
      return;
    }
    try {
      if (!device.opened) await device.open();
      if (!device.configuration) await device.selectConfiguration(1);
      const interfaces = device.configuration?.interfaces ?? [];
      add(
        `Interfaces: ${interfaces
          .map((i) => `#${String(i.interfaceNumber)} clase ${String(i.alternate.interfaceClass)}`)
          .join(', ')}`,
      );
      const target = interfaces.find((i) =>
        i.alternate.endpoints.some((ep) => ep.direction === 'out' && ep.type === 'bulk'),
      );
      if (!target) throw new Error('No hay un canal de salida (bulk OUT) en este dispositivo.');
      const endpoint = target.alternate.endpoints.find(
        (ep) => ep.direction === 'out' && ep.type === 'bulk',
      );
      if (!endpoint) throw new Error('No se encontró el endpoint de salida.');
      await device.claimInterface(target.interfaceNumber).catch(() => undefined);
      await device.transferOut(endpoint.endpointNumber, data);
      add(
        `✅ ${label}: enviado por interfaz #${String(target.interfaceNumber)}, endpoint ${String(endpoint.endpointNumber)}`,
      );
    } catch (e) {
      add(`❌ ${label}: ${(e as Error).name} — ${(e as Error).message}`);
    }
  }

  return (
    <main className="mx-auto flex max-w-xl flex-col gap-4 p-4">
      <h1 className="text-2xl font-semibold">Diagnóstico de caja registradora</h1>
      <p className="text-muted-foreground text-sm">
        WebUSB: {usb ? 'disponible ✅' : 'NO disponible ❌'} · {navigator.userAgent}
      </p>
      <div className="flex flex-col gap-2">
        <Button size="lg" onClick={connect}>
          1. Buscar impresora
        </Button>
        <Button size="lg" variant="outline" onClick={() => send(ticketBytes(), 'Imprimir prueba')}>
          2. Imprimir prueba
        </Button>
        <Button size="lg" variant="outline" onClick={() => send(OPEN_DRAWER, 'Abrir caja')}>
          3. Abrir caja
        </Button>
      </div>
      <pre className="bg-muted min-h-40 rounded-md p-3 text-xs whitespace-pre-wrap">
        {log.length
          ? log.join('\n')
          : 'Aquí aparecerán los resultados. Toma foto o captura y envíala.'}
      </pre>
    </main>
  );
}
