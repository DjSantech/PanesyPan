import {
  PRODUCT_IMAGE_MAX_BYTES,
  slugify,
  type Category,
  type CreateCategoryRequest,
  type CreateProductRequest,
  type ListProductsQuery,
  type Product,
  type ProductImageType,
  type UpdateCategoryRequest,
  type UpdateProductRequest,
} from '@panesypan/shared';
import { mongo, trusted, Types, type QueryFilter } from 'mongoose';
import { AppError } from '../../lib/errors';
import { escapeRegex } from '../../lib/regex';
import { recordAudit } from '../audit/audit.service';
import { toAuditActor } from '../users/users.mapper';
import type { ActorContext } from '../users/users.service';
import {
  CategoryModel,
  ProductImageModel,
  ProductModel,
  type CategoryDocument,
  type ProductAttrs,
  type ProductDocument,
} from './catalog.models';

const conflict = (message: string): AppError => new AppError(409, 'CONFLICT', message);
const notFound = (what: string): AppError =>
  new AppError(404, 'NOT_FOUND', `${what} no encontrado`);

const isDuplicateKey = (error: unknown): boolean =>
  error instanceof mongo.MongoServerError && error.code === 11000;

const categoryEntity = (category: CategoryDocument) => ({
  type: 'CATEGORY',
  id: category.id,
  label: category.name,
});
const productEntity = (product: ProductDocument) => ({
  type: 'PRODUCT',
  id: product.id,
  label: product.name,
});

function audit(
  ctx: ActorContext,
  entry: Omit<Parameters<typeof recordAudit>[0], 'actor' | 'meta'>,
) {
  return recordAudit({ ...entry, actor: toAuditActor(ctx.actor), meta: ctx.meta }, ctx.logger);
}

// ── Mapeo a DTO ────────────────────────────────────────────────────

export function toCategoryDto(category: CategoryDocument, productCount = 0): Category {
  return {
    id: category.id,
    name: category.name,
    slug: category.slug,
    kind: category.kind,
    sortOrder: category.sortOrder,
    isActive: category.isActive,
    productCount,
  };
}

const IMAGE_EXTENSIONS: Readonly<Record<ProductImageType, string>> = {
  'image/webp': 'webp',
  'image/jpeg': 'jpg',
  'image/png': 'png',
};

/**
 * Ruta pública de la imagen. Lleva la extensión para que Cloudflare la guarde en caché, y el id
 * cambia con cada subida, así nunca se sirve una imagen vieja.
 */
export const productImagePath = (image: { id: Types.ObjectId; contentType: ProductImageType }) =>
  `/api/v1/public/images/${image.id.toString()}.${IMAGE_EXTENSIONS[image.contentType]}`;

export function toProductDto(product: ProductDocument): Product {
  return {
    id: product.id,
    name: product.name,
    slug: product.slug,
    categoryId: product.categoryId.toString(),
    price: product.price,
    isAvailable: product.isAvailable,
    isFavorite: product.isFavorite,
    trackStock: product.trackStock,
    tax: product.tax ?? null,
    description: product.description,
    imagePath: product.image === null ? null : productImagePath(product.image),
    isVisibleOnline: product.isVisibleOnline,
    isActive: product.isActive,
    sortOrder: product.sortOrder,
    updatedAt: product.updatedAt.toISOString(),
  };
}

// ── Categorías ─────────────────────────────────────────────────────

async function findCategoryOrThrow(id: string): Promise<CategoryDocument> {
  const category = await CategoryModel.findById(id);
  if (category === null) throw notFound('Categoría');
  return category;
}

export async function listCategories(includeInactive: boolean): Promise<Category[]> {
  const categories = await CategoryModel.find(includeInactive ? {} : { isActive: true }).sort({
    sortOrder: 1,
    name: 1,
  });
  const counts = await ProductModel.aggregate<{ _id: Types.ObjectId; count: number }>([
    { $match: { isActive: true } },
    { $group: { _id: '$categoryId', count: { $sum: 1 } } },
  ]);
  const countById = new Map(counts.map((row) => [row._id.toString(), row.count]));
  return categories.map((category) => toCategoryDto(category, countById.get(category.id) ?? 0));
}

