import { slugify, type CategoryKind } from '@panesypan/shared';
import { CategoryModel, ProductModel } from './catalog.models';

interface SeedProduct {
  name: string;
  price: number;
  favorite?: boolean;
}

interface SeedCategory {
  name: string;
  kind: CategoryKind;
  products: SeedProduct[];
}

/**
 * Catálogo inicial tomado de las listas de precios de la panadería.
 * Los "Productos de queso" llevan precios GENÉRICOS provisionales: el administrador los ajusta.
 * Los tamaños (grande / pequeño) son productos separados.
 */
export const CATALOG_SEED: readonly SeedCategory[] = [
  {
    name: 'Panadería',
    kind: 'STANDARD',
    products: [
      { name: 'Pan Gallego', price: 3_000 },
      { name: 'Pan Coco', price: 800, favorite: true },
      { name: 'Pan Leche', price: 800, favorite: true },
      { name: 'Pan Hojaldrado', price: 800 },
      { name: 'Quesadilla', price: 2_000 },
      { name: 'Pan Abuela', price: 3_000 },
      { name: 'Pan Galleta', price: 3_000 },
      { name: 'Croissant', price: 3_000, favorite: true },
      { name: 'Hawaiano', price: 4_000 },
      { name: 'Pan Holandés', price: 5_000 },
      { name: 'Pan Napolitano', price: 5_000 },
      { name: 'Achira', price: 800 },
      { name: 'Palitos de Queso', price: 1_000 },
      { name: 'Deditos de Queso Hojaldrado', price: 2_500 },
      { name: 'Palmeritas de Hojaldre', price: 3_000 },
      { name: 'Pañuelos', price: 3_500 },
      { name: 'Chicharrón', price: 3_500 },
      { name: 'Pan Integral', price: 1_000 },
      { name: 'Mogolla Integral', price: 1_000 },
    ],
  },
  {
    name: 'Productos de queso',
    kind: 'STANDARD',
    products: [
      { name: 'Rosca Montañera', price: 3_000 },
      { name: 'Pan de Bono', price: 2_000, favorite: true },
      { name: 'Almojábana', price: 2_000, favorite: true },
      { name: 'Empanada de Cambray', price: 2_500 },
      { name: 'Buñuelo', price: 1_500, favorite: true },
      { name: 'Rosca de Pan de Bono', price: 3_000 },
    ],
  },
  {
    name: 'Aliñados',
    kind: 'STANDARD',
    products: [
      { name: 'Pan Queso grande', price: 10_000 },
      { name: 'Pan Queso pequeño', price: 6_000 },
      { name: 'Pan Panocha', price: 10_000 },
      { name: 'Pan 3 Quesos', price: 8_000 },
      { name: 'Pan Jamón y Queso', price: 5_000 },
      { name: 'Pan Brevas y Arequipe', price: 5_000 },
      { name: 'Pan Doble Queso', price: 4_000 },
      { name: 'Pan Costeño grande', price: 6_000 },
      { name: 'Pan Costeño pequeño', price: 5_000 },
      { name: 'Pan Aliñado grande', price: 3_000 },
      { name: 'Pan Aliñado pequeño', price: 2_000 },
      { name: 'Pan Aliñado sencillo', price: 1_000 },
      { name: 'Pan de Arequipe', price: 1_200 },
    ],
  },
  { name: 'Bebidas', kind: 'STANDARD', products: [] },
  { name: 'Almuerzos', kind: 'LUNCH', products: [] },
  { name: 'Caldos', kind: 'STANDARD', products: [] },
];

export interface SeedResult {
  categoriesCreated: number;
  productsCreated: number;
  productsSkipped: number;
}

/**
 * Carga el catálogo inicial. Es seguro ejecutarlo varias veces: solo crea lo que no existe
 * (compara por nombre), así nunca pisa precios o cambios hechos por el administrador.
 */
export async function seedCatalog(
  seed: readonly SeedCategory[] = CATALOG_SEED,
): Promise<SeedResult> {
  const result: SeedResult = { categoriesCreated: 0, productsCreated: 0, productsSkipped: 0 };

  for (const [categoryIndex, seedCategory] of seed.entries()) {
    const slug = slugify(seedCategory.name);
    let category = await CategoryModel.findOne({ slug });
    if (category === null) {
      category = await CategoryModel.create({
        name: seedCategory.name,
        slug,
        kind: seedCategory.kind,
        sortOrder: categoryIndex + 1,
      });
      result.categoriesCreated += 1;
    }

    for (const [productIndex, seedProduct] of seedCategory.products.entries()) {
      const productSlug = slugify(seedProduct.name);
      if ((await ProductModel.exists({ slug: productSlug })) !== null) {
        result.productsSkipped += 1;
        continue;
      }
      await ProductModel.create({
        name: seedProduct.name,
        slug: productSlug,
        categoryId: category._id,
        price: seedProduct.price,
        isFavorite: seedProduct.favorite ?? false,
        sortOrder: productIndex + 1,
      });
      result.productsCreated += 1;
    }
  }
  return result;
}
