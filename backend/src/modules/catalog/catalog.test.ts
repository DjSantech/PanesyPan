import {
  apiErrorResponseSchema,
  categoryResponseSchema,
  dailyMenuResponseSchema,
  listCategoriesResponseSchema,
  listProductsResponseSchema,
  productResponseSchema,
} from '@panesypan/shared';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { startTestDatabase } from '../../../test/database';
import {
  createTestUser,
  DEFAULT_PASSWORD,
  initModels,
  login,
  resetDatabase,
  type LoggedIn,
} from '../../../test/factories';
import { createTestEnv, silentLogger } from '../../../test/helpers';
import { createApp } from '../../app';
import { AuditLogModel } from '../audit/audit-log.model';
import request from 'supertest';
import { InventoryItemModel, StockMovementModel } from '../inventory/inventory.models';
import { CategoryModel, DailyMenuModel, ProductImageModel, ProductModel } from './catalog.models';
import { CATALOG_SEED, seedCatalog } from './catalog.seed';
import { configureImageStorage } from './image-storage';

const app = createApp(createTestEnv({ AUTH_RATE_LIMIT_MAX: '1000' }), silentLogger);
const errorCode = (body: unknown) => apiErrorResponseSchema.parse(body).error.code;

let stopDatabase: (() => Promise<void>) | undefined;
let admin: LoggedIn;
let cashier: LoggedIn;

beforeAll(async () => {
  stopDatabase = await startTestDatabase();
  await initModels();
});

afterAll(async () => {
  await stopDatabase?.();
});

beforeEach(async () => {
  await resetDatabase();
  await createTestUser({ username: 'admin', role: 'ADMIN' });
  await createTestUser({ username: 'laura', role: 'CASHIER' });
  admin = await login(app, 'admin', DEFAULT_PASSWORD);
  cashier = await login(app, 'laura', DEFAULT_PASSWORD);
});

const send = (who: LoggedIn, method: 'post' | 'patch' | 'put', path: string, body: object) =>
  who.agent[method](`/api/v1${path}`).set('X-CSRF-Token', who.csrfToken).send(body);

async function createCategory(name: string, kind: 'STANDARD' | 'LUNCH' = 'STANDARD') {
  const response = await send(admin, 'post', '/categories', { name, kind });
  expect(response.status).toBe(201);
  return categoryResponseSchema.parse(response.body).category;
}

async function createProduct(name: string, categoryId: string, price = 2_000) {
  const response = await send(admin, 'post', '/products', { name, categoryId, price });
  expect(response.status).toBe(201);
  return productResponseSchema.parse(response.body).product;
}

describe('categorías', () => {
  it('el administrador crea, renombra, reordena y desactiva categorías', async () => {
    const bread = await createCategory('Panadería');
    const drinks = await createCategory('Bebidas');
    expect(drinks.sortOrder).toBeGreaterThan(bread.sortOrder);

    const renamed = await send(admin, 'patch', `/categories/${drinks.id}`, {
      name: 'Bebidas calientes',
    });
    expect(categoryResponseSchema.parse(renamed.body).category.slug).toBe('bebidas-calientes');

    const reordered = await send(admin, 'put', '/categories/order', { ids: [drinks.id, bread.id] });
    expect(listCategoriesResponseSchema.parse(reordered.body).items.map((item) => item.id)).toEqual(
      [drinks.id, bread.id],
    );

    await send(admin, 'patch', `/categories/${drinks.id}`, { isActive: false }).expect(200);
    const visible = listCategoriesResponseSchema.parse(
      (await cashier.agent.get('/api/v1/categories')).body,
    );
    expect(visible.items.map((item) => item.name)).toEqual(['Panadería']);
  });

  it('no permite nombres repetidos (sin importar tildes ni mayúsculas)', async () => {
    await createCategory('Panadería');
    const repeated = await send(admin, 'post', '/categories', { name: 'PANADERIA' });
    expect(repeated.status).toBe(409);
  });

  it('la cajera ve las categorías pero no puede crearlas', async () => {
    await createCategory('Panadería');
    expect((await cashier.agent.get('/api/v1/categories')).status).toBe(200);
    const response = await send(cashier, 'post', '/categories', { name: 'Intrusa' });
    expect(response.status).toBe(403);
  });
});

