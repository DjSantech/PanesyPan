import { BUSINESS_NAME, toBusinessDate } from '@panesypan/shared';
import type { BusinessResponse, CatalogResponse, DailyMenuResponse } from './types';

/*
 * Datos de EJEMPLO solo para desarrollo (cuando no hay API).
 * Nunca incluyen teléfonos, direcciones ni horarios.
 */

export const mockCatalog: CatalogResponse = {
  categories: [
    {
      slug: 'panaderia',
      name: 'Panadería (ejemplo)',
      products: [
        {
          id: 'mock-pan-coco',
          slug: 'pan-coco',
          name: 'Pan Coco',
          description: 'Producto de ejemplo.',
          price: 800,
          isAvailable: true,
          imageUrl: null,
        },
        {
          id: 'mock-pan-queso',
          slug: 'pan-queso',
          name: 'Pan de queso',
          description: 'Producto de ejemplo.',
          price: 1000,
          isAvailable: true,
          imageUrl: null,
        },
        {
          id: 'mock-rollo',
          slug: 'rollo-canela',
          name: 'Rollo de canela',
          description: '',
          price: 2500,
          isAvailable: false,
          imageUrl: null,
        },
      ],
    },
    {
      slug: 'bebidas',
      name: 'Bebidas (ejemplo)',
      products: [
        {
          id: 'mock-cafe',
          slug: 'cafe',
          name: 'Café',
          description: 'Producto de ejemplo.',
          price: 1500,
          isAvailable: true,
          imageUrl: null,
        },
      ],
    },
  ],
};

export function mockDailyMenu(): DailyMenuResponse {
  return {
    date: toBusinessDate(new Date()),
    menu: {
      soups: [{ name: 'Sopa de ejemplo', isAvailable: true }],
      principles: [
        { name: 'Principio de ejemplo', isAvailable: true },
        { name: 'Otro principio (agotado)', isAvailable: false },
      ],
      proteins: [{ name: 'Proteína de ejemplo', isAvailable: true }],
      drinks: [{ name: 'Jugo de ejemplo', isAvailable: true }],
      notes: 'Menú de ejemplo para desarrollo.',
      items: [
        {
          productId: 'mock-almuerzo',
          name: 'Almuerzo (ejemplo)',
          price: 14000,
          withChoices: true,
          soldOut: false,
        },
        {
          productId: 'mock-caldo',
          name: 'Caldo (ejemplo)',
          price: null,
          withChoices: false,
          soldOut: false,
        },
      ],
    },
  };
}

export const mockBusiness: BusinessResponse = {
  name: BUSINESS_NAME,
  address: '',
  phone: '',
};
