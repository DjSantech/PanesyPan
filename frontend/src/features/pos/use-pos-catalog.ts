import { toBusinessDate, type Category, type DailyMenu, type PriceTier } from '@panesypan/shared';
import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { catalogKeys, getDailyMenu, listCategories, listProducts } from '../catalog/catalog.api';

export interface PosProduct {
  id: string;
  name: string;
  price: number;
  /** Precios por cantidad (los almuerzos no tienen). */
  priceTiers: PriceTier[];
  categoryId: string;
  isAvailable: boolean;
  isFavorite: boolean;
  isLunch: boolean;
  /** Código de barras o interno: la caja lo busca con el lector. */
  code: string | null;
  /** Almuerzo del menú: al venderlo se elige proteína, principio y sopa. */
  withChoices: boolean;
  /** Foto de referencia para quien vende (null = sin foto). */
  imagePath: string | null;
  /** Porciones que quedan hoy (solo almuerzos con límite). */
  portionsLeft: number | null;
  sortOrder: number;
}

/**
 * Catálogo tal como lo ve el punto de venta: productos activos de categorías activas.
 * Los almuerzos solo aparecen si están en el menú publicado de hoy.
 */
export function usePosCatalog() {
  const today = toBusinessDate();
  const categories = useQuery({
    queryKey: catalogKeys.categories(false),
    queryFn: ({ signal }) => listCategories(false, signal),
  });
  const products = useQuery({
    queryKey: catalogKeys.products({ status: 'active' }),
    queryFn: ({ signal }) => listProducts({ status: 'active' }, signal),
    refetchInterval: 60_000,
  });
  const menu = useQuery({
    queryKey: catalogKeys.dailyMenu(today),
    queryFn: ({ signal }) => getDailyMenu(today, signal),
    refetchInterval: 60_000,
  });

  const data = useMemo(() => {
    if (categories.data === undefined || products.data === undefined || menu.data === undefined) {
      return undefined;
    }
    return buildPosCatalog(categories.data, products.data, menu.data);
  }, [categories.data, products.data, menu.data]);

  // Hay almuerzos en el catálogo pero ninguno está a la venta hoy: casi siempre es que el menú
  // del día no se ha publicado (o no se eligieron sus almuerzos).
  const lunchesHidden = useMemo(() => {
    if (categories.data === undefined || products.data === undefined || data === undefined) {
      return false;
    }
    const lunchCategories = new Set(
      categories.data
        .filter((category) => category.isActive && category.kind === 'LUNCH')
        .map((category) => category.id),
    );
    const hasLunchProducts = products.data.some((product) =>
      lunchCategories.has(product.categoryId),
    );
    return hasLunchProducts && !data.products.some((product) => product.isLunch);
  }, [categories.data, products.data, data]);

  return {
    data,
    lunchesHidden,
    menu: menu.data,
    isPending: categories.isPending || products.isPending || menu.isPending,
    error: categories.error ?? products.error ?? menu.error,
    refetch: () => {
      void categories.refetch();
      void products.refetch();
      void menu.refetch();
    },
  };
}

function portionsLeftOf(offering: DailyMenu['offerings'][number] | undefined): number | null {
  const portions = offering?.portions ?? null;
  return portions === null ? null : Math.max(0, portions - (offering?.sold ?? 0));
}

export function buildPosCatalog(
  categories: readonly Category[],
  products: readonly {
    id: string;
    name: string;
    price: number;
    priceTiers?: PriceTier[];
    categoryId: string;
    isAvailable: boolean;
    isFavorite: boolean;
    code?: string | null;
    imagePath: string | null;
    sortOrder: number;
  }[],
  menu: DailyMenu,
): { categories: Category[]; products: PosProduct[] } {
  const activeCategories = categories.filter((category) => category.isActive);
  const kindById = new Map(activeCategories.map((category) => [category.id, category.kind]));
  const offerings = menu.isPublished
    ? new Map(menu.offerings.map((offering) => [offering.productId, offering]))
    : new Map<string, DailyMenu['offerings'][number]>();

  const posProducts = products.flatMap((product): PosProduct[] => {
    const kind = kindById.get(product.categoryId);
    if (kind === undefined) return [];
    const isLunch = kind === 'LUNCH';
    const offering = offerings.get(product.id);
    if (isLunch && offering === undefined) return [];
    return [
      {
        id: product.id,
        name: product.name,
        price: product.price,
        priceTiers: isLunch ? [] : (product.priceTiers ?? []),
        categoryId: product.categoryId,
        isAvailable: product.isAvailable,
        isFavorite: product.isFavorite,
        isLunch,
        code: product.code ?? null,
        withChoices: isLunch && offering?.withChoices === true,
        imagePath: product.imagePath,
        portionsLeft: portionsLeftOf(offering),
        sortOrder: product.sortOrder,
      },
    ];
  });

  const withProducts = new Set(posProducts.map((product) => product.categoryId));
  return {
    categories: activeCategories.filter((category) => withProducts.has(category.id)),
    products: posProducts,
  };
}
