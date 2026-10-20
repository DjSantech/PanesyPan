import {
  BUSINESS_NAME,
  formatCOP,
  formatDateTimeCO,
  PAYMENT_METHOD_LABELS,
  type BusinessSettings,
  type Sale,
} from '@panesypan/shared';
import { formatSaleNumber } from '@/features/pos/receipt-format';

/**
 * Codificador ESC/POS mínimo para impresoras térmicas genéricas. El texto se envía en ASCII:
 * se quitan las tildes y los símbolos que la tabla de caracteres de la impresora no trae.
 */

const ESC = 0x1b;
const GS = 0x1d;

/** Columnas de texto por ancho de papel (fuente A). */
export const PAPER_COLUMNS = { '58': 32, '80': 48 } as const;
export type PaperWidth = keyof typeof PAPER_COLUMNS;

const REPLACEMENTS: Readonly<Record<string, string>> = {
  '×': 'x',
  '−': '-',
  '–': '-',
  '—': '-',
  '·': '-',
  º: 'o',
  ª: 'a',
  '“': '"',
  '”': '"',
  '‘': "'",
  '’': "'",
  '…': '...',
  '¿': '',
  '¡': '',
};

/** Deja el texto en ASCII imprimible (más saltos de línea). */
export function toPrintable(text: string): string {
  return Array.from(text.normalize('NFD').replace(/\p{M}/gu, ''))
    .map((char) => {
      if (char === '\n') return char;
      if (/\s/u.test(char)) return ' ';
      const replacement = REPLACEMENTS[char];
      if (replacement !== undefined) return replacement;
      const code = char.charCodeAt(0);
      return code >= 0x20 && code < 0x7f ? char : '?';
    })
    .join('');
}

export class EscPos {
  private readonly bytes: number[] = [];

  /** ESC @ (reinicia la impresora) y tabla de caracteres PC437. */
  init(): this {
    this.bytes.push(ESC, 0x40, ESC, 0x74, 0x00);
    return this;
  }

  align(position: 'left' | 'center' | 'right'): this {
    this.bytes.push(ESC, 0x61, position === 'left' ? 0 : position === 'center' ? 1 : 2);
    return this;
  }

  bold(on: boolean): this {
    this.bytes.push(ESC, 0x45, on ? 1 : 0);
    return this;
  }

  /** Letra a doble alto (GS ! 0x01) o normal. */
  tall(on: boolean): this {
    this.bytes.push(GS, 0x21, on ? 0x01 : 0x00);
    return this;
  }

  text(value: string): this {
    for (const char of toPrintable(value)) this.bytes.push(char.charCodeAt(0));
    return this;
  }

  line(value = ''): this {
    return this.text(value + '\n');
  }

  feed(lines: number): this {
    this.bytes.push(ESC, 0x64, Math.max(0, Math.min(255, lines)));
    return this;
  }

  /** Avanza el papel y corta (corte parcial). */
  cut(): this {
    this.bytes.push(GS, 0x56, 0x42, 0x00);
    return this;
  }

  /** Pulso al cajón por el pin 2 y por el pin 5 (cubre ambos cableados). */
  drawerPulse(): this {
    this.bytes.push(ESC, 0x70, 0x00, 0x19, 0xfa, ESC, 0x70, 0x01, 0x19, 0xfa);
    return this;
  }

  build(): Uint8Array {
    return Uint8Array.from(this.bytes);
  }
}

/** Parte un texto en renglones de máximo `width` caracteres (corta palabras muy largas). */
export function wrap(text: string, width: number): string[] {
  const lines: string[] = [];
  let current = '';
  for (const word of toPrintable(text).split(' ').filter(Boolean)) {
    let rest = word;
    while (rest.length > width) {
      if (current !== '') {
        lines.push(current);
        current = '';
      }
      lines.push(rest.slice(0, width));
      rest = rest.slice(width);
    }
    if (current === '') current = rest;
    else if (current.length + 1 + rest.length <= width) current += ' ' + rest;
    else {
      lines.push(current);
      current = rest;
    }
  }
  if (current !== '' || lines.length === 0) lines.push(current);
  return lines;
}

/** Etiqueta a la izquierda y valor a la derecha; si no cabe, la etiqueta usa varios renglones. */
export function row(label: string, value: string, cols: number): string[] {
  const right = toPrintable(value);
  const labelLines = wrap(label, Math.max(1, cols - right.length - 1));
  const last = labelLines.pop() ?? '';
  return [...labelLines, last + ' '.repeat(Math.max(1, cols - last.length - right.length)) + right];
}