describe('productos', () => {
  it('crea productos con precio entero y los lista por categoría', async () => {
    const bread = await createCategory('Panadería');
    const cheese = await createCategory('Productos de queso');
    await createProduct('Pan Coco', bread.id, 800);
    await createProduct('Almojábana', cheese.id, 2_000);

    const all = listProductsResponseSchema.parse(
      (await cashier.agent.get('/api/v1/products')).body,
    );
    expect(all.items).toHaveLength(2);

    const onlyCheese = listProductsResponseSchema.parse(
      (await cashier.agent.get(`/api/v1/products?categoryId=${cheese.id}`)).body,
    );
    expect(onlyCheese.items.map((item) => item.name)).toEqual(['Almojábana']);
  });

  it('busca sin importar tildes', async () => {
    const cheese = await createCategory('Productos de queso');
    await createProduct('Almojábana', cheese.id);
    const found = listProductsResponseSchema.parse(
      (await cashier.agent.get('/api/v1/products?search=almojabana')).body,
    );
    expect(found.items.map((item) => item.name)).toEqual(['Almojábana']);
  });

  it('valida precio, nombre y categoría', async () => {
    const bread = await createCategory('Panadería');
    const decimal = await send(admin, 'post', '/products', {
      name: 'Pan',
      categoryId: bread.id,
      price: 800.5,
    });
    expect(errorCode(decimal.body)).toBe('VALIDATION_ERROR');
    const tooLow = await send(admin, 'post', '/products', {
      name: 'Pan',
      categoryId: bread.id,
      price: 10,
    });
    expect(errorCode(tooLow.body)).toBe('VALIDATION_ERROR');
    const noCategory = await send(admin, 'post', '/products', {
      name: 'Pan',
      categoryId: '66f1a2b3c4d5e6f708192a3b',
      price: 800,
    });
    expect(noCategory.status).toBe(404);

    await createProduct('Pan Coco', bread.id);
    const repeated = await send(admin, 'post', '/products', {
      name: 'pan coco',
      categoryId: bread.id,
      price: 900,
    });
    expect(repeated.status).toBe(409);
  });

  it('registra los cambios de precio en la auditoría', async () => {
    const bread = await createCategory('Panadería');
    const product = await createProduct('Pan Coco', bread.id, 800);

    const response = await send(admin, 'patch', `/products/${product.id}`, { price: 1_000 });
    expect(productResponseSchema.parse(response.body).product.price).toBe(1_000);

    const log = await AuditLogModel.findOne({ action: 'PRODUCT_PRICE_CHANGED' }).lean();
    expect(log?.metadata).toMatchObject({ changes: { price: { from: 800, to: 1_000 } } });
    expect(log?.entity?.label).toBe('Pan Coco');
  });

  it('la cajera no puede cambiar precios pero sí marcar un producto como agotado', async () => {
    const bread = await createCategory('Panadería');
    const product = await createProduct('Pan Coco', bread.id, 800);

    const price = await send(cashier, 'patch', `/products/${product.id}`, { price: 100 });
    expect(price.status).toBe(403);
    expect((await ProductModel.findById(product.id))?.price).toBe(800);

    const soldOut = await send(cashier, 'patch', `/products/${product.id}/availability`, {
      isAvailable: false,
    });
    expect(productResponseSchema.parse(soldOut.body).product.isAvailable).toBe(false);
    expect(await AuditLogModel.countDocuments({ action: 'PRODUCT_AVAILABILITY_CHANGED' })).toBe(1);
  });

  it('archiva productos sin borrarlos', async () => {
    const bread = await createCategory('Panadería');
    const product = await createProduct('Pan Coco', bread.id);
    await send(admin, 'patch', `/products/${product.id}`, { isActive: false }).expect(200);

    const active = listProductsResponseSchema.parse(
      (await admin.agent.get('/api/v1/products')).body,
    );
    expect(active.items).toHaveLength(0);
    const archived = listProductsResponseSchema.parse(
      (await admin.agent.get('/api/v1/products?status=archived')).body,
    );
    expect(archived.items.map((item) => item.name)).toEqual(['Pan Coco']);
    expect(await ProductModel.countDocuments()).toBe(1);
  });
});