export async function createCategory(
  input: CreateCategoryRequest,
  ctx: ActorContext,
): Promise<Category> {
  const slug = slugify(input.name);
  if ((await CategoryModel.exists({ slug })) !== null) {
    throw conflict('Ya existe una categoría con ese nombre');
  }
  const last = await CategoryModel.findOne().sort({ sortOrder: -1 });
  let category: CategoryDocument;
  try {
    category = await CategoryModel.create({
      name: input.name,
      slug,
      kind: input.kind ?? 'STANDARD',
      sortOrder: (last?.sortOrder ?? 0) + 1,
    });
  } catch (error) {
    if (isDuplicateKey(error)) throw conflict('Ya existe una categoría con ese nombre');
    throw error;
  }
  await audit(ctx, { action: 'CATEGORY_CREATED', entity: categoryEntity(category) });
  return toCategoryDto(category);
}

export async function updateCategory(
  id: string,
  input: UpdateCategoryRequest,
  ctx: ActorContext,
): Promise<Category> {
  const category = await findCategoryOrThrow(id);
  const changes: Record<string, { from: unknown; to: unknown }> = {};

  if (input.name !== undefined && input.name !== category.name) {
    const slug = slugify(input.name);
    if ((await CategoryModel.exists({ slug, _id: trusted({ $ne: category._id }) })) !== null) {
      throw conflict('Ya existe una categoría con ese nombre');
    }
    changes.name = { from: category.name, to: input.name };
    category.name = input.name;
    category.slug = slug;
  }
  if (input.kind !== undefined && input.kind !== category.kind) {
    changes.kind = { from: category.kind, to: input.kind };
    category.kind = input.kind;
  }
  if (input.isActive !== undefined && input.isActive !== category.isActive) {
    changes.isActive = { from: category.isActive, to: input.isActive };
    category.isActive = input.isActive;
  }
  if (Object.keys(changes).length === 0) return toCategoryDto(category);

  await category.save();
  await audit(ctx, {
    action: 'CATEGORY_UPDATED',
    entity: categoryEntity(category),
    metadata: { changes },
  });
  return toCategoryDto(category);
}

/** Guarda el orden en que se muestran las categorías en el POS. */
export async function reorderCategories(ids: string[], ctx: ActorContext): Promise<Category[]> {
  const unique = new Set(ids);
  if (unique.size !== ids.length)
    throw new AppError(400, 'VALIDATION_ERROR', 'Hay categorías repetidas');
  const found = await CategoryModel.countDocuments({
    _id: trusted({ $in: ids.map((id) => new Types.ObjectId(id)) }),
  });
  if (found !== ids.length) throw notFound('Categoría');

  await CategoryModel.bulkWrite(
    ids.map((id, index) => ({
      updateOne: {
        filter: { _id: new Types.ObjectId(id) },
        update: { $set: { sortOrder: index + 1 } },
      },
    })),
  );
  await recordAudit(
    {
      action: 'CATEGORY_UPDATED',
      actor: toAuditActor(ctx.actor),
      metadata: { reordered: ids.length },
      meta: ctx.meta,
    },
    ctx.logger,
  );
  return listCategories(true);
}

// ── Productos ──────────────────────────────────────────────────────

async function findProductOrThrow(id: string): Promise<ProductDocument> {
  const product = await ProductModel.findById(id);
  if (product === null) throw notFound('Producto');
  return product;
}

async function ensureProductSlugAvailable(slug: string, excludeId?: Types.ObjectId): Promise<void> {
  const filter: QueryFilter<ProductAttrs> =
    excludeId === undefined ? { slug } : { slug, _id: trusted({ $ne: excludeId }) };
  if ((await ProductModel.exists(filter)) !== null) {
    throw conflict('Ya existe un producto con ese nombre');
  }
}

