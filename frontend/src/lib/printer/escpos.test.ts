import type { BusinessSettings, Sale } from '@panesypan/shared';
import { describe, expect, it } from 'vitest';
import {
  drawerPulseBytes,
  EscPos,
  PAPER_COLUMNS,
  receiptBytes,
  receiptLines,
  row,
  toBase64,
  toPrintable,
  wrap,
} from './escpos';

const SETTINGS = {
  legalName: 'Panes y Pan S.A.S.',
  taxId: '900.123.456-7',
  address: '',
  phone: '310 000 0000',
  ticketFooter: '¡Gracias por su compra!',
  ticketWidth: '58',
} as BusinessSettings;

const SALE = {
  id: 's1',
  number: 42,
  type: 'COUNTER',
  tableNumber: null,
  status: 'PAID',
  lines: [
    {
      id: 'l1',
      productId: 'p1',
      name: 'Pan de bono',
      unitPrice: 2_000,
      listPrice: null,
      quantity: 3,
      note: '',
      total: 6_000,
      isLunch: false,
      lunch: null,
    },
    {
      id: 'l2',
      productId: 'p2',
      name: 'Almuerzo ejecutivo con jugo natural',
      unitPrice: 14_000,
      listPrice: null,
      quantity: 1,
      note: 'Sin cebolla',
      total: 14_000,
      isLunch: false,
      lunch: null,
    },
  ],
  subtotal: 20_000,
  discount: null,
  total: 20_000,
  payments: [{ method: 'CASH', amount: 20_000, reference: '' }],
  cashReceived: 50_000,
  change: 30_000,
  paidBy: { id: 'u1', name: 'Laura Gómez' },
  openedAt: '2026-10-19T15:00:00.000Z',
  paidAt: '2026-10-19T15:05:00.000Z',
  einvoice: null,
} as unknown as Sale;

describe('toPrintable', () => {
  it('quita tildes y cambia símbolos que la impresora no trae', () => {
    expect(toPrintable('Canción ñandú × 2 — N.º 5')).toBe('Cancion nandu x 2 - N.o 5');
    expect(toPrintable('¡Hola!\n€')).toBe('Hola!\n?');
  });
  it('cambia los espacios especiales por espacios normales', () => {
    expect(toPrintable(`$${String.fromCharCode(0xa0)}2.000`)).toBe('$ 2.000');
  });
});

describe('wrap y row', () => {
  it('parte en renglones sin pasarse del ancho', () => {
    expect(wrap('uno dos tres cuatro', 8)).toEqual(['uno dos', 'tres', 'cuatro']);
    expect(wrap('abcdefghij', 4)).toEqual(['abcd', 'efgh', 'ij']);
  });
  it('alinea el valor a la derecha del renglón', () => {
    expect(row('TOTAL', '$ 9', 12)).toEqual(['TOTAL    $ 9']);
    const long = row('Almuerzo ejecutivo largo', '$ 14.000', 20);
    expect(long.at(-1)).toMatch(/\$ 14\.000$/);
    for (const value of long) expect(value.length).toBeLessThanOrEqual(20);
  });
});

describe('receiptLines', () => {
  it('arma el tiquete de 58 mm sin pasarse de 32 columnas', () => {
    const lines = receiptLines(SALE, SETTINGS, PAPER_COLUMNS['58']);
    for (const value of lines) expect(value.length).toBeLessThanOrEqual(32);
    expect(lines).toContain('NIT 900.123.456-7');
    expect(lines).toContain('Venta N.o 000042');
    expect(lines).toContain('Mostrador');
    expect(lines).toContain('Atendio: Laura Gomez');
    expect(lines.some((value) => /^3 x Pan de bono +\$ 6\.000$/.test(value))).toBe(true);
    expect(lines).toContain('  (Sin cebolla)');
    expect(lines.some((value) => /^TOTAL +\$ 20\.000$/.test(value))).toBe(true);
    expect(lines.some((value) => /^Cambio +\$ 30\.000$/.test(value))).toBe(true);
  });
});

describe('bytes ESC/POS', () => {
  it('el tiquete empieza con ESC @ y termina con el corte', () => {
    const bytes = Array.from(receiptBytes(SALE, SETTINGS, '80'));
    expect(bytes.slice(0, 2)).toEqual([0x1b, 0x40]);
    expect(bytes.slice(-4)).toEqual([0x1d, 0x56, 0x42, 0x00]);
    expect(bytes.every((b) => b < 0x80)).toBe(true);
  });
  it('el pulso al cajón usa ESC p por el pin 2 y el pin 5', () => {
    expect(Array.from(drawerPulseBytes())).toEqual([
      0x1b, 0x70, 0x00, 0x19, 0xfa, 0x1b, 0x70, 0x01, 0x19, 0xfa,
    ]);
  });
  it('negrita, centrado y base64', () => {
    const bytes = new EscPos().bold(true).align('center').text('Hi').build();
    expect(Array.from(bytes)).toEqual([0x1b, 0x45, 1, 0x1b, 0x61, 1, 0x48, 0x69]);
    expect(toBase64(bytes)).toBe(btoa(String.fromCharCode(...bytes)));
  });
});