describe('ficha del producto: descripción, web, stock inicial e imagen', () => {
  // PNG de 1×1 píxel.
  const PNG = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    'base64',
  );
  const upload = (who: LoggedIn, id: string, data: Buffer, type = 'image/png') =>
    who.agent
      .post(`/api/v1/products/${id}/image`)
      .set('X-CSRF-Token', who.csrfToken)
      .set('Content-Type', type)
      .send(data);

  it('crea con descripción, visibilidad en la web y stock inicial', async () => {
    const bakery = await createCategory('Panadería');
    const response = await send(admin, 'post', '/products', {
      name: 'Pan de bono',
      categoryId: bakery.id,
      price: 2_000,
      description: 'Horneado con queso costeño, sale caliente a las 6 a. m.',
      isVisibleOnline: false,
      trackStock: true,
      initialStock: 40,
    });
    expect(response.status).toBe(201);
    const product = productResponseSchema.parse(response.body).product;
    expect(product).toMatchObject({
      description: 'Horneado con queso costeño, sale caliente a las 6 a. m.',
      isVisibleOnline: false,
      imagePath: null,
    });
    expect((await InventoryItemModel.findOne({ productId: product.id }))?.quantity).toBe(40);
    expect(
      await StockMovementModel.countDocuments({ productId: product.id, type: 'ADJUSTMENT' }),
    ).toBe(1);

    const edited = await send(admin, 'patch', `/products/${product.id}`, {
      description: '',
      isVisibleOnline: true,
    });
    expect(productResponseSchema.parse(edited.body).product).toMatchObject({
      description: '',
      isVisibleOnline: true,
    });
  });

  it('sin controlar inventario el stock inicial se ignora', async () => {
    const drinks = await createCategory('Bebidas');
    await send(admin, 'post', '/products', {
      name: 'Tinto',
      categoryId: drinks.id,
      price: 1_500,
      trackStock: false,
      initialStock: 10,
    }).expect(201);
    expect(await InventoryItemModel.countDocuments()).toBe(0);
  });

  it('por defecto todo controla inventario menos los almuerzos', async () => {
    const snacks = await createCategory('Paquetes');
    const lunch = await createCategory('Almuerzos', 'LUNCH');
    expect((await createProduct('Papas de limón', snacks.id)).trackStock).toBe(true);
    expect((await createProduct('Almuerzo', lunch.id, 14_000)).trackStock).toBe(false);
  });

  it('al editar se puede cambiar el stock y queda como ajuste', async () => {
    const drinks = await createCategory('Bebidas');
    const soda = await createProduct('Gaseosa 400 ml', drinks.id, 3_000);

    const edited = await send(admin, 'patch', `/products/${soda.id}`, { price: 3_500, stock: 24 });
    expect(edited.status).toBe(200);
    expect(productResponseSchema.parse(edited.body).product.price).toBe(3_500);
    expect((await InventoryItemModel.findOne({ productId: soda.id }))?.quantity).toBe(24);
    const movement = await StockMovementModel.findOne({ productId: soda.id, type: 'ADJUSTMENT' });
    expect(movement).toMatchObject({ delta: 24, note: 'Ajuste al editar el producto' });

    // Solo el stock también se puede editar.
    await send(admin, 'patch', `/products/${soda.id}`, { stock: 20 }).expect(200);
    expect((await InventoryItemModel.findOne({ productId: soda.id }))?.quantity).toBe(20);

    const untracked = await send(admin, 'post', '/products', {
      name: 'Tinto',
      categoryId: drinks.id,
      price: 1_500,
      trackStock: false,
    });
    const tinto = productResponseSchema.parse(untracked.body).product;
    expect((await send(admin, 'patch', `/products/${tinto.id}`, { stock: 5 })).status).toBe(400);
  });

  it('sube, reemplaza y quita la imagen; la imagen es pública y con caché larga', async () => {
    const bakery = await createCategory('Panadería');
    const product = await createProduct('Croissant', bakery.id);

    const first = productResponseSchema.parse((await upload(admin, product.id, PNG)).body).product;
    expect(first.imagePath).toMatch(/^\/api\/v1\/public\/images\/[a-f\d]{24}\.png$/);
    const served = await request(app).get(first.imagePath ?? '');
    expect(served.status).toBe(200);
    expect(served.headers['content-type']).toBe('image/png');
    expect(served.headers['cache-control']).toContain('immutable');
    expect(served.headers['cross-origin-resource-policy']).toBe('cross-origin');

    const second = productResponseSchema.parse((await upload(admin, product.id, PNG)).body).product;
    expect(second.imagePath).not.toBe(first.imagePath);
    expect(await ProductImageModel.countDocuments()).toBe(1);
    await request(app)
      .get(first.imagePath ?? '')
      .expect(404);

    const removed = await admin.agent
      .delete(`/api/v1/products/${product.id}/image`)
      .set('X-CSRF-Token', admin.csrfToken);
    expect(productResponseSchema.parse(removed.body).product.imagePath).toBeNull();
    expect(await ProductImageModel.countDocuments()).toBe(0);
  });

  it('rechaza lo que no es una imagen real (el tipo se lee de los bytes)', async () => {
    const bakery = await createCategory('Panadería');
    const product = await createProduct('Achira', bakery.id);
    const svg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
    );
    const fake = await upload(admin, product.id, svg, 'image/png');
    expect(fake.status).toBe(400);
    expect(await ProductImageModel.countDocuments()).toBe(0);

    const wrongType = await upload(admin, product.id, PNG, 'image/svg+xml');
    expect(wrongType.status).toBe(400);

    const byCashier = await upload(cashier, product.id, PNG);
    expect(byCashier.status).toBe(403);
  });
});

