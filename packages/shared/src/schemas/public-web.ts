import { z } from 'zod';
import { lunchChoiceSchema } from './catalog';
import { moneySchema, objectIdSchema } from './common';
import { tabCheckoutRequestSchema } from './sales';

/**
 * Web pública (panesypan.com): respuestas de las rutas públicas de lectura.
 * Contrato: docs/web/CONTRATOS.md. Objetos estrictos: nunca se cuela un campo interno.
 */

// ── Catálogo ──

export const publicProductSchema = z
  .object({
    id: z.string(),
    slug: z.string(),
    name: z.string(),
    description: z.string(),
    price: z.number().int().nonnegative(),
    isAvailable: z.boolean(),
    imageUrl: z.string().nullable(),
  })
  .strict();
export type PublicProduct = z.infer<typeof publicProductSchema>;

export const publicCategorySchema = z
  .object({
    slug: z.string(),
    name: z.string(),
    products: z.array(publicProductSchema),
  })
  .strict();
export type PublicCategory = z.infer<typeof publicCategorySchema>;

export const publicCatalogResponseSchema = z
  .object({ categories: z.array(publicCategorySchema) })
  .strict();
export type PublicCatalogResponse = z.infer<typeof publicCatalogResponseSchema>;

// ── Menú del día ──

export const publicMenuOptionSchema = z
  .object({ name: z.string(), isAvailable: z.boolean() })
  .strict();
export type PublicMenuOption = z.infer<typeof publicMenuOptionSchema>;

export const publicMenuItemSchema = z
  .object({
    productId: z.string(),
    name: z.string(),
    price: z.number().int().nonnegative().nullable(),
    withChoices: z.boolean(),
    soldOut: z.boolean(),
  })
  .strict();
export type PublicMenuItem = z.infer<typeof publicMenuItemSchema>;

export const publicDailyMenuSchema = z
  .object({
    soups: z.array(publicMenuOptionSchema),
    principles: z.array(publicMenuOptionSchema),
    proteins: z.array(publicMenuOptionSchema),
    drinks: z.array(publicMenuOptionSchema),
    notes: z.string(),
    items: z.array(publicMenuItemSchema),
  })
  .strict();
export type PublicDailyMenu = z.infer<typeof publicDailyMenuSchema>;

export const publicDailyMenuResponseSchema = z
  .object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    menu: publicDailyMenuSchema.nullable(),
  })
  .strict();
export type PublicDailyMenuResponse = z.infer<typeof publicDailyMenuResponseSchema>;

// ── Negocio ──

export const publicBusinessResponseSchema = z
  .object({ name: z.string(), address: z.string(), phone: z.string() })
  .strict();
export type PublicBusinessResponse = z.infer<typeof publicBusinessResponseSchema>;

// ── Pedidos web ──

/**
 * Flujo: PENDING → CONFIRMED → DISPATCHED → DELIVERED. DELIVERED se alcanza solo al cobrar el
 * pedido (se crea la venta). CANCELED se permite desde cualquier estado previo a DELIVERED.
 */
export const WEB_ORDER_STATUSES = [
  'PENDING',
  'CONFIRMED',
  'DISPATCHED',
  'DELIVERED',
  'CANCELED',
] as const;
export const webOrderStatusSchema = z.enum(WEB_ORDER_STATUSES);
export type WebOrderStatus = z.infer<typeof webOrderStatusSchema>;

export const WEB_ORDER_STATUS_LABELS: Readonly<Record<WebOrderStatus, string>> = {
  PENDING: 'Pendiente',
  CONFIRMED: 'Confirmado',
  DISPATCHED: 'Despachado',
  DELIVERED: 'Entregado',
  CANCELED: 'Cancelado',
};

const FORWARD: Readonly<Record<WebOrderStatus, WebOrderStatus | null>> = {
  PENDING: 'CONFIRMED',
  CONFIRMED: 'DISPATCHED',
  // Pasar a DELIVERED es cobrar el pedido (POST /web-orders/:id/checkout), no un cambio de estado.
  DISPATCHED: null,
  DELIVERED: null,
  CANCELED: null,
};

