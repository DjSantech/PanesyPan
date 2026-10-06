import { z } from 'zod';
import { TAX_CODES } from '../einvoice/tax';
import { PRICE_LIMITS } from '../money/money';
import { EINVOICE_PROVIDERS } from './einvoice';

/** Ancho del papel de la impresora térmica en milímetros. */
export const TICKET_WIDTHS = ['58', '80'] as const;

/** Aviso por correo al dueño cuando se cierra una caja. */
export const CLOSE_ALERT_MODES = ['OFF', 'SHORTAGE', 'ALWAYS'] as const;
export type CloseAlertMode = (typeof CLOSE_ALERT_MODES)[number];
export const CLOSE_ALERT_LABELS: Readonly<Record<CloseAlertMode, string>> = {
  OFF: 'No avisar',
  SHORTAGE: 'Solo si hay faltante mayor al tope',
  ALWAYS: 'En cada cierre',
};
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
  /** Facturación electrónica: cada venta cobrada genera su factura (ver schemas/einvoice). */
  einvoiceEnabled: z.boolean(),
  einvoiceProvider: z.enum(EINVOICE_PROVIDERS),
  /** Rango de numeración autorizado por la DIAN, tal como lo identifica el proveedor. */
  einvoiceNumberingRangeId: z.int().nullable(),
  einvoiceCreditNoteRangeId: z.int().nullable(),
  /** El proveedor envía la factura al correo del cliente cuando lo da. */
  einvoiceSendEmail: z.boolean(),
  /**
   * Texto legal de la factura impresa: resolución de numeración de la DIAN (número, fecha,
   * prefijo, rango y vigencia) y el proveedor tecnológico. Lo entrega el proveedor.
   */
  einvoiceLegend: z.string(),
  /** Impuesto de los productos que no tienen uno propio. */
  defaultTax: z.enum(TAX_CODES).nullable(),
  closeAlert: z.enum(CLOSE_ALERT_MODES),
  /** Faltante (en pesos) desde el que se avisa en el modo "solo si hay faltante". */
  closeAlertThreshold: z.int(),
  /** El servidor tiene configurado el correo de alertas (variables RESEND_* / ALERT_EMAIL_*). */
  closeAlertEmailReady: z.boolean(),
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
  einvoiceEnabled: false,
  einvoiceProvider: 'SIMULATED',
  einvoiceNumberingRangeId: null,
  einvoiceCreditNoteRangeId: null,
  einvoiceSendEmail: true,
  einvoiceLegend: '',
  defaultTax: null,
  closeAlert: 'SHORTAGE',
  closeAlertThreshold: 10_000,
  closeAlertEmailReady: false,
};

export const businessSettingsResponseSchema = z.object({ settings: businessSettingsSchema });

const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Máximo ${String(max)} caracteres`);

const rangeIdSchema = z
  .int('El rango de numeración es un número entero')
  .positive('El rango de numeración es un número entero')
  .nullable();

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
    einvoiceEnabled: z.boolean().optional(),
    einvoiceProvider: z.enum(EINVOICE_PROVIDERS).optional(),
    einvoiceNumberingRangeId: rangeIdSchema.optional(),
    einvoiceCreditNoteRangeId: rangeIdSchema.optional(),
    einvoiceSendEmail: z.boolean().optional(),
    einvoiceLegend: text(400).optional(),
    defaultTax: z.enum(TAX_CODES).nullable().optional(),
    closeAlert: z.enum(CLOSE_ALERT_MODES).optional(),
    closeAlertThreshold: z
      .int('Escribe un número entero de pesos')
      .min(0, 'Mínimo $ 0')
      .max(PRICE_LIMITS.max, 'El valor es demasiado alto')
      .optional(),
  })
  .refine((data) => Object.keys(data).length > 0, { message: 'No hay cambios para guardar' });
export type UpdateBusinessSettingsRequest = z.infer<typeof updateBusinessSettingsRequestSchema>;
