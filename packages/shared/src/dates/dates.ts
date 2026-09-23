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

export function isBusinessDate(value: string): value is BusinessDate {
  return BUSINESS_DATE_PATTERN.test(value);
}

/** Fecha y hora legible en Colombia: "23/09/2026, 10:30 a. m." */
export function formatDateTimeCO(date: Date): string {
  assertValidDate(date);
  return dateTimeFormatter.format(date);
}

/** Hora legible en Colombia: "10:30 a. m." */
export function formatTimeCO(date: Date): string {
  assertValidDate(date);
  return timeFormatter.format(date);
}