/** Siguiente estado con PATCH /status; null si el paso siguiente es cobrar o ya terminó. */
export function nextWebOrderStatus(status: WebOrderStatus): WebOrderStatus | null {
  return FORWARD[status];
}

/** Se puede cobrar (crear la venta) desde CONFIRMED o DISPATCHED. */
export const canCheckoutWebOrder = (status: WebOrderStatus): boolean =>
  status === 'CONFIRMED' || status === 'DISPATCHED';

/** Se puede cancelar mientras no se haya cobrado ni cancelado. */
export const canCancelWebOrder = (status: WebOrderStatus): boolean =>
  status !== 'DELIVERED' && status !== 'CANCELED';

/**
 * Barrios con domicilio. Vacía = todo Dosquebradas (decisión del dueño): el cliente escribe su
 * barrio y confirma que su dirección está en Dosquebradas. Llenarla restringe a esos barrios.
 */
export const DELIVERY_NEIGHBORHOODS: readonly string[] = [];

export const WEB_ORDER_LIMITS = {
  nameMin: 2,
  nameMax: 60,
  addressMin: 5,
  addressMax: 120,
  neighborhoodMin: 2,
  neighborhoodMax: 60,
  noteMax: 200,
  quantityMax: 50,
  linesMax: 30,
} as const;

export const OUT_OF_ZONE_MESSAGE = 'Solo hacemos domicilios en Dosquebradas';

/** Evento de tiempo real (sin datos) cuando se crea o cambia un pedido web. */
export const WEB_ORDERS_CHANGED_EVENT = 'web-orders:changed';

const L = WEB_ORDER_LIMITS;

export const webOrderCustomerSchema = z.strictObject({
  name: z
    .string()
    .trim()
    .min(L.nameMin, 'Escribe tu nombre')
    .max(L.nameMax, 'El nombre es muy largo'),
  phone: z
    .string()
    .trim()
    .regex(/^3\d{9}$/, 'Escribe un celular de 10 dígitos que empiece por 3'),
  address: z
    .string()
    .trim()
    .min(L.addressMin, 'Escribe la dirección completa')
    .max(L.addressMax, 'La dirección es muy larga'),
  neighborhood: z
    .string()
    .trim()
    .min(L.neighborhoodMin, 'Escribe el barrio')
    .max(L.neighborhoodMax, 'El barrio es muy largo'),
  note: z.string().trim().max(L.noteMax, 'La nota es muy larga').default(''),
});
export type WebOrderCustomer = z.infer<typeof webOrderCustomerSchema>;

export const createWebOrderRequestSchema = z.strictObject({
  clientRequestId: z.uuid(),
  customer: webOrderCustomerSchema,
  confirmsDosquebradas: z.boolean().default(false),
  lines: z
    .array(
      z.strictObject({
        productId: objectIdSchema,
        quantity: z.number().int().min(1).max(L.quantityMax),
        /** Obligatorio en almuerzos del menú del día con elección; null en el resto. */
        lunch: lunchChoiceSchema.nullable().default(null),
      }),
    )
    .min(1, 'El carrito está vacío')
    .max(L.linesMax, 'Demasiados productos en un pedido'),
});
export type CreateWebOrderRequest = z.infer<typeof createWebOrderRequestSchema>;
export type CreateWebOrderInput = z.input<typeof createWebOrderRequestSchema>;

/**
 * Zona de domicilio: con lista de barrios, el barrio debe estar en ella; con la lista vacía,
 * el cliente debe confirmar que su dirección está en Dosquebradas.
 */
export function isInDeliveryZone(
  input: { neighborhood: string; confirmsDosquebradas: boolean },
  neighborhoods: readonly string[] = DELIVERY_NEIGHBORHOODS,
): boolean {
  if (neighborhoods.length === 0) return input.confirmsDosquebradas;
  return neighborhoods.includes(input.neighborhood.trim());
}

export const webOrderLineSchema = z.strictObject({
  productId: z.string(),
  name: z.string(),
  unitPrice: z.number().int().nonnegative(),
  quantity: z.number().int().positive(),
  total: z.number().int().nonnegative(),
  /** Proteína, principio y sopa (solo almuerzos con elección). */
  lunch: lunchChoiceSchema.nullable(),
});
export type WebOrderLine = z.infer<typeof webOrderLineSchema>;

