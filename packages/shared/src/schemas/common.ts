import { z } from 'zod';
import { BUSINESS_DATE_PATTERN } from '../dates/dates';

/** Identificador de MongoDB (ObjectId) en formato hexadecimal. */
export const objectIdSchema = z.string().regex(/^[a-f\d]{24}$/i, 'Identificador inválido');

/** Monto en pesos: entero y no negativo. */
export const moneySchema = z.int('El monto debe ser un número entero de pesos').nonnegative();

/** Día de negocio AAAA-MM-DD. */
export const businessDateSchema = z
  .string()
  .regex(BUSINESS_DATE_PATTERN, 'La fecha debe tener el formato AAAA-MM-DD');
