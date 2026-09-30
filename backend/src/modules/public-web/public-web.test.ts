import {
  BUSINESS_NAME,
  publicBusinessResponseSchema,
  publicCatalogResponseSchema,
  publicDailyMenuResponseSchema,
  toBusinessDate,
} from '@panesypan/shared';
import { Types } from 'mongoose';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { startTestDatabase } from '../../../test/database';
import { initModels, resetDatabase } from '../../../test/factories';
import { createTestEnv, silentLogger } from '../../../test/helpers';
import { createApp } from '../../app';
import { CategoryModel, DailyMenuModel, ProductModel } from '../catalog/catalog.models';
import { PUBLIC_WEB_CACHE } from './public-web.routes';

const app = createApp(createTestEnv(), silentLogger);
const get = (path: string) => request(app).get(`/api/v1/public${path}`);

let stopDatabase: (() => Promise<void>) | undefined;

beforeAll(async () => {
  stopDatabase = await startTestDatabase();
  await initModels();
});

afterAll(async () => {
  await stopDatabase?.();
});

beforeEach(async () => {
  await resetDatabase();
});

let seq = 0;
async function category(name: string, extra: Record<string, unknown> = {}) {
  seq += 1;
  return CategoryModel.create({ name, slug: `cat-${String(seq)}`, ...extra });
}
async function product(
  name: string,
  categoryId: Types.ObjectId,
  extra: Record<string, unknown> = {},
) {
  seq += 1;
  return ProductModel.create({
    name,
    slug: `prod-${String(seq)}`,
    categoryId,
    price: 1_000,
    ...extra,
  });
}

describe('GET /public/catalogo', () => {
  it('solo muestra productos visibles de categorías activas que no son de almuerzos', async () => {
    const bread = await category('Panadería', { sortOrder: 1 });
    const drinks = await category('Bebidas', { sortOrder: 0 });
    const inactive = await category('Vieja', { isActive: false });
    const lunch = await category('Almuerzos', { kind: 'LUNCH' });
    const empty = await category('Vacía');
    const imageId = new Types.ObjectId();
    await product('Pan Coco', bread._id, {
      price: 800,
      description: 'Suave',
      image: { id: imageId, contentType: 'image/webp' },
      sortOrder: 2,
    });
    await product('Almojábana', bread._id, { sortOrder: 2, isAvailable: false });
    await product('Pandebono', bread._id, { sortOrder: 1 });
    await product('Archivado', bread._id, { isActive: false });
    await product('Oculto', bread._id, { isVisibleOnline: false });
    await product('Gaseosa', drinks._id);
    await product('En inactiva', inactive._id);
    await product('Almuerzo', lunch._id);
    await product('Oculto 2', empty._id, { isVisibleOnline: false });

    const response = await get('/catalogo');
    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe(PUBLIC_WEB_CACHE.catalog);
    const body = publicCatalogResponseSchema.parse(response.body);
    expect(body.categories.map((c) => c.name)).toEqual(['Bebidas', 'Panadería']);
    const breads = body.categories[1]!.products;
    expect(breads.map((p) => p.name)).toEqual(['Pandebono', 'Almojábana', 'Pan Coco']);
    expect(breads[1]!.isAvailable).toBe(false);
    expect(breads[2]).toEqual({
      id: breads[2]!.id,
      slug: breads[2]!.slug,
      name: 'Pan Coco',
      description: 'Suave',
      price: 800,
      isAvailable: true,
      imageUrl: `/api/v1/public/images/${imageId.toString()}.webp`,
    });
    expect(breads[0]!.imageUrl).toBeNull();
    expect(JSON.stringify(response.body)).not.toMatch(/sortOrder|trackStock|tax|isFavorite/);
  });

  it('funciona sin cookie de sesión ni Origin', async () => {
    const response = await get('/catalogo');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ categories: [] });
  });
});

