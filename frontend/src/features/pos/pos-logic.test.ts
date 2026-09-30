import type { Category, DailyMenu } from '@panesypan/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { newRequestId } from '@/lib/request-id';
import { useCartStore } from './cart.store';
import { buildPosCatalog } from './use-pos-catalog';

const category = (id: string, kind: Category['kind'], isActive = true): Category => ({
  id,
  name: id,
  slug: id,
  kind,
  sortOrder: 0,
  isActive,
  productCount: 1,
});

const product = (id: string, categoryId: string) => ({
  id,
  name: id,
  price: 2_000,
  categoryId,
  isAvailable: true,
  isFavorite: false,
  imagePath: null,
  sortOrder: 0,
});

const menu = (overrides: Partial<DailyMenu> = {}): DailyMenu => ({
  date: '2026-09-23',
  soups: [],
  principles: [],
  proteins: [],
  drinks: [],
  notes: '',
  offerings: [],
  isPublished: true,
  updatedAt: null,
  ...overrides,
});

describe('catálogo del punto de venta', () => {
  const categories = [
    category('pan', 'STANDARD'),
    category('almuerzos', 'LUNCH'),
    category('viejo', 'STANDARD', false),
  ];
  const products = [
    product('bono', 'pan'),
    product('corriente', 'almuerzos'),
    product('caldo', 'almuerzos'),
    product('archivado', 'viejo'),
  ];

  it('los almuerzos solo aparecen si están en el menú publicado, con sus porciones', () => {
    const withLunch = buildPosCatalog(
      categories,
      products,
      menu({
        offerings: [
          {
            productId: 'corriente',
            portions: 30,
            sold: 12,
            withChoices: true,
            name: 'x',
            price: 1,
          },
          { productId: 'caldo', portions: null, sold: 0, withChoices: false, name: 'y', price: 1 },
        ],
      }),
    );
    expect(
      withLunch.products.map((item) => [item.id, item.portionsLeft, item.withChoices]),
    ).toEqual([
      ['bono', null, false],
      ['corriente', 18, true],
      ['caldo', null, false],
    ]);

    const unpublished = buildPosCatalog(
      categories,
      products,
      menu({
        isPublished: false,
        offerings: [
          {
            productId: 'corriente',
            portions: null,
            sold: 0,
            withChoices: true,
            name: 'x',
            price: 1,
          },
        ],
      }),
    );
    expect(unpublished.products.map((item) => item.id)).toEqual(['bono']);
    // Sin productos visibles, la categoría de almuerzos no aparece como filtro.
    expect(unpublished.categories.map((item) => item.id)).toEqual(['pan']);
  });
});

describe('pedido de mostrador', () => {
  beforeEach(() => {
    useCartStore.getState().clear();
  });

  it('suma el mismo producto y separa el almuerzo por lo que eligió el cliente', () => {
    const { add } = useCartStore.getState();
    const pollo = { protein: 'Pollo', principle: 'Fríjoles', soup: 'Sancocho', drink: null };
    add('bono');
    add('bono');
    add('corriente', '', pollo);
    add('corriente', '', pollo);
    add('corriente', '', { ...pollo, soup: null });
    expect(useCartStore.getState().lines.map((line) => [line.key, line.quantity])).toEqual([
      ['bono||', 2],
      ['corriente|Pollo · Fríjoles · Sancocho · Sin bebida|', 2],
      ['corriente|Pollo · Fríjoles · Sin sopa · Sin bebida|', 1],
    ]);
  });

  it('cantidad cero quita la línea', () => {
    const { add, setQuantity } = useCartStore.getState();
    add('bono');
    setQuantity('bono||', 5);
    expect(useCartStore.getState().lines[0]?.quantity).toBe(5);
    setQuantity('bono||', 0);
    expect(useCartStore.getState().lines).toEqual([]);
  });
});

describe('newRequestId', () => {
  it('genera UUID v4 distintos', () => {
    const first = newRequestId();
    expect(first).toMatch(/^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/);
    expect(newRequestId()).not.toBe(first);
  });
});
