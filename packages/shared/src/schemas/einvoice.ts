import { z } from 'zod';
import { nitCheckDigit, onlyDigits } from '../einvoice/nit';

/**
 * Facturación electrónica (DIAN). Cada venta cobrada genera una factura electrónica de venta,
 * a nombre de "Consumidor final" o del cliente que la pida con sus datos. Al anular una venta
 * ya facturada se emite una nota crédito. El envío lo hace un proveedor tecnológico autorizado.
 */

// ── Proveedor ──────────────────────────────────────────────────────

/** SIMULATED: no envía nada a la DIAN (desarrollo y pruebas). FACTUS: proveedor real. */
export const EINVOICE_PROVIDERS = ['SIMULATED', 'FACTUS'] as const;
export type EInvoiceProvider = (typeof EINVOICE_PROVIDERS)[number];

export const EINVOICE_PROVIDER_LABELS: Readonly<Record<EInvoiceProvider, string>> = {
  SIMULATED: 'Simulado (sin validez ante la DIAN)',
  FACTUS: 'Factus',
};

export const EINVOICE_ENVIRONMENTS = ['SIMULATED', 'SANDBOX', 'PRODUCTION'] as const;
export type EInvoiceEnvironment = (typeof EINVOICE_ENVIRONMENTS)[number];

export const EINVOICE_ENVIRONMENT_LABELS: Readonly<Record<EInvoiceEnvironment, string>> = {
  SIMULATED: 'Simulado',
  SANDBOX: 'Pruebas (habilitación)',
  PRODUCTION: 'Producción',
};

// ── Cliente (adquiriente) ──────────────────────────────────────────

export const BUYER_ID_TYPES = ['CC', 'NIT', 'CE', 'PP', 'PPT'] as const;
export type BuyerIdType = (typeof BUYER_ID_TYPES)[number];

export const BUYER_ID_TYPE_LABELS: Readonly<Record<BuyerIdType, string>> = {
  CC: 'Cédula de ciudadanía',
  NIT: 'NIT',
  CE: 'Cédula de extranjería',
  PP: 'Pasaporte',
  PPT: 'Permiso por protección temporal',
};

/** Datos del cliente que pide la factura a su nombre. Sin cliente se factura a "Consumidor final". */
export const customerInputSchema = z
  .strictObject({
    idType: z.enum(BUYER_ID_TYPES),
    idNumber: z
      .string()
      .trim()
      .transform(onlyDigits)
      .pipe(z.string().min(5, 'El documento es muy corto').max(15, 'El documento es muy largo')),
    /** Dígito de verificación del NIT tal como lo escribió la persona (se valida). */
    checkDigit: z.int().min(0).max(9).nullable().default(null),
    name: z
      .string()
      .trim()
      .min(3, 'Escribe el nombre o la razón social')
      .max(100, 'Máximo 100 caracteres'),
    email: z
      .union([z.literal(''), z.email('El correo no es válido').max(120)])
      .default('')
      .transform((value) => value.toLowerCase()),
  })
  .refine(
    (customer) =>
      customer.idType !== 'NIT' ||
      customer.checkDigit === null ||
      customer.checkDigit === nitCheckDigit(customer.idNumber),
    { message: 'El dígito de verificación no corresponde al NIT', path: ['checkDigit'] },
  );
export type CustomerInput = z.input<typeof customerInputSchema>;

export const saleCustomerSchema = z.object({
  idType: z.enum(BUYER_ID_TYPES),
  idNumber: z.string(),
  checkDigit: z.int().nullable(),
  name: z.string(),
  email: z.string(),
});
export type SaleCustomer = z.infer<typeof saleCustomerSchema>;

// ── Documentos ─────────────────────────────────────────────────────

export const EINVOICE_KINDS = ['INVOICE', 'CREDIT_NOTE'] as const;
export type EInvoiceKind = (typeof EINVOICE_KINDS)[number];

export const EINVOICE_KIND_LABELS: Readonly<Record<EInvoiceKind, string>> = {
  INVOICE: 'Factura',
  CREDIT_NOTE: 'Nota crédito',
};

