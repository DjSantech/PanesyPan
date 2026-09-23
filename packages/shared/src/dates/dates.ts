import { BUSINESS_LOCALE, BUSINESS_TIME_ZONE } from '../constants/business';

/** Día de negocio en formato AAAA-MM-DD (hora de Colombia). */
export type BusinessDate = string;

export const BUSINESS_DATE_PATTERN = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

const businessDateFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: BUSINESS_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

const dateTimeFormatter = new Intl.DateTimeFormat(BUSINESS_LOCALE, {
  timeZone: BUSINESS_TIME_ZONE,
  dateStyle: 'medium',
  timeStyle: 'short',
});

const longDateFormatter = new Intl.DateTimeFormat(BUSINESS_LOCALE, {
  timeZone: BUSINESS_TIME_ZONE,
  weekday: 'long',
  day: 'numeric',
  month: 'long',
});

const timeFormatter = new Intl.DateTimeFormat(BUSINESS_LOCALE, {
  timeZone: BUSINESS_TIME_ZONE,
  timeStyle: 'short',
});

function assertValidDate(date: Date): void {
  if (Number.isNaN(date.getTime())) {
    throw new RangeError('Fecha inválida');
  }
}

/**
 * Devuelve el día de negocio (AAAA-MM-DD) de un instante, calculado en hora de Colombia.
 * Ejemplo: 2026-09-23T03:00:00Z (22 sep, 10:00 p. m. en Bogotá) → "2026-09-22".
 */
export function toBusinessDate(date: Date = new Date()): BusinessDate {
  assertValidDate(date);
  const parts = businessDateFormatter.formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((item) => item.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

export function isBusinessDate(value: string): boolean {
  return BUSINESS_DATE_PATTERN.test(value);
}

/** Colombia no usa horario de verano: su desfase con UTC es siempre −05:00. */
const BUSINESS_UTC_OFFSET = '-05:00';

/**
 * Rango UTC [start, end) que cubre un día de negocio completo en hora de Colombia.
 * Ejemplo: "2026-09-23" → 2026-09-23T05:00Z hasta 2026-09-24T05:00Z.
 */
export function businessDateRangeUtc(date: BusinessDate): { start: Date; end: Date } {
  if (!isBusinessDate(date)) {
    throw new RangeError(`Fecha de negocio inválida: ${date}`);
  }
  const start = new Date(`${date}T00:00:00${BUSINESS_UTC_OFFSET}`);
  // Date convierte fechas imposibles (31 de febrero → 3 de marzo): se exige que no cambie.
  if (Number.isNaN(start.getTime()) || toBusinessDate(start) !== date) {
    throw new RangeError(`Fecha de negocio inválida: ${date}`);
  }
  return { start, end: new Date(start.getTime() + 24 * 60 * 60 * 1000) };
}

/** Fecha y hora legible en Colombia: "23/09/2026, 10:30 a. m." */
export function formatDateTimeCO(date: Date): string {
  assertValidDate(date);
  return dateTimeFormatter.format(date);
}

/** Fecha larga en Colombia con mayúscula inicial: "Miércoles, 23 de septiembre". */
export function formatLongDateCO(date: Date): string {
  assertValidDate(date);
  const text = longDateFormatter.format(date);
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Hora legible en Colombia: "10:30 a. m." */
export function formatTimeCO(date: Date): string {
  assertValidDate(date);
  return timeFormatter.format(date);
}
