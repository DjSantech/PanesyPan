import {
  BUSINESS_NAME,
  toBusinessDate,
  type PublicBusinessResponse,
  type PublicCatalogResponse,
  type PublicCategory,
  type PublicDailyMenuResponse,
  type PublicMenuItem,
} from '@panesypan/shared';
import { trusted } from 'mongoose';
import { CategoryModel, DailyMenuModel, ProductModel } from '../catalog/catalog.models';
import { productImagePath } from '../catalog/catalog.service';
import { menuOptionsOf } from '../catalog/daily-menu.service';
import { getSettings } from '../settings/settings.service';

const bySortOrderThenName = (
  a: { sortOrder: number; name: string },
  b: { sortOrder: number; name: string },
) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, 'es');

const validPrice = (price: unknown): number | null =>
  typeof price === 'number' && Number.isSafeInteger(price) && price >= 0 ? price : null;

/** Catálogo de la web: productos activos y visibles de categorías activas que no son de almuerzos. */
export async function getPublicCatalog(): Promise<PublicCatalogResponse> {
  const categories = await CategoryModel.find({
    isActive: true,
    kind: trusted({ $ne: 'LUNCH' }),
  }).lean();
  const products = await ProductModel.find({
    isActive: true,
    isVisibleOnline: true,
    categoryId: trusted({ $in: categories.map((category) => category._id) }),
  }).lean();

  const result: PublicCategory[] = [];
  for (const category of [...categories].sort(bySortOrderThenName)) {
    const own = products
      .filter((product) => product.categoryId.equals(category._id))
      .filter((product) => validPrice(product.price) !== null)
      .sort(bySortOrderThenName);
    if (own.length === 0) continue;
    result.push({
      slug: category.slug,
      name: category.name,
      products: own.map((product) => ({
        id: product._id.toString(),
        slug: product.slug,
        name: product.name,
        description: product.description,
        price: product.price,
        isAvailable: product.isAvailable,
        imageUrl: product.image ? productImagePath(product.image) : null,
      })),
    });
  }
  return { categories: result };
}

/** Menú del día de hoy; null si no existe o no está publicado. */
export async function getPublicDailyMenu(now = new Date()): Promise<PublicDailyMenuResponse> {
  const date = toBusinessDate(now);
  const menu = await DailyMenuModel.findOne({ date });
  if (!menu?.isPublished) return { date, menu: null };

  const ids = menu.offerings.map((offering) => offering.productId);
  const products = await ProductModel.find({ _id: trusted({ $in: ids }), isActive: true }).lean();
  const byId = new Map(products.map((product) => [product._id.toString(), product]));

  const items: PublicMenuItem[] = [];
  for (const offering of menu.offerings) {
    const product = byId.get(offering.productId.toString());
    if (product === undefined) continue;
    items.push({
      productId: product._id.toString(),
      name: product.name,
      price: validPrice(product.price),
      withChoices: offering.withChoices,
      soldOut: offering.portions !== null && offering.sold >= offering.portions,
    });
  }

  const options = menuOptionsOf(menu);
  const plain = (list: { name: string; isAvailable: boolean }[]) =>
    list.map(({ name, isAvailable }) => ({ name, isAvailable }));
  return {
    date,
    menu: {
      soups: plain(options.soups),
      principles: plain(options.principles),
      proteins: plain(options.proteins),
      drinks: plain(options.drinks),
      notes: menu.notes,
      items,
    },
  };
}

/** Datos públicos del negocio (Ajustes). */
export async function getPublicBusiness(): Promise<PublicBusinessResponse> {
  const settings = await getSettings();
  return { name: BUSINESS_NAME, address: settings.address, phone: settings.phone };
}
