import { z } from 'zod';
import { businessDateSchema, objectIdSchema } from './common';
import { TAX_CODES } from '../einvoice/tax';
import { PRICE_LIMITS } from '../money/money';

// ── Categorías ─────────────────────────────────────────────────────

/** LUNCH: sus productos se ofrecen en el menú del día (porciones limitadas). */
export const CATEGORY_KINDS = ['STANDARD', 'LUNCH'] as const;
export type CategoryKind = (typeof CATEGORY_KINDS)[number];

export const CATEGORY_KIND_LABELS: Readonly<Record<CategoryKind, string>> = {
  STANDARD: 'General',
  LUNCH: 'Almuerzos (menú del día)',
};

const catalogNameSchema = z
  .string()
  .trim()
  .min(2, 'El nombre debe tener al menos 2 caracteres')
  .max(60, 'El nombre debe tener máximo 60 caracteres');

export const categorySchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  kind: z.enum(CATEGORY_KINDS),
  sortOrder: z.int(),
  isActive: z.boolean(),
  productCount: z.int().nonnegative(),
});
export type Category = z.infer<typeof categorySchema>;

export const listCategoriesResponseSchema = z.object({ items: z.array(categorySchema) });
export const categoryResponseSchema = z.object({ category: categorySchema });

export const createCategoryRequestSchema = z.strictObject({
  name: catalogNameSchema,
  kind: z.enum(CATEGORY_KINDS).default('STANDARD'),
});
export type CreateCategoryRequest = z.input<typeof createCategoryRequestSchema>;

export const updateCategoryRequestSchema = z
  .strictObject({
    name: catalogNameSchema.optional(),
    kind: z.enum(CATEGORY_KINDS).optional(),
    isActive: z.boolean().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, { message: 'No hay cambios para guardar' });
export type UpdateCategoryRequest = z.infer<typeof updateCategoryRequestSchema>;

export const reorderCategoriesRequestSchema = z.strictObject({
  ids: z.array(objectIdSchema).min(1).max(100),
});
export type ReorderCategoriesRequest = z.infer<typeof reorderCategoriesRequestSchema>;

// ── Productos ──────────────────────────────────────────────────────

/** Descripción corta del producto: la ven las meseras en el POS y los clientes en la web. */
export const PRODUCT_DESCRIPTION_MAX = 300;
/** Código de barras o interno del producto (el que trae el lector o el sistema anterior). */
export const PRODUCT_CODE_MAX = 40;
const productCodeSchema = z
  .string()
  .trim()
  .min(1, 'El código no puede estar vacío')
  .max(PRODUCT_CODE_MAX, `Máximo ${String(PRODUCT_CODE_MAX)} caracteres`);

const descriptionSchema = z
  .string()
  .trim()
  .max(PRODUCT_DESCRIPTION_MAX, `Máximo ${String(PRODUCT_DESCRIPTION_MAX)} caracteres`);

/** Imágenes de producto: el navegador las reduce antes de subirlas; este es el tope del servidor. */
export const PRODUCT_IMAGE_TYPES = ['image/webp', 'image/jpeg', 'image/png'] as const;
export type ProductImageType = (typeof PRODUCT_IMAGE_TYPES)[number];
export const PRODUCT_IMAGE_MAX_BYTES = 2 * 1024 * 1024;

/** Unidades en inventario de un producto. */
const stockQuantitySchema = z
  .int('El stock debe ser un número entero')
  .min(0, 'El stock no puede ser negativo')
  .max(10_000, 'El stock es demasiado alto');

/** Precio final en pesos (ya incluye impuestos). */
export const priceSchema = z
  .int('El precio debe ser un número entero de pesos')
  .min(PRICE_LIMITS.min, `El precio mínimo es $ ${String(PRICE_LIMITS.min)}`)
  .max(PRICE_LIMITS.max, 'El precio es demasiado alto');

/** Costo unitario (lo que le cuesta a la panadería); 0 vale para lo que se regala o produce. */
export const costSchema = z
  .int('El costo debe ser un número entero de pesos')
  .min(0, 'El costo no puede ser negativo')
  .max(PRICE_LIMITS.max, 'El costo es demasiado alto');

/** Margen sobre el precio de venta, en porcentaje entero (null sin costo o sin precio). */
export function marginPercent(price: number, cost: number | null): number | null {
  if (cost === null || price <= 0) return null;
  return Math.round(((price - cost) / price) * 100);
}

export const SUBCATEGORY_MAX = 40;
export const subcategorySchema = z
  .string()
  .trim()
  .max(SUBCATEGORY_MAX, `Máximo ${String(SUBCATEGORY_MAX)} caracteres`);

export const productSchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  categoryId: z.string(),
  /** Subcategoría dentro de la categoría (ej.: Bebidas › Gaseosas); '' = sin subcategoría. */
  subcategory: z.string(),
  price: z.int(),
  /** Costo unitario; null si no se ha registrado o si quien consulta no puede verlo (cajera). */
  cost: z.int().nullable(),
  /** Proveedor principal (para el pedido sugerido). */
  supplierId: z.string().nullable(),
  isAvailable: z.boolean(),
  isFavorite: z.boolean(),
  trackStock: z.boolean(),
  /** Impuesto del producto; null = el impuesto general de Ajustes. */
  tax: z.enum(TAX_CODES).nullable(),
  description: z.string(),
  /** Código de barras o interno; null si no tiene (también si la API aún no lo envía). */
  code: z.string().nullable().default(null),
  /** Ruta de la imagen en la API (se le antepone la URL de la API), o null sin imagen. */
  imagePath: z.string().nullable(),
  /** Aparece en la web pública (Fase 2). */
  isVisibleOnline: z.boolean(),
  isActive: z.boolean(),
  sortOrder: z.int(),
  updatedAt: z.iso.datetime(),
});
export type Product = z.infer<typeof productSchema>;

