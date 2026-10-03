import { randomUUID } from 'node:crypto';
import type { DemoApi } from './demo';

/**
 * Datos de demostración que cada video prepara antes de grabar (por la API, no sale en el
 * video). Cada video arranca con una base de datos nueva que solo tiene el catálogo.
 */

interface Named {
  id: string;
  name: string;
}

type PaymentMethod =
  'CASH' | 'NEQUI' | 'DAVIPLATA' | 'DEBIT_CARD' | 'CREDIT_CARD' | 'BANK_TRANSFER';

/** Busca un producto por nombre exacto. */
async function findProduct(api: DemoApi, name: string): Promise<Named & { price: number }> {
  const { items } = await api.request<{ items: (Named & { price: number })[] }>(
    'GET',
    '/api/v1/products?status=all',
  );
  const found = items.find((item) => item.name === name);
  if (found === undefined) throw new Error(`No existe el producto "${name}"`);
  return found;
}

export async function productId(api: DemoApi, name: string): Promise<string> {
  return (await findProduct(api, name)).id;
}

export async function categoryId(api: DemoApi, name: string): Promise<string> {
  const { items } = await api.request<{ items: Named[] }>('GET', '/api/v1/categories?all=true');
  const found = items.find((item) => item.name === name);
  if (found === undefined) throw new Error(`No existe la categoría "${name}"`);
  return found.id;
}

/** Abre la caja de quien tiene la sesión. */
export async function openShift(api: DemoApi, openingAmount = 100_000): Promise<void> {
  await api.request('POST', '/api/v1/cash-shifts', { openingAmount, note: '' });
}

/** Cobra una venta de mostrador: [nombre, cantidad] y el medio de pago. */
export async function sell(
  api: DemoApi,
  items: [name: string, quantity: number][],
  method: PaymentMethod = 'CASH',
): Promise<void> {
  const lines = [];
  let total = 0;
  for (const [name, quantity] of items) {
    const product = await findProduct(api, name);
    total += product.price * quantity;
    lines.push({ productId: product.id, quantity, note: '', lunch: null });
  }
  await api.request('POST', '/api/v1/sales/checkout', {
    clientRequestId: randomUUID(),
    expectedTotal: total,
    discount: null,
    payments: [{ method, amount: total, reference: '' }],
    cashReceived: method === 'CASH' ? total : null,
    lines,
  });
}

/** Un día con movimiento: varias ventas en efectivo y por Nequi. */
export async function sellSomeOrders(api: DemoApi): Promise<void> {
  await sell(api, [
    ['Pan de Bono', 4],
    ['Tinto', 2],
  ]);
  await sell(
    api,
    [
      ['Croissant', 2],
      ['Chocolate', 2],
    ],
    'NEQUI',
  );
  await sell(api, [['Almojábana', 3]]);
  await sell(api, [['Pan Queso grande', 1]], 'DAVIPLATA');
  await sell(api, [
    ['Buñuelo', 6],
    ['Gaseosa', 1],
  ]);
  await sell(api, [['Pan Coco', 10]]);
  await sell(
    api,
    [
      ['Empanada de Cambray', 2],
      ['Jugo natural', 2],
    ],
    'NEQUI',
  );
}

/** Productos que el catálogo inicial no trae: bebidas, almuerzo y caldo. */
export async function addDemoProducts(admin: DemoApi): Promise<void> {
  const drinks = await categoryId(admin, 'Bebidas');
  for (const [name, price] of [
    ['Tinto', 1_500],
    ['Chocolate', 3_000],
    ['Gaseosa', 3_000],
    ['Jugo natural', 4_000],
  ] as const) {
    await admin.request('POST', '/api/v1/products', {
      name,
      categoryId: drinks,
      price,
      initialStock: 60,
    });
  }
  await admin.request('POST', '/api/v1/products', {
    name: 'Almuerzo corriente',
    categoryId: await categoryId(admin, 'Almuerzos'),
    price: 15_000,
  });
  await admin.request('POST', '/api/v1/products', {
    name: 'Caldo de costilla',
    categoryId: await categoryId(admin, 'Caldos'),
    price: 8_000,
    trackStock: false,
  });
}

/** Publica el menú de hoy con el almuerzo corriente (30 porciones). */
export async function publishTodayMenu(admin: DemoApi): Promise<void> {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(new Date());
  const option = (name: string) => ({ name, isAvailable: true });
  await admin.request('PUT', `/api/v1/daily-menus/${today}`, {
    soups: [option('Sancocho'), option('Crema de ahuyama')],
    principles: [option('Fríjoles'), option('Lentejas')],
    proteins: [option('Pollo asado'), option('Carne en bistec'), option('Cerdo apanado')],
    drinks: [option('Limonada'), option('Jugo de mora')],
    notes: 'Arroz, ensalada y tajadas',
    offerings: [
      {
        productId: await productId(admin, 'Almuerzo corriente'),
        portions: 30,
        withChoices: true,
      },
    ],
    isPublished: true,
  });
}

/** Un cliente hace un pedido a domicilio desde panesypan.com. */
export async function placeWebOrder(
  api: DemoApi,
  items: [name: string, quantity: number][],
  customer: { name: string; phone: string; address: string; neighborhood: string; note?: string },
): Promise<void> {
  const lines = [];
  for (const [name, quantity] of items) {
    lines.push({ productId: await productId(api, name), quantity, lunch: null });
  }
  await api.request('POST', '/api/v1/public/pedidos', {
    clientRequestId: randomUUID(),
    customer: { note: '', ...customer },
    confirmsDosquebradas: true,
    lines,
  });
}

/** Deja un producto con pocas unidades y un mínimo, para que salga la alerta de bajo stock. */
export async function makeLowStock(
  admin: DemoApi,
  name: string,
  quantity: number,
  minStock: number,
): Promise<void> {
  const id = await productId(admin, name);
  await admin.request('POST', '/api/v1/inventory/adjustments', {
    productId: id,
    newQuantity: quantity,
    note: 'Conteo de la mañana',
  });
  await admin.request('PATCH', `/api/v1/inventory/${id}/min-stock`, { minStock });
}