describe('fotos en Cloudinary', () => {
  const PNG = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    'base64',
  );
  const calls: { url: string; form: FormData }[] = [];
  let uploads = 0;

  beforeEach(() => {
    calls.length = 0;
    uploads = 0;
    configureImageStorage(
      createTestEnv({
        CLOUDINARY_CLOUD_NAME: 'demo',
        CLOUDINARY_API_KEY: '123',
        CLOUDINARY_API_SECRET: 'secreto',
      }),
    );
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init: { body: FormData }) => {
        calls.push({ url, form: init.body });
        if (url.endsWith('/destroy')) return Promise.resolve(Response.json({ result: 'ok' }));
        uploads += 1;
        return Promise.resolve(
          Response.json({
            secure_url: `https://res.cloudinary.com/demo/image/upload/v1/panesypan/productos/f${String(uploads)}.png`,
            public_id: `panesypan/productos/f${String(uploads)}`,
          }),
        );
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    configureImageStorage(createTestEnv());
  });

  const upload = (id: string) =>
    admin.agent
      .post(`/api/v1/products/${id}/image`)
      .set('X-CSRF-Token', admin.csrfToken)
      .set('Content-Type', 'image/png')
      .send(PNG);

  it('sube la foto a Cloudinary, guarda solo el enlace y borra la anterior', async () => {
    const bakery = await createCategory('Panadería');
    const product = await createProduct('Pan Coco', bakery.id);

    const first = await upload(product.id);
    expect(first.status).toBe(200);
    expect(productResponseSchema.parse(first.body).product.imagePath).toBe(
      'https://res.cloudinary.com/demo/image/upload/f_auto,q_auto/v1/panesypan/productos/f1.png',
    );
    expect(await ProductImageModel.countDocuments()).toBe(0);
    const sent = calls[0]?.form;
    expect(sent?.get('folder')).toBe('panesypan/productos');
    expect(sent?.get('api_key')).toBe('123');
    expect(sent?.has('api_secret')).toBe(false);

    await upload(product.id).expect(200);
    const destroyed = calls.find((call) => call.url.endsWith('/destroy'));
    expect(destroyed?.form.get('public_id')).toBe('panesypan/productos/f1');

    const removed = await admin.agent
      .delete(`/api/v1/products/${product.id}/image`)
      .set('X-CSRF-Token', admin.csrfToken);
    expect(productResponseSchema.parse(removed.body).product.imagePath).toBeNull();
    expect(calls.filter((call) => call.url.endsWith('/destroy'))).toHaveLength(2);
  });

  it('si Cloudinary falla, avisa y no cambia la foto', async () => {
    const bakery = await createCategory('Panadería');
    const product = await createProduct('Pan Leche', bakery.id);
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(Response.json({ error: { message: 'x' } }, { status: 500 }))),
    );
    const response = await upload(product.id);
    expect(response.status).toBe(503);
    expect((await ProductModel.findById(product.id))?.image).toBeNull();
  });
});