export const listProductsQuerySchema = z.strictObject({
  categoryId: objectIdSchema.optional(),
  status: z.enum(['active', 'archived', 'all']).default('active'),
  search: z.string().trim().max(60).optional(),
});
export type ListProductsQuery = z.infer<typeof listProductsQuerySchema>;

export const listProductsResponseSchema = z.object({ items: z.array(productSchema) });
export const productResponseSchema = z.object({ product: productSchema });

export const createProductRequestSchema = z.strictObject({
  name: catalogNameSchema,
  categoryId: objectIdSchema,
  subcategory: subcategorySchema.default(''),
  price: priceSchema,
  cost: costSchema.nullable().default(null),
  supplierId: objectIdSchema.nullable().default(null),
  isAvailable: z.boolean().default(true),
  isFavorite: z.boolean().default(false),
  /** Sin indicar: todo controla inventario menos los almuerzos (porciones del menú del día). */
  trackStock: z.boolean().optional(),
  tax: z.enum(TAX_CODES).nullable().default(null),
  description: descriptionSchema.default(''),
  code: productCodeSchema.nullable().default(null),
  isVisibleOnline: z.boolean().default(true),
  /** Unidades con las que arranca el inventario (solo si controla inventario). */
  initialStock: stockQuantitySchema.nullable().default(null),
});
export type CreateProductRequest = z.input<typeof createProductRequestSchema>;

export const updateProductRequestSchema = z
  .strictObject({
    name: catalogNameSchema.optional(),
    categoryId: objectIdSchema.optional(),
    subcategory: subcategorySchema.optional(),
    price: priceSchema.optional(),
    cost: costSchema.nullable().optional(),
    supplierId: objectIdSchema.nullable().optional(),
    isFavorite: z.boolean().optional(),
    trackStock: z.boolean().optional(),
    tax: z.enum(TAX_CODES).nullable().optional(),
    description: descriptionSchema.optional(),
    code: productCodeSchema.nullable().optional(),
    isVisibleOnline: z.boolean().optional(),
    isActive: z.boolean().optional(),
    /** Unidades en inventario (queda como ajuste en el libro); solo si controla inventario. */
    stock: stockQuantitySchema.optional(),
  })
  .refine((data) => Object.keys(data).length > 0, { message: 'No hay cambios para guardar' });
