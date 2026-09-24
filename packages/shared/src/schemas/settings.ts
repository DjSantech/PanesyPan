import { z } from 'zod';
import { PRICE_LIMITS } from '../money/money';

/** Ancho del papel de la impresora térmica en milímetros. */
export const TICKET_WIDTHS = ['58', '80'] as const;
export type TicketWidth = (typeof TICKET_WIDTHS)[number];

export const SETTINGS_LIMITS = { maxTables: 50, maxDiscountPercent: 100 } as const;

export const businessSettingsSchema = z.object({
  /** Razón social que va en el tiquete (vacío = solo el nombre comercial). */
  legalName: z.string(),
  taxId: z.string(),
  address: z.string(),
  phone: z.string(),
  ticketFooter: z.string(),
  ticketWidth: z.enum(TICKET_WIDTHS),
  tableCount: z.int(),
  /** Descuento máximo (en %) que la cajera puede dar sin el PIN de un administrador. */
  maxCashierDiscountPercent: z.int(),
  /** Egreso máximo (en pesos) que la cajera saca de la caja sin el PIN de un administrador. */
  maxCashierExpense: z.int(),
  updatedAt: z.iso.datetime().nullable(),
});
export type BusinessSettings = z.infer<typeof businessSettingsSchema>;

/** Valores iniciales mientras el administrador no guarde la configuración. */
export const DEFAULT_BUSINESS_SETTINGS: Omit<BusinessSettings, 'updatedAt'> = {
  legalName: '',
  taxId: '',
  address: 'Dosquebradas, Risaralda',
  phone: '',
  ticketFooter: '¡Gracias por su compra!',
  ticketWidth: '80',
  tableCount: 8,
  maxCashierDiscountPercent: 10,
  maxCashierExpense: 50_000,
};

export const businessSettingsResponseSchema = z.object({ settings: businessSettingsSchema });

const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Máximo ${String(max)} caracteres`);

export const updateBusinessSettingsRequestSchema = z
  .strictObject({
    legalName: text(80).optional(),
    taxId: text(20)
      .regex(/^[\d.\-\s]*$/, 'El NIT solo lleva números, puntos y guion')
      .optional(),
    address: text(120).optional(),
    phone: text(40).optional(),
    ticketFooter: text(200).optional(),
    ticketWidth: z.enum(TICKET_WIDTHS).optional(),
    tableCount: z
      .int('Escribe un número entero')
      .min(0, 'Mínimo 0 mesas')
      .max(SETTINGS_LIMITS.maxTables, `Máximo ${String(SETTINGS_LIMITS.maxTables)} mesas`)
      .optional(),
    maxCashierDiscountPercent: z
      .int('Escribe un número entero')
      .min(0, 'Mínimo 0 %')
      .max(SETTINGS_LIMITS.maxDiscountPercent, 'Máximo 100 %')
      .optional(),
    maxCashierExpense: z
      .int('Escribe un número entero de pesos')
      .min(0, 'Mínimo $ 0')
      .max(PRICE_LIMITS.max, 'El valor es demasiado alto')
      .optional(),
  })
  .refine((data) => Object.keys(data).length > 0, { message: 'No hay cambios para guardar' });
export type UpdateBusinessSettingsRequest = z.infer<typeof updateBusinessSettingsRequestSchema>;
