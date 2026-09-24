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
const descriptionSchema = z
  .string()
  .trim()
  .max(PRODUCT_DESCRIPTION_MAX, `Máximo ${String(PRODUCT_DESCRIPTION_MAX)} caracteres`);

/** Imágenes de producto: el navegador las reduce antes de subirlas; este es el tope del servidor. */
export const PRODUCT_IMAGE_TYPES = ['image/webp', 'image/jpeg', 'image/png'] as const;
export type ProductImageType = (typeof PRODUCT_IMAGE_TYPES)[number];
export const PRODUCT_IMAGE_MAX_BYTES = 2 * 1024 * 1024;

/** Precio final en pesos (ya incluye impuestos). */
export const priceSchema = z
  .int('El precio debe ser un número entero de pesos')
  .min(PRICE_LIMITS.min, `El precio mínimo es $ ${String(PRICE_LIMITS.min)}`)
  .max(PRICE_LIMITS.max, 'El precio es demasiado alto');

export const productSchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  categoryId: z.string(),
  price: z.int(),
  isAvailable: z.boolean(),
  isFavorite: z.boolean(),
  trackStock: z.boolean(),
  /** Impuesto del producto; null = el impuesto general de Ajustes. */
  tax: z.enum(TAX_CODES).nullable(),
  description: z.string(),
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
  price: priceSchema,
  isAvailable: z.boolean().default(true),
  isFavorite: z.boolean().default(false),
  trackStock: z.boolean().default(false),
  tax: z.enum(TAX_CODES).nullable().default(null),
  description: descriptionSchema.default(''),
  isVisibleOnline: z.boolean().default(true),
  /** Unidades con las que arranca el inventario (solo si controla inventario). */
  initialStock: z
    .int('El stock debe ser un número entero')
    .min(0, 'El stock no puede ser negativo')
    .max(10_000, 'El stock es demasiado alto')
    .nullable()
    .default(null),
});
export type CreateProductRequest = z.input<typeof createProductRequestSchema>;

export const updateProductRequestSchema = z
  .strictObject({
    name: catalogNameSchema.optional(),
    categoryId: objectIdSchema.optional(),
    price: priceSchema.optional(),
    isFavorite: z.boolean().optional(),
    trackStock: z.boolean().optional(),
    tax: z.enum(TAX_CODES).nullable().optional(),
    description: descriptionSchema.optional(),
    isVisibleOnline: z.boolean().optional(),
    isActive: z.boolean().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, { message: 'No hay cambios para guardar' });
export type UpdateProductRequest = z.infer<typeof updateProductRequestSchema>;

export const setAvailabilityRequestSchema = z.strictObject({ isAvailable: z.boolean() });

// ── Menú del día (almuerzos) ───────────────────────────────────────

const menuTextSchema = z.string().trim().max(120);

export const dailyMenuOfferingSchema = z.object({
  productId: objectIdSchema,
  /** Porciones preparadas; `null` = sin límite. */
  portions: z.int().min(0).max(1_000).nullable(),
});

export const dailyMenuSchema = z.object({
  date: businessDateSchema,
  soup: z.string(),
  principle: z.string(),
  proteins: z.array(z.object({ name: z.string(), isAvailable: z.boolean() })),
  sides: z.array(z.string()),
  juice: z.string(),
  notes: z.string(),
  offerings: z.array(
    dailyMenuOfferingSchema.extend({ name: z.string(), price: z.int(), sold: z.int() }),
  ),
  isPublished: z.boolean(),
  updatedAt: z.iso.datetime().nullable(),
});
export type DailyMenu = z.infer<typeof dailyMenuSchema>;

export const dailyMenuResponseSchema = z.object({ menu: dailyMenuSchema });

export const upsertDailyMenuRequestSchema = z.strictObject({
  soup: menuTextSchema.default(''),
  principle: menuTextSchema.default(''),
  proteins: z
    .array(z.strictObject({ name: menuTextSchema.min(1), isAvailable: z.boolean().default(true) }))
    .max(10)
    .default([]),
  sides: z.array(menuTextSchema.min(1)).max(10).default([]),
  juice: menuTextSchema.default(''),
  notes: z.string().trim().max(300).default(''),
  offerings: z
    .array(dailyMenuOfferingSchema.strict())
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