export type UpdateProductRequest = z.infer<typeof updateProductRequestSchema>;

export const setAvailabilityRequestSchema = z.strictObject({ isAvailable: z.boolean() });

// ── Menú del día (almuerzos) ───────────────────────────────────────

const menuTextSchema = z.string().trim().max(120);

/** Opción del menú (una sopa, un principio o una proteína) que se puede marcar como agotada. */
export const menuOptionSchema = z.object({ name: z.string(), isAvailable: z.boolean() });
export type MenuOption = z.infer<typeof menuOptionSchema>;

export const MENU_OPTIONS_MAX = 10;

export const dailyMenuOfferingSchema = z.object({
  productId: objectIdSchema,
  /** Porciones preparadas; `null` = sin límite. */
  portions: z.int().min(0).max(1_000).nullable(),
  /**
   * true: al venderlo se elige proteína, principio y sopa (el almuerzo).
   * false: se vende directo (p. ej. el caldo solo).
   */
  withChoices: z.boolean(),
});

export const dailyMenuSchema = z.object({
  date: businessDateSchema,
  soups: z.array(menuOptionSchema),
  principles: z.array(menuOptionSchema),
  proteins: z.array(menuOptionSchema),
  /** Bebidas del día (jugos, gaseosas...); igual que sopas: se puede declinar. */
  drinks: z.array(menuOptionSchema),
  notes: z.string(),
  offerings: z.array(
    dailyMenuOfferingSchema.extend({ name: z.string(), price: z.int(), sold: z.int() }),
  ),
  isPublished: z.boolean(),
  updatedAt: z.iso.datetime().nullable(),
});
export type DailyMenu = z.infer<typeof dailyMenuSchema>;

export const dailyMenuResponseSchema = z.object({ menu: dailyMenuSchema });

const menuOptionsInputSchema = z
  .array(z.strictObject({ name: menuTextSchema.min(1), isAvailable: z.boolean().default(true) }))
  .max(MENU_OPTIONS_MAX)
  .default([])
  .refine(
    (options) =>
      new Set(options.map((option) => option.name.toLocaleLowerCase('es'))).size === options.length,
    { message: 'Hay una opción repetida' },
  );

export const upsertDailyMenuRequestSchema = z.strictObject({
  soups: menuOptionsInputSchema,
  principles: menuOptionsInputSchema,
  proteins: menuOptionsInputSchema,
  drinks: menuOptionsInputSchema,
  notes: z.string().trim().max(300).default(''),
  offerings: z
    .array(dailyMenuOfferingSchema.extend({ withChoices: z.boolean().default(true) }).strict())
    .max(10)
    .default([])
    .refine(
      (offerings) =>
        new Set(offerings.map((offering) => offering.productId)).size === offerings.length,
      { message: 'Un producto está repetido en el menú' },
    ),
  isPublished: z.boolean().default(false),
});
export type UpsertDailyMenuRequest = z.input<typeof upsertDailyMenuRequestSchema>;

// ── Elección del almuerzo al vender ────────────────────────────────

/** Lo que el cliente pide del almuerzo: proteína, principio y (si quiere) sopa y bebida. */
export const lunchChoiceSchema = z.strictObject({
  protein: menuTextSchema.min(1, 'Elige la proteína'),
  principle: menuTextSchema.min(1, 'Elige el principio'),
  /** null = sin sopa. */
  soup: menuTextSchema.min(1).nullable(),
  /** null = sin bebida. */
  drink: menuTextSchema.min(1).nullable(),
});
export type LunchChoice = z.infer<typeof lunchChoiceSchema>;

/** Texto de la elección para la cuenta, la comanda y el tiquete. */
export function lunchChoiceLabel(choice: LunchChoice): string {
  return [
    choice.protein,
    choice.principle,
    choice.soup ?? 'Sin sopa',
    choice.drink ?? 'Sin bebida',
  ].join(' · ');
}

// ── Carga masiva y cambio de precios ───────────────────────────────

export const PRODUCT_IMPORT_MAX_ROWS = 800;