/** Texto del tiquete (sin comandos), renglón por renglón; la primera raya cierra el encabezado. */
export function receiptLines(sale: Sale, settings: BusinessSettings, cols: number): string[] {
  const divider = '-'.repeat(cols);
  const out: string[] = [];
  const header = [
    settings.legalName,
    settings.taxId === '' ? '' : `NIT ${settings.taxId}`,
    settings.address,
    settings.phone === '' ? '' : `Tel. ${settings.phone}`,
  ].filter((value) => value !== '');
  for (const value of header) out.push(...wrap(value, cols));
  out.push(divider);
  out.push(`Venta N.o ${formatSaleNumber(sale.number)}`);
  out.push(formatDateTimeCO(new Date(sale.paidAt ?? sale.openedAt)));
  out.push(sale.tableNumber === null ? 'Mostrador' : `Mesa ${String(sale.tableNumber)}`);
  if (sale.paidBy !== null) out.push(...wrap(`Atendió: ${sale.paidBy.name}`, cols));
  out.push(divider);
  for (const line of sale.lines) {
    out.push(...row(`${String(line.quantity)} x ${line.name}`, formatCOP(line.total), cols));
    if (line.quantity > 1) out.push(`  ${formatCOP(line.unitPrice)} c/u`);
    if (line.note !== '')
      out.push(...wrap(`(${line.note})`, cols - 2).map((value) => `  ${value}`));
  }
  out.push(divider);
  if (sale.discount !== null) {
    out.push(...row('Subtotal', formatCOP(sale.subtotal), cols));
    const label =
      sale.discount.mode === 'PERCENT'
        ? `Descuento (${String(sale.discount.value)} %)`
        : 'Descuento';
    out.push(...row(label, `-${formatCOP(sale.discount.amount)}`, cols));
  }
  out.push(...row('TOTAL', formatCOP(sale.total), cols));
  for (const payment of sale.payments) {
    out.push(...row(PAYMENT_METHOD_LABELS[payment.method], formatCOP(payment.amount), cols));
  }
  if (sale.cashReceived !== null) {
    out.push(...row('Recibido', formatCOP(sale.cashReceived), cols));
    out.push(...row('Cambio', formatCOP(sale.change), cols));
  }
  out.push(divider);
  const einvoice = sale.einvoice;
  if (einvoice !== null && einvoice.number !== null) {
    out.push(...wrap(`Factura electrónica ${einvoice.number}`, cols));
    if (einvoice.cufe !== null) out.push(...wrap(`CUFE: ${einvoice.cufe}`, cols));
    out.push(divider);
  }
  return out.map(toPrintable);
}

/** Tiquete completo en bytes ESC/POS, listo para enviar a la impresora. */
export function receiptBytes(
  sale: Sale,
  settings: BusinessSettings,
  paper: PaperWidth,
): Uint8Array {
  const cols = PAPER_COLUMNS[paper];
  const doc = new EscPos().init().align('center').bold(true).tall(true).line(BUSINESS_NAME);
  doc.tall(false).bold(false);
  const lines = receiptLines(sale, settings, cols);
  const headerEnd = lines.indexOf('-'.repeat(cols));
  for (const value of lines.slice(0, headerEnd)) doc.line(value);
  doc.align('left');
  for (const value of lines.slice(headerEnd)) {
    const strong = value.startsWith('TOTAL ') || value.startsWith('Venta N.o');
    if (strong) doc.bold(true);
    doc.line(value);
    if (strong) doc.bold(false);
  }
  doc.align('center').line('Precios con impuestos incluidos');
  if (settings.ticketFooter !== '') {
    doc.bold(true);
    for (const value of wrap(settings.ticketFooter, cols)) doc.line(value);
    doc.bold(false);
  }
  if (sale.status === 'VOIDED') doc.bold(true).tall(true).line('ANULADA').tall(false).bold(false);
  return doc.feed(4).cut().build();
}

/** Tiquete corto para probar la impresora y el ancho del papel. */
export function testTicketBytes(paper: PaperWidth): Uint8Array {
  const cols = PAPER_COLUMNS[paper];
  return new EscPos()
    .init()
    .align('center')
    .bold(true)
    .tall(true)
    .line(BUSINESS_NAME)
    .tall(false)
    .bold(false)
    .line('Prueba de impresora')
    .line(formatDateTimeCO(new Date()))
    .align('left')
    .line('-'.repeat(cols))
    .line(`Papel ${paper} mm, ${String(cols)} columnas`)
    .line('1234567890'.repeat(Math.ceil(cols / 10)).slice(0, cols))
    .line('Tildes: canción, pequeño, ¡listo!')
    .feed(4)
    .cut()
    .build();
}

export function drawerPulseBytes(): Uint8Array {
  return new EscPos().drawerPulse().build();
}

/** Bytes a base64 (el puente nativo solo recibe texto). */
export function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}