/**
 * PENDING  en cola (o esperando un reintento) · SENDING  enviándose ahora
 * ACCEPTED validada por la DIAN · REJECTED  rechazada: hay que corregir algo y reintentar
 * FAILED   se agotaron los reintentos automáticos · CANCELED  ya no hace falta (venta anulada antes de enviarse)
 */
export const EINVOICE_STATUSES = [
  'PENDING',
  'SENDING',
  'ACCEPTED',
  'REJECTED',
  'FAILED',
  'CANCELED',
] as const;
export type EInvoiceStatus = (typeof EINVOICE_STATUSES)[number];

export const EINVOICE_STATUS_LABELS: Readonly<Record<EInvoiceStatus, string>> = {
  PENDING: 'En cola',
  SENDING: 'Enviando',
  ACCEPTED: 'Validada',
  REJECTED: 'Rechazada',
  FAILED: 'Sin enviar',
  CANCELED: 'No aplica',
};

/** Estados que necesitan que alguien haga algo (corregir datos o reintentar). */
export const EINVOICE_ATTENTION_STATUSES: readonly EInvoiceStatus[] = ['REJECTED', 'FAILED'];

/** Resumen de la factura electrónica que viaja con la venta (para el tiquete y el listado). */
export const saleEInvoiceSchema = z.object({
  status: z.enum(EINVOICE_STATUSES),
  environment: z.enum(EINVOICE_ENVIRONMENTS),
  number: z.string().nullable(),
  /** CUFE: código único de la factura electrónica. */
  cufe: z.string().nullable(),
  /** Contenido del código QR que exige la DIAN en la representación impresa. */
  qrData: z.string().nullable(),
  publicUrl: z.string().nullable(),
  validatedAt: z.iso.datetime().nullable(),
  message: z.string().nullable(),
  creditNote: z
    .object({ status: z.enum(EINVOICE_STATUSES), number: z.string().nullable() })
    .nullable(),
});
export type SaleEInvoice = z.infer<typeof saleEInvoiceSchema>;

export const electronicDocumentSchema = z.object({
  id: z.string(),
  kind: z.enum(EINVOICE_KINDS),
  status: z.enum(EINVOICE_STATUSES),
  provider: z.enum(EINVOICE_PROVIDERS),
  environment: z.enum(EINVOICE_ENVIRONMENTS),
  saleId: z.string(),
  saleNumber: z.int().nullable(),
  total: z.int(),
  customerName: z.string(),
  number: z.string().nullable(),
  cufe: z.string().nullable(),
  publicUrl: z.string().nullable(),
  attempts: z.int(),
  lastError: z.string().nullable(),
  nextAttemptAt: z.iso.datetime().nullable(),
  validatedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
});
export type ElectronicDocument = z.infer<typeof electronicDocumentSchema>;

export const listElectronicDocumentsQuerySchema = z.strictObject({
  status: z.enum(EINVOICE_STATUSES).optional(),
  kind: z.enum(EINVOICE_KINDS).optional(),
});
export type ListElectronicDocumentsQuery = z.infer<typeof listElectronicDocumentsQuerySchema>;

export const listElectronicDocumentsResponseSchema = z.object({
  items: z.array(electronicDocumentSchema),
});
export const electronicDocumentResponseSchema = z.object({ document: electronicDocumentSchema });

export const einvoiceStatusResponseSchema = z.object({
  enabled: z.boolean(),
  provider: z.enum(EINVOICE_PROVIDERS),
  environment: z.enum(EINVOICE_ENVIRONMENTS),
  /** El proveedor elegido tiene sus credenciales configuradas en el servidor. */
  providerReady: z.boolean(),
  /** Proveedores con credenciales en el servidor (para elegir en Ajustes). */
  availableProviders: z.array(z.enum(EINVOICE_PROVIDERS)),
  counts: z.record(z.enum(EINVOICE_STATUSES), z.int()),
});
export type EInvoiceStatusResponse = z.infer<typeof einvoiceStatusResponseSchema>;

/** Contenido del QR de la DIAN: la consulta pública del documento por su CUFE. */
export const dianQrUrl = (cufe: string): string =>
  `https://catalogo-vpfe.dian.gov.co/document/searchqr?documentkey=${encodeURIComponent(cufe)}`;