/**
 * Una fila del CSV de productos. Los productos se buscan por nombre: si existe se actualiza
 * lo que traiga la fila (precio, costo, subcategoría, stock mínimo); si no existe, se crea en
 * su categoría solo si se pidió y trae precio.
 */
export const productImportRowSchema = z.strictObject({
  name: catalogNameSchema,
  category: z.string().trim().max(60).default(''),
  subcategory: subcategorySchema.optional(),
  price: priceSchema.optional(),
  cost: costSchema.optional(),
  minStock: z.int().min(0).max(10_000).optional(),
});
export type ProductImportRow = z.input<typeof productImportRowSchema>;

export const importProductsRequestSchema = z.strictObject({
  rows: z
    .array(productImportRowSchema)
    .min(1, 'El archivo no tiene filas')
    .max(PRODUCT_IMPORT_MAX_ROWS, `Máximo ${String(PRODUCT_IMPORT_MAX_ROWS)} filas por carga`),
  /** Crear los productos que no existen (en la categoría de la fila). */
  createMissing: z.boolean().default(false),
  /** true = solo muestra lo que haría, sin guardar nada. */
  dryRun: z.boolean().default(true),
});
export type ImportProductsRequest = z.input<typeof importProductsRequestSchema>;

export const importProductsResultSchema = z.object({
  dryRun: z.boolean(),
  created: z.int(),
  updated: z.int(),
  unchanged: z.int(),
  skipped: z.array(z.object({ row: z.int(), name: z.string(), reason: z.string() })),
  /** Cambios de las primeras filas, para revisarlos antes de aplicar. */
  changes: z.array(z.object({ name: z.string(), detail: z.string() })),
});
export type ImportProductsResult = z.infer<typeof importProductsResultSchema>;

export const BULK_PRICE_ROUNDING = [50, 100, 500] as const;

/** Subir o bajar en un porcentaje los precios de una categoría, redondeando a 50, 100 o 500. */
export const bulkPriceRequestSchema = z.strictObject({
  categoryId: objectIdSchema,
  percent: z
    .int('El porcentaje es un número entero')
    .min(-50, 'Máximo bajar 50 %')
    .max(200, 'Máximo subir 200 %')
    .refine((value) => value !== 0, 'El porcentaje no puede ser 0'),
  roundTo: z.union([z.literal(50), z.literal(100), z.literal(500)]).default(100),
  dryRun: z.boolean().default(true),
});
export type BulkPriceRequest = z.input<typeof bulkPriceRequestSchema>;

export const bulkPriceResultSchema = z.object({
  dryRun: z.boolean(),
  items: z.array(z.object({ productId: z.string(), name: z.string(), from: z.int(), to: z.int() })),
});
export type BulkPriceResult = z.infer<typeof bulkPriceResultSchema>;

/** Máximo de productos que se mueven de categoría en una sola acción. */
export const PRODUCT_BULK_MOVE_MAX = 500;

/**
 * Mover varios productos a otra categoría (para corregir lo que quedó mal al cargar el
 * inventario). La subcategoría se reemplaza por la que se indique (vacía = sin subcategoría).
 */
export const bulkMoveProductsRequestSchema = z.strictObject({
  productIds: z
    .array(objectIdSchema)
    .min(1, 'Elige al menos un producto')
    .max(PRODUCT_BULK_MOVE_MAX, `Máximo ${String(PRODUCT_BULK_MOVE_MAX)} productos a la vez`),
  categoryId: objectIdSchema,
  subcategory: subcategorySchema.default(''),
});
export type BulkMoveProductsRequest = z.input<typeof bulkMoveProductsRequestSchema>;

export const bulkMoveProductsResultSchema = z.object({
  moved: z.int(),
  /** Los que ya estaban en esa categoría con esa subcategoría. */
  unchanged: z.int(),
});
export type BulkMoveProductsResult = z.infer<typeof bulkMoveProductsResultSchema>;

/** Nuevo precio con el porcentaje aplicado y redondeado (nunca por debajo del mínimo). */
export function adjustedPrice(price: number, percent: number, roundTo: number): number {
  const raw = price * (1 + percent / 100);
  return Math.max(PRICE_LIMITS.min, Math.round(raw / roundTo) * roundTo);
}