/** Totales del pedido con los precios de la BD. El domicilio queda a confirmar (null). */
export function computeWebOrderTotals(
  lines: readonly {
    productId: string;
    name: string;
    unitPrice: number;
    quantity: number;
    lunch?: WebOrderLine['lunch'];
  }[],
): { lines: WebOrderLine[]; subtotal: number; deliveryFee: null; total: number } {
  const priced = lines.map((line) => ({
    ...line,
    lunch: line.lunch ?? null,
    total: line.unitPrice * line.quantity,
  }));
  const subtotal = priced.reduce((sum, line) => sum + line.total, 0);
  return { lines: priced, subtotal, deliveryFee: null, total: subtotal };
}

export const createWebOrderResponseSchema = z.strictObject({
  order: z.strictObject({
    number: z.number().int().positive(),
    status: webOrderStatusSchema,
    lines: z.array(webOrderLineSchema),
    subtotal: z.number().int().nonnegative(),
    deliveryFee: z.number().int().nonnegative().nullable(),
    total: z.number().int().nonnegative(),
    createdAt: z.string(),
  }),
});
export type CreateWebOrderResponse = z.infer<typeof createWebOrderResponseSchema>;

/** Pedido web como lo ve el panel (con los datos del cliente). */
export const webOrderSchema = z.strictObject({
  id: z.string(),
  number: z.number().int().positive(),
  status: webOrderStatusSchema,
  customer: z.strictObject({
    name: z.string(),
    phone: z.string(),
    address: z.string(),
    neighborhood: z.string(),
    note: z.string(),
  }),
  lines: z.array(webOrderLineSchema),
  subtotal: z.number().int().nonnegative(),
  deliveryFee: z.number().int().nonnegative().nullable(),
  total: z.number().int().nonnegative(),
  /** Venta creada al cobrar el pedido (null mientras no se cobre). */
  sale: z.strictObject({ id: z.string(), number: z.number().int().nullable() }).nullable(),
  /** Motivo de la cancelación (null si no se canceló). */
  cancelReason: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type WebOrder = z.infer<typeof webOrderSchema>;

export const listWebOrdersQuerySchema = z.strictObject({
  status: webOrderStatusSchema.optional(),
});
export type ListWebOrdersQuery = z.infer<typeof listWebOrdersQuerySchema>;

export const listWebOrdersResponseSchema = z.strictObject({ orders: z.array(webOrderSchema) });
export type ListWebOrdersResponse = z.infer<typeof listWebOrdersResponseSchema>;

export const updateWebOrderStatusRequestSchema = z.strictObject({ status: webOrderStatusSchema });
export type UpdateWebOrderStatusRequest = z.infer<typeof updateWebOrderStatusRequestSchema>;

export const webOrderResponseSchema = z.strictObject({ order: webOrderSchema });

// ── Cobro y cancelación de pedidos web (panel) ──

/**
 * POST /api/v1/web-orders/:id/checkout — cobra el pedido: crea una venta de mostrador en la caja
 * abierta de quien cobra (mismas reglas que el cobro del POS: pagos, descuento, PIN, cliente),
 * descuenta inventario y porciones del menú, y deja el pedido en DELIVERED.
 * `deliveryFee` es lo que cobra el domiciliario: se guarda en el pedido y NO entra a la venta
 * ni a la caja (el cliente se lo paga al domiciliario).
 */
export const webOrderCheckoutRequestSchema = tabCheckoutRequestSchema.extend({
  deliveryFee: moneySchema,
});
export type WebOrderCheckoutRequest = z.input<typeof webOrderCheckoutRequestSchema>;

/** POST /api/v1/web-orders/:id/cancel — solo mientras no se haya cobrado. */
export const cancelWebOrderRequestSchema = z.strictObject({
  reason: z.string().trim().min(3, 'Escribe el motivo').max(120, 'Máximo 120 caracteres'),
});
export type CancelWebOrderRequest = z.infer<typeof cancelWebOrderRequestSchema>;
export type WebOrderResponse = z.infer<typeof webOrderResponseSchema>;