describe('menú del día', () => {
  it('guarda el menú con porciones de productos de almuerzo', async () => {
    const lunch = await createCategory('Almuerzos', 'LUNCH');
    const corriente = await createProduct('Almuerzo corriente', lunch.id, 14_000);
    const caldo = await createProduct('Caldo', lunch.id, 6_000);

    const response = await send(admin, 'put', '/daily-menus/2026-09-24', {
      soups: [{ name: 'Sancocho' }, { name: 'Ajiaco' }],
      principles: [{ name: 'Fríjoles' }],
      proteins: [{ name: 'Pollo' }, { name: 'Cerdo', isAvailable: false }],
      juice: 'Mora',
      offerings: [
        { productId: corriente.id, portions: 40 },
        { productId: caldo.id, portions: null, withChoices: false },
      ],
      isPublished: true,
    });
    expect(response.status).toBe(200);
    const { menu } = dailyMenuResponseSchema.parse(response.body);
    expect(menu).toMatchObject({ isPublished: true, principles: [{ name: 'Fríjoles' }] });
    expect(menu.soups.map((soup) => soup.name)).toEqual(['Sancocho', 'Ajiaco']);
    expect(menu.offerings).toEqual([
      {
        productId: corriente.id,
        portions: 40,
        sold: 0,
        withChoices: true,
        name: 'Almuerzo corriente',
        price: 14_000,
      },
      {
        productId: caldo.id,
        portions: null,
        sold: 0,
        withChoices: false,
        name: 'Caldo',
        price: 6_000,
      },
    ]);

    const read = dailyMenuResponseSchema.parse(
      (await cashier.agent.get('/api/v1/daily-menus/2026-09-24')).body,
    );
    expect(read.menu.proteins).toEqual([
      { name: 'Pollo', isAvailable: true },
      { name: 'Cerdo', isAvailable: false },
    ]);
  });

  it('lee los menús guardados con una sola sopa y un solo principio', async () => {
    await DailyMenuModel.collection.insertOne({
      date: '2026-09-23',
      soup: 'Mondongo',
      principle: 'Arvejas',
      proteins: [{ name: 'Res', isAvailable: true }],
      sides: ['Arroz'],
      offerings: [],
      isPublished: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const { menu } = dailyMenuResponseSchema.parse(
      (await cashier.agent.get('/api/v1/daily-menus/2026-09-23')).body,
    );
    expect(menu.soups).toEqual([{ name: 'Mondongo', isAvailable: true }]);
    expect(menu.principles).toEqual([{ name: 'Arvejas', isAvailable: true }]);
  });

  it('un día sin menú devuelve un menú vacío', async () => {
    const response = await cashier.agent.get('/api/v1/daily-menus/2026-09-25');
    expect(dailyMenuResponseSchema.parse(response.body).menu).toMatchObject({
      offerings: [],
      isPublished: false,
      updatedAt: null,
    });
  });

  it('solo acepta productos de categorías de almuerzos', async () => {
    const bread = await createCategory('Panadería');
    const product = await createProduct('Pan Coco', bread.id);
    const response = await send(admin, 'put', '/daily-menus/2026-09-24', {
      offerings: [{ productId: product.id, portions: 10 }],
    });
    expect(response.status).toBe(400);
    expect(apiErrorResponseSchema.parse(response.body).error.message).toMatch(
      /no es un producto de almuerzos/,
    );
  });

  it('no permite dejar menos porciones de las ya vendidas', async () => {
    const lunch = await createCategory('Almuerzos', 'LUNCH');
    const corriente = await createProduct('Almuerzo corriente', lunch.id, 14_000);
    await send(admin, 'put', '/daily-menus/2026-09-24', {
      offerings: [{ productId: corriente.id, portions: 40 }],
    }).expect(200);
    await DailyMenuModel.updateOne({ date: '2026-09-24' }, { $set: { 'offerings.0.sold': 12 } });

    const response = await send(admin, 'put', '/daily-menus/2026-09-24', {
      offerings: [{ productId: corriente.id, portions: 10 }],
    });
    expect(response.status).toBe(400);
    expect(apiErrorResponseSchema.parse(response.body).error.message).toMatch(/12 porciones/);
  });

  it('rechaza fechas imposibles y la cajera no puede editar el menú', async () => {
    expect((await admin.agent.get('/api/v1/daily-menus/2026-02-31')).status).toBe(400);
    const response = await send(cashier, 'put', '/daily-menus/2026-09-24', {
      soups: [{ name: 'Ajiaco' }],
    });
    expect(response.status).toBe(403);
  });
});

describe('catálogo inicial', () => {
  it('carga las categorías y productos de la panadería una sola vez', async () => {
    const first = await seedCatalog();
    const expectedProducts = CATALOG_SEED.reduce(
      (total, category) => total + category.products.length,
      0,
    );
    expect(first).toEqual({
      categoriesCreated: CATALOG_SEED.length,
      productsCreated: expectedProducts,
      productsSkipped: 0,
    });

    // Si el administrador cambia un precio, volver a cargar no lo pisa.
    await ProductModel.updateOne({ slug: 'pan-coco' }, { $set: { price: 900 } });
    const second = await seedCatalog();
    expect(second).toEqual({
      categoriesCreated: 0,
      productsCreated: 0,
      productsSkipped: expectedProducts,
    });
    expect((await ProductModel.findOne({ slug: 'pan-coco' }))?.price).toBe(900);

    const lunch = await CategoryModel.findOne({ slug: 'almuerzos' });
    expect(lunch?.kind).toBe('LUNCH');
    expect(await ProductModel.countDocuments({ isFavorite: true })).toBeGreaterThan(0);
  });
});
