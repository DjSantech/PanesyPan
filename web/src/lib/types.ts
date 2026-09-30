/*
 * Formas JSON de las rutas públicas (docs/web/CONTRATOS.md, sección a).
 * Provisionales: se reemplazarán por los esquemas de @panesypan/shared.
 */

export interface CatalogProduct {
  id: string;
  slug: string;
  name: string;
  description: string;
  price: number;
  isAvailable: boolean;
  imageUrl: string | null;
}

export interface CatalogCategory {
  slug: string;
  name: string;
  products: CatalogProduct[];
}

export interface CatalogResponse {
  categories: CatalogCategory[];
}

export interface DailyMenuOption {
  name: string;
  isAvailable: boolean;
}

export interface DailyMenuItem {
  productId: string;
  name: string;
  price: number | null;
  withChoices: boolean;
  soldOut: boolean;
}

export interface DailyMenu {
  soups: DailyMenuOption[];
  principles: DailyMenuOption[];
  proteins: DailyMenuOption[];
  drinks: DailyMenuOption[];
  notes: string;
  items: DailyMenuItem[];
}

export interface DailyMenuResponse {
  date: string;
  menu: DailyMenu | null;
}

export interface BusinessResponse {
  name: string;
  address: string;
  phone: string;
}