export async function listProducts(query: ListProductsQuery): Promise<Product[]> {
  const filter: QueryFilter<ProductAttrs> = {};
  if (query.status !== 'all') filter.isActive = query.status === 'active';
  if (query.categoryId !== undefined) filter.categoryId = new Types.ObjectId(query.categoryId);
  if (query.search !== undefined && query.search.length > 0) {
    // Busca sin tildes: "almojabana" encuentra "Almojábana".
    filter.slug = new RegExp(escapeRegex(slugify(query.search)), 'i');
  }
  const products = await ProductModel.find(filter).sort({ sortOrder: 1, name: 1 }).limit(1_000);
  return products.map(toProductDto);
}

export async function getProduct(id: string): Promise<Product> {
  return toProductDto(await findProductOrThrow(id));
}

export async function createProduct(
  input: CreateProductRequest,
  ctx: ActorContext,
): Promise<Product> {
  const category = await findCategoryOrThrow(input.categoryId);
  if (!category.isActive) throw conflict('La categoría está desactivada');
  const slug = slugify(input.name);
  await ensureProductSlugAvailable(slug);

  let product: ProductDocument;
  try {
    product = await ProductModel.create({
      name: input.name,
      slug,
      categoryId: category._id,
      price: input.price,
      isAvailable: input.isAvailable ?? true,
      isFavorite: input.isFavorite ?? false,
      trackStock: input.trackStock ?? false,
      tax: input.tax ?? null,
      description: input.description ?? '',
      isVisibleOnline: input.isVisibleOnline ?? true,
    });
  } catch (error) {
    if (isDuplicateKey(error)) throw conflict('Ya existe un producto con ese nombre');
    throw error;
  }
  await audit(ctx, {
    action: 'PRODUCT_CREATED',
    entity: productEntity(product),
    metadata: { price: product.price, category: category.name },
  });
  return toProductDto(product);
}

export async function updateProduct(
  id: string,
  input: UpdateProductRequest,
  ctx: ActorContext,
): Promise<Product> {
  const product = await findProductOrThrow(id);
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  const previousPrice = product.price;

  if (input.name !== undefined && input.name !== product.name) {
    const slug = slugify(input.name);
    await ensureProductSlugAvailable(slug, product._id);
    changes.name = { from: product.name, to: input.name };
    product.name = input.name;
    product.slug = slug;
  }
  if (input.categoryId !== undefined && input.categoryId !== product.categoryId.toString()) {
    const category = await findCategoryOrThrow(input.categoryId);
    changes.category = { from: product.categoryId.toString(), to: category.name };
    product.categoryId = category._id;
  }
  if (input.price !== undefined && input.price !== product.price) {
    product.price = input.price;
  }
  for (const field of ['isFavorite', 'trackStock', 'isActive', 'isVisibleOnline'] as const) {
    const value = input[field];
    if (value !== undefined && value !== product[field]) {
      changes[field] = { from: product[field], to: value };
      product[field] = value;
    }
  }
  if (input.description !== undefined && input.description !== product.description) {
    changes.description = { from: product.description, to: input.description };
    product.description = input.description;
  }
  if (input.tax !== undefined && input.tax !== (product.tax ?? null)) {
    changes.tax = { from: product.tax ?? null, to: input.tax };
    product.tax = input.tax;
  }

  const priceChanged = previousPrice !== product.price;
  if (Object.keys(changes).length === 0 && !priceChanged) return toProductDto(product);

  try {
    await product.save();
  } catch (error) {
    if (isDuplicateKey(error)) throw conflict('Ya existe un producto con ese nombre');
    throw error;
  }

  // El cambio de precio queda como evento propio: es lo que más se revisa en la auditoría.
  if (priceChanged) {
    await audit(ctx, {
      action: 'PRODUCT_PRICE_CHANGED',
      entity: productEntity(product),
      metadata: { changes: { price: { from: previousPrice, to: product.price } } },
    });
  }
  if (Object.keys(changes).length > 0) {
    await audit(ctx, {
      action: 'PRODUCT_UPDATED',
      entity: productEntity(product),
      metadata: { changes },
    });
  }
  return toProductDto(product);
}