describe('GET /public/menu-del-dia', () => {
  const today = () => toBusinessDate();

  it('responde menu null si no existe', async () => {
    const response = await get('/menu-del-dia');
    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe(PUBLIC_WEB_CACHE.dailyMenu);
    expect(publicDailyMenuResponseSchema.parse(response.body)).toEqual({
      date: today(),
      menu: null,
    });
  });

  it('responde menu null si no está publicado', async () => {
    await DailyMenuModel.create({ date: today(), isPublished: false, juice: 'Mora' });
    const response = await get('/menu-del-dia');
    expect(response.body).toEqual({ date: today(), menu: null });
  });

  it('calcula soldOut, omite productos archivados y no expone porciones', async () => {
    const lunch = await category('Almuerzos', { kind: 'LUNCH' });
    const full = await product('Almuerzo', lunch._id, { price: 14_000 });
    const limited = await product('Ejecutivo', lunch._id, { price: 16_000 });
    const free = await product('Bandeja', lunch._id);
    const archived = await product('Viejo', lunch._id, { isActive: false });
    await DailyMenuModel.create({
      date: today(),
      isPublished: true,
      juice: 'Mora',
      soups: [{ name: 'Sancocho', isAvailable: true }],
      principles: [{ name: 'Fríjoles', isAvailable: true }],
      proteins: [{ name: 'Pollo asado', isAvailable: false }],
      offerings: [
        { productId: full._id, portions: 10, sold: 10, withChoices: true },
        { productId: limited._id, portions: 10, sold: 3, withChoices: true },
        { productId: free._id, portions: null, sold: 99, withChoices: false },
        { productId: archived._id, portions: null, sold: 0, withChoices: true },
      ],
    });

    const response = await get('/menu-del-dia');
    const body = publicDailyMenuResponseSchema.parse(response.body);
    expect(body.menu).toEqual({
      soups: [{ name: 'Sancocho', isAvailable: true }],
      principles: [{ name: 'Fríjoles', isAvailable: true }],
      proteins: [{ name: 'Pollo asado', isAvailable: false }],
      drinks: [{ name: 'Mora', isAvailable: true }],
      notes: '',
      items: [
        { productId: full.id, name: 'Almuerzo', price: 14_000, withChoices: true, soldOut: true },
        {
          productId: limited.id,
          name: 'Ejecutivo',
          price: 16_000,
          withChoices: true,
          soldOut: false,
        },
        { productId: free.id, name: 'Bandeja', price: 1_000, withChoices: false, soldOut: false },
      ],
    });
    expect(JSON.stringify(response.body)).not.toMatch(/portions|sold"|updatedBy/);
  });

  it('convierte el formato viejo (una sopa y un principio)', async () => {
    await DailyMenuModel.collection.insertOne({
      date: today(),
      soup: 'Ajiaco',
      principle: 'Lentejas',
      juice: '',
      notes: 'Hoy hay postre',
      offerings: [],
      isPublished: true,
    });
    const body = publicDailyMenuResponseSchema.parse((await get('/menu-del-dia')).body);
    expect(body.menu?.soups).toEqual([{ name: 'Ajiaco', isAvailable: true }]);
    expect(body.menu?.principles).toEqual([{ name: 'Lentejas', isAvailable: true }]);
    expect(body.menu?.proteins).toEqual([]);
    expect(body.menu?.notes).toBe('Hoy hay postre');
  });
});

describe('GET /public/negocio', () => {
  it('devuelve nombre, dirección y teléfono', async () => {
    const response = await get('/negocio');
    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe(PUBLIC_WEB_CACHE.business);
    const body = publicBusinessResponseSchema.parse(response.body);
    expect(body.name).toBe(BUSINESS_NAME);
    expect(typeof body.address).toBe('string');
    expect(body.phone).toBe('');
  });

  it('solo acepta GET', async () => {
    expect((await request(app).post('/api/v1/public/negocio').send({})).status).not.toBe(200);
  });
});
