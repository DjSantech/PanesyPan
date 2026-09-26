import { z } from 'zod';

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
    juice: z.string(),
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