/** Marca un producto como disponible o agotado (lo puede hacer la cajera). */
export async function setProductAvailability(
  id: string,
  isAvailable: boolean,
  ctx: ActorContext,
): Promise<Product> {
  const product = await findProductOrThrow(id);
  if (product.isAvailable === isAvailable) return toProductDto(product);
  product.isAvailable = isAvailable;
  await product.save();
  await audit(ctx, {
    action: 'PRODUCT_AVAILABILITY_CHANGED',
    entity: productEntity(product),
    metadata: { isAvailable },
  });
  return toProductDto(product);
}

// ── Imágenes ───────────────────────────────────────────────────────

/**
 * Tipo real de la imagen según sus primeros bytes (nunca se confía en el Content-Type que
 * manda el navegador). Solo WebP, JPEG y PNG: nada de SVG, que puede llevar código.
 */
export function detectImageType(data: Buffer): ProductImageType | null {
  if (data.length >= 12 && data.toString('ascii', 0, 4) === 'RIFF') {
    return data.toString('ascii', 8, 12) === 'WEBP' ? 'image/webp' : null;
  }
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) {
    return 'image/jpeg';
  }
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (data.length >= 8 && png.every((byte, index) => data[index] === byte)) return 'image/png';
  return null;
}

/** Guarda la imagen nueva del producto y borra la anterior. */
export async function setProductImage(
  id: string,
  data: Buffer,
  ctx: ActorContext,
): Promise<Product> {
  const product = await findProductOrThrow(id);
  if (data.length === 0 || data.length > PRODUCT_IMAGE_MAX_BYTES) {
    throw new AppError(400, 'VALIDATION_ERROR', 'La imagen debe pesar máximo 2 MB.');
  }
  const contentType = detectImageType(data);
  if (contentType === null) {
    throw new AppError(400, 'VALIDATION_ERROR', 'La imagen debe ser JPG, PNG o WebP.');
  }
  const previous = product.image;
  const image = await ProductImageModel.create({
    productId: product._id,
    contentType,
    data,
    size: data.length,
  });
  product.image = { id: image._id, contentType };
  await product.save();
  if (previous !== null) await ProductImageModel.deleteOne({ _id: previous.id });

  await audit(ctx, {
    action: 'PRODUCT_UPDATED',
    entity: productEntity(product),
    metadata: {
      changes: { image: { from: previous === null ? 'sin imagen' : 'imagen', to: 'nueva imagen' } },
    },
  });
  return toProductDto(product);
}

export async function removeProductImage(id: string, ctx: ActorContext): Promise<Product> {
  const product = await findProductOrThrow(id);
  const previous = product.image;
  if (previous === null) return toProductDto(product);
  product.image = null;
  await product.save();
  await ProductImageModel.deleteOne({ _id: previous.id });
  await audit(ctx, {
    action: 'PRODUCT_UPDATED',
    entity: productEntity(product),
    metadata: { changes: { image: { from: 'imagen', to: 'sin imagen' } } },
  });
  return toProductDto(product);
}

/** Imagen pública por su nombre de archivo ("<id>.webp"); null si no existe. */
export async function findPublicImage(
  file: string,
): Promise<{ contentType: ProductImageType; data: Buffer } | null> {
  const match = /^([a-f\d]{24})\.(webp|jpg|png)$/.exec(file);
  if (match?.[1] === undefined) return null;
  const image = await ProductImageModel.findById(match[1]).select('contentType data');
  return image === null ? null : { contentType: image.contentType, data: image.data };
}
