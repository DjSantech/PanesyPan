import {
  categoryResponseSchema,
  dailyMenuResponseSchema,
  listCategoriesResponseSchema,
  listProductsResponseSchema,
  productResponseSchema,
  type Category,
  type CreateCategoryRequest,
  type CreateProductRequest,
  type DailyMenu,
  type ListProductsQuery,
  type Product,
  type UpdateCategoryRequest,
  type UpdateProductRequest,
  type UpsertDailyMenuRequest,
} from '@panesypan/shared';
import { apiJson, getApiBaseUrl } from '@/lib/api-client';

export const catalogKeys = {
  all: ['catalog'] as const,
  categories: (all: boolean) => ['catalog', 'categories', all] as const,
  products: (query: Partial<ListProductsQuery>) => ['catalog', 'products', query] as const,
  dailyMenu: (date: string) => ['catalog', 'daily-menu', date] as const,
};

export async function listCategories(all: boolean, signal?: AbortSignal): Promise<Category[]> {
  const { items } = await apiJson(
    `/api/v1/categories${all ? '?all=true' : ''}`,
    listCategoriesResponseSchema,
    { signal },
  );
  return items;
}

export async function createCategory(input: CreateCategoryRequest): Promise<Category> {
  const { category } = await apiJson('/api/v1/categories', categoryResponseSchema, {
    method: 'POST',
    body: input,
  });
  return category;
}

export async function updateCategory(id: string, input: UpdateCategoryRequest): Promise<Category> {
  const { category } = await apiJson(`/api/v1/categories/${id}`, categoryResponseSchema, {
    method: 'PATCH',
    body: input,
  });
  return category;
}

export async function reorderCategories(ids: string[]): Promise<Category[]> {
  const { items } = await apiJson('/api/v1/categories/order', listCategoriesResponseSchema, {
    method: 'PUT',
    body: { ids },
  });
  return items;
}

export async function listProducts(
  query: Partial<ListProductsQuery>,
  signal?: AbortSignal,
): Promise<Product[]> {
  const params = new URLSearchParams();
  if (query.status !== undefined) params.set('status', query.status);
  if (query.categoryId !== undefined) params.set('categoryId', query.categoryId);
  if (query.search !== undefined && query.search.trim() !== '')
    params.set('search', query.search.trim());
  const suffix = params.size > 0 ? `?${params.toString()}` : '';
  const { items } = await apiJson(`/api/v1/products${suffix}`, listProductsResponseSchema, {
    signal,
  });
  return items;
}

export async function createProduct(input: CreateProductRequest): Promise<Product> {
  const { product } = await apiJson('/api/v1/products', productResponseSchema, {
    method: 'POST',
    body: input,
  });
  return product;
}

export async function updateProduct(id: string, input: UpdateProductRequest): Promise<Product> {
  const { product } = await apiJson(`/api/v1/products/${id}`, productResponseSchema, {
    method: 'PATCH',
    body: input,
  });
  return product;
}

/** Sube la imagen del producto (ya reducida en el navegador). */
export async function uploadProductImage(id: string, image: Blob): Promise<Product> {
  const { product } = await apiJson(`/api/v1/products/${id}/image`, productResponseSchema, {
    method: 'POST',
    rawBody: image,
  });
  return product;
}

export async function deleteProductImage(id: string): Promise<Product> {
  const { product } = await apiJson(`/api/v1/products/${id}/image`, productResponseSchema, {
    method: 'DELETE',
  });
  return product;
}

/** URL completa de la imagen de un producto (la API devuelve solo la ruta). */
export function productImageUrl(imagePath: string | null): string | null {
  if (imagePath === null) return null;
  // Las fotos en Cloudinary llegan con URL completa; las antiguas, con ruta de la API.
  return imagePath.startsWith('https://') ? imagePath : `${getApiBaseUrl()}${imagePath}`;
}

export async function setProductAvailability(id: string, isAvailable: boolean): Promise<Product> {
  const { product } = await apiJson(`/api/v1/products/${id}/availability`, productResponseSchema, {
    method: 'PATCH',
    body: { isAvailable },
  });
  return product;
}

export async function getDailyMenu(date: string, signal?: AbortSignal): Promise<DailyMenu> {
  const { menu } = await apiJson(`/api/v1/daily-menus/${date}`, dailyMenuResponseSchema, {
    signal,
  });
  return menu;
}

export async function saveDailyMenu(
  date: string,
  input: UpsertDailyMenuRequest,
): Promise<DailyMenu> {
  const { menu } = await apiJson(`/api/v1/daily-menus/${date}`, dailyMenuResponseSchema, {
    method: 'PUT',
    body: input,
  });
  return menu;
}
