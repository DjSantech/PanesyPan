/**
 * Carga el inventario del sistema anterior (Trytiendas) en el catálogo de Panes & Pan:
 * categorías, productos con código, precio, stock inicial y foto (a Cloudinary).
 *
 * Uso (desde backend/):
 *   npm run import:traitiendas                      simulación: no escribe nada, solo cuenta y avisa
 *   npm run import:traitiendas -- --apply           carga de verdad
 *   npm run import:traitiendas -- --apply --skip-images   sin descargar las fotos
 *   npm run import:traitiendas -- --file=../docs/otro.csv
 *
 * Se puede ejecutar varias veces: no repite productos (los reconoce por código o por nombre) y
 * en cada pasada completa las fotos que falten. Escribe `.local/import-traitiendas.csv` con lo
 * que hay que revisar a mano. Requiere en backend/.env la base de datos y, para las fotos,
 * las tres credenciales de Cloudinary.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import {
  slugify,
  toBusinessDate,
  type CategoryKind,
  type ProductImageType,
} from '@panesypan/shared';
import { Types } from 'mongoose';
import { connectDatabase, disconnectDatabase } from '../src/config/database';
import { loadEnv } from '../src/config/env';
import { uploadImage } from '../src/lib/cloudinary';
import { CategoryModel, ProductModel } from '../src/modules/catalog/catalog.models';
import {
  cloudinaryCredentials,
  configureImageStorage,
  PRODUCT_IMAGES_FOLDER,
} from '../src/modules/catalog/image-storage';
import { InventoryItemModel, StockMovementModel } from '../src/modules/inventory/inventory.models';
import { UserModel } from '../src/modules/users/user.model';
import { parseCsv, tidyName } from './import-utils';

const { values: args } = parseArgs({
  options: {
    apply: { type: 'boolean', default: false },
    'skip-images': { type: 'boolean', default: false },
    file: { type: 'string', default: '../docs/inventario_trytiendas_panes_y_pan.csv' },
  },
});

/** Marca de Excel para que abra el CSV en UTF-8. */
const BOM = String.fromCharCode(0xfeff);

const STOCK_MAX = 10_000;
const PRICE_MIN = 50;
const NAME_MAX = 60;
const DESCRIPTION_MAX = 300;
const IMAGE_CONCURRENCY = 6;

const normalize = (value: string): string => slugify(value);
const isOnlyCode = (name: string): boolean => /^[\d\s\\/._-]+$/.test(name);

interface CategoryMap {
  name: string;
  kind: CategoryKind;
}

/** Las que ya existen en el catálogo se reutilizan; "OTROS" se separa por el tipo de código. */
function categoryFor(raw: string, code: string): CategoryMap {
  const key = normalize(raw);
  const inHouse = code.toUpperCase().startsWith('TC');
  if (key === 'otros' || key === 'sin-categoria' || key === '') {
    return { name: inHouse ? 'Panadería y comidas' : 'Otros', kind: 'STANDARD' };
  }
  const known: Record<string, string> = {
    'bebidas-no-alcoholicas': 'Bebidas',
    lacteos: 'Lácteos',
    'dulces-y-pasabocas': 'Dulces y pasabocas',
    tabaco: 'Tabaco',
    helados: 'Helados',
    licores: 'Licores',
    despensa: 'Despensa',
  };
  return { name: known[key] ?? tidyName(raw), kind: 'STANDARD' };
}

/** Tipo real de la foto por sus primeros bytes (el servidor la entrega como octet-stream). */
function sniffImageType(data: Buffer): ProductImageType | null {
  if (data.length > 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) {
    return 'image/jpeg';
  }
  if (data.length > 4 && data.subarray(1, 4).toString('latin1') === 'PNG') return 'image/png';
  if (data.length > 12 && data.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  return null;
}

// ── Plan de carga ──────────────────────────────────────────────────

interface Plan {
  csvRow: number;
  code: string;
  name: string;
  slug: string;
  category: CategoryMap;
  price: number;
  stock: number;
  description: string;
  imageUrl: string;
  isActive: boolean;
  notes: string[];
}

function buildPlan(rows: Record<string, string>[]): Plan[] {
  const seenSlugs = new Set<string>();
  return rows.map((row, index): Plan => {
    const notes: string[] = [];
    const code = (row.codigo ?? '').slice(0, 40);
    let name = tidyName(row.nombre ?? '');
    let isActive = true;

    if (name === '' || isOnlyCode(name)) {
      name = `Producto ${code}`;
      isActive = false;
      notes.push('El nombre era un código: ponle nombre y actívalo');
    }
    if (name.length > NAME_MAX) {
      name = name.slice(0, NAME_MAX).trim();
      notes.push('Nombre recortado a 60 caracteres');
    }

    const price = Math.round(Number(row.precio_venta));
    if (!Number.isFinite(price) || price < PRICE_MIN) {
      isActive = false;
      notes.push(`Precio ${String(price)}: quedó archivado, corrígelo y actívalo`);
    }

    let stock = Math.round(Number(row.stock));
    if (!Number.isFinite(stock) || stock < 0) stock = 0;
    if (stock > STOCK_MAX) {
      notes.push(`Stock ${String(stock)} es demasiado alto: quedó en 0, cuéntalo`);
      stock = 0;
    }

    // La descripción solo sirve si dice algo distinto al nombre y el sistema viejo no la marcó dudosa.
    const rawDescription = (row.descripcion ?? '').replace(/\s+/g, ' ').trim();
    const reliable = !(row.revisar ?? '').includes('DESCRIPCION_NO_COINCIDE');
    const description =
      reliable && rawDescription !== '' && normalize(rawDescription) !== normalize(row.nombre ?? '')
        ? rawDescription.slice(0, DESCRIPTION_MAX)
        : '';

    let slug = slugify(name);
    if (slug === '' || seenSlugs.has(slug)) {
      notes.push('Había otro producto con el mismo nombre: se les distingue por el código');
      slug = slugify(`${name} ${code}`);
    }
    seenSlugs.add(slug);

    const flagged = (row.revisar ?? '').replace('REVISAR:', '').trim();
    if (flagged !== '') notes.push(`Marca del archivo: ${flagged}`);

    return {
      csvRow: index + 2,
      code,
      name,
      slug,
      category: categoryFor(row.categoria ?? '', code),
      price: Number.isFinite(price) ? price : 0,
      stock,
      description,
      imageUrl: row.imagen_url ?? '',
      isActive,
      notes,
    };
  });
}

// ── Fotos ──────────────────────────────────────────────────────────

async function download(url: string): Promise<Buffer> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(20_000) });
      if (!response.ok) throw new Error(`HTTP ${String(response.status)}`);
      return Buffer.from(await response.arrayBuffer());
    } catch (error) {
      lastError = error;
      await new Promise((done) => setTimeout(done, 500 * attempt));
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

async function runPool<T>(items: T[], size: number, work: (item: T) => Promise<void>) {
  let next = 0;
  const workers = Array.from({ length: Math.min(size, items.length) }, async () => {
    while (next < items.length) {
      const item = items[next];
      next += 1;
      if (item !== undefined) await work(item);
    }
  });
  await Promise.all(workers);
}

// ── Principal ──────────────────────────────────────────────────────

const reportPath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../.local/import-traitiendas.csv',
);
const reportRows: string[][] = [['fila_csv', 'codigo', 'nombre', 'categoria', 'precio', 'aviso']];
const note = (plan: Plan, text: string) =>
  reportRows.push([
    String(plan.csvRow),
    plan.code,
    plan.name,
    plan.category.name,
    String(plan.price),
    text,
  ]);

let exitCode = 0;
try {
  const csvPath = resolve(args.file);
  const rows = parseCsv(readFileSync(csvPath, 'utf8'));
  const plans = buildPlan(rows);
  const apply = args.apply;
  console.log(
    `[import] ${apply ? 'CARGA' : 'SIMULACIÓN (no se escribe nada)'} · ${String(plans.length)} filas en ${csvPath}`,
  );

  const env = loadEnv();
  configureImageStorage(env);
  const credentials = cloudinaryCredentials();
  const withImages = !args['skip-images'];
  if (withImages && credentials === null && plans.some((p) => p.imageUrl !== '')) {
    throw new Error(
      'Faltan las credenciales de Cloudinary para subir las fotos (o usa --skip-images)',
    );
  }
  await connectDatabase({ uri: env.MONGODB_URI, dbName: env.MONGODB_DB_NAME });
  console.log(`[import] Base de datos: "${env.MONGODB_DB_NAME}"`);
  await ProductModel.init();

  // Lo que ya existe: por código y por nombre (slug).
  const existing = await ProductModel.find().select('slug code image');
  const bySlug = new Map(existing.map((p) => [p.slug, p]));
  const byCode = new Map(
    existing.flatMap((p) =>
      p.code === null || p.code === undefined ? [] : [[p.code, p] as const],
    ),
  );

  const toCreate: Plan[] = [];
  const codesToAttach: { productId: Types.ObjectId; code: string }[] = [];
  const alreadyThere: { plan: Plan; productId: Types.ObjectId; hasImage: boolean }[] = [];
  const takenSlugs = new Set(bySlug.keys());
  for (const plan of plans) {
    const found = (plan.code === '' ? undefined : byCode.get(plan.code)) ?? bySlug.get(plan.slug);
    if (found !== undefined) {
      alreadyThere.push({ plan, productId: found._id, hasImage: found.image !== null });
      // Al producto que ya estaba (p. ej. del catálogo inicial) se le agrega el código si no lo tiene.
      if (plan.code !== '' && (found.code === null || found.code === undefined)) {
        if (!byCode.has(plan.code)) {
          byCode.set(plan.code, found);
          codesToAttach.push({ productId: found._id, code: plan.code });
        }
      }
      continue;
    }
    // El nombre ya lo usa otro producto (p. ej. uno del catálogo inicial): se distingue con el código.
    if (takenSlugs.has(plan.slug)) plan.slug = slugify(`${plan.name} ${plan.code}`);
    takenSlugs.add(plan.slug);
    toCreate.push(plan);
  }

  const categoryNames = [...new Set(toCreate.map((p) => p.category.name))];
  const byCategory = new Map<string, number>();
  for (const plan of toCreate) {
    byCategory.set(plan.category.name, (byCategory.get(plan.category.name) ?? 0) + 1);
  }
  for (const { plan } of alreadyThere) {
    console.log(`[import]   Ya existe: "${plan.name}" (código ${plan.code})`);
  }
  console.log(
    `[import] Por crear: ${String(toCreate.length)} · ya existían: ${String(alreadyThere.length)}`,
  );
  console.log(
    `[import] Archivados por datos dudosos: ${String(toCreate.filter((p) => !p.isActive).length)} · ` +
      `con foto: ${String(toCreate.filter((p) => p.imageUrl !== '').length)} · ` +
      `con stock: ${String(toCreate.filter((p) => p.stock > 0).length)}`,
  );
  for (const [name, count] of [...byCategory].sort((a, b) => b[1] - a[1])) {
    console.log(`[import]   ${name}: ${String(count)}`);
  }
  for (const plan of plans) for (const text of plan.notes) note(plan, text);

  if (apply) {
    const admin = await UserModel.findOne({ role: 'ADMIN', isActive: true }).sort({ createdAt: 1 });
    if (admin === null) throw new Error('No hay un administrador activo para firmar el stock');
    const by = { id: admin._id, name: admin.name };

    // Categorías: las que existen se reutilizan; las demás se crean al final de la lista.
    const categories = new Map<string, Types.ObjectId>();
    let sortOrder = (await CategoryModel.countDocuments()) + 1;
    for (const name of categoryNames) {
      const slug = slugify(name);
      let category = await CategoryModel.findOne({ slug });
      if (category === null) {
        category = await CategoryModel.create({ name, slug, kind: 'STANDARD', sortOrder });
        sortOrder += 1;
        console.log(`[import] Categoría creada: ${name}`);
      }
      categories.set(name, category._id);
    }

    const categoryIdOf = (name: string): Types.ObjectId => {
      const id = categories.get(name);
      if (id === undefined) throw new Error(`Categoría sin crear: ${name}`);
      return id;
    };

    for (const { productId, code } of codesToAttach) {
      await ProductModel.updateOne({ _id: productId }, { $set: { code } });
    }
    if (codesToAttach.length > 0) {
      console.log(
        `[import] Código agregado a ${String(codesToAttach.length)} productos que ya existían`,
      );
    }

    // Productos en tandas; el orden dentro de cada categoría es el del archivo.
    const position = new Map<string, number>();
    const created: { plan: Plan; productId: Types.ObjectId }[] = [];
    for (let start = 0; start < toCreate.length; start += 200) {
      const batch = toCreate.slice(start, start + 200);
      const docs = await ProductModel.insertMany(
        batch.map((plan) => {
          const next = (position.get(plan.category.name) ?? 0) + 1;
          position.set(plan.category.name, next);
          return {
            name: plan.name,
            slug: plan.slug,
            categoryId: categoryIdOf(plan.category.name),
            price: plan.price,
            code: plan.code === '' ? null : plan.code,
            description: plan.description,
            trackStock: true,
            // En la web solo sale lo que la dueña active: son más de mil productos de tienda.
            isVisibleOnline: false,
            isActive: plan.isActive,
            sortOrder: next,
          };
        }),
      );
      docs.forEach((doc, i) => {
        const plan = batch[i];
        if (plan !== undefined) created.push({ plan, productId: doc._id });
      });
      console.log(
        `[import] Productos creados: ${String(created.length)}/${String(toCreate.length)}`,
      );
    }

    // Stock inicial: existencias y un movimiento en el libro, como un ajuste normal.
    const withStock = created.filter(({ plan }) => plan.stock > 0);
    if (withStock.length > 0) {
      await InventoryItemModel.insertMany(
        withStock.map(({ plan, productId }) => ({ productId, quantity: plan.stock })),
      );
      await StockMovementModel.insertMany(
        withStock.map(({ plan, productId }) => ({
          productId,
          productName: plan.name,
          type: 'ADJUSTMENT',
          delta: plan.stock,
          quantityAfter: plan.stock,
          note: 'Carga inicial desde Trytiendas',
          businessDate: toBusinessDate(),
          by,
        })),
      );
      console.log(`[import] Stock inicial cargado en ${String(withStock.length)} productos`);
    }

    // Fotos: las de los productos nuevos y las que falten en los que ya estaban.
    if (withImages && credentials !== null) {
      const pending = [
        ...created.map(({ plan, productId }) => ({ plan, productId })),
        ...alreadyThere
          .filter((item) => !item.hasImage)
          .map(({ plan, productId }) => ({ plan, productId })),
      ].filter(({ plan }) => plan.imageUrl !== '');
      let done = 0;
      let failed = 0;
      await runPool(pending, IMAGE_CONCURRENCY, async ({ plan, productId }) => {
        try {
          const data = await download(plan.imageUrl);
          const contentType = sniffImageType(data);
          if (contentType === null) throw new Error('el archivo no es una imagen válida');
          const uploaded = await uploadImage(
            credentials,
            { data, contentType },
            PRODUCT_IMAGES_FOLDER,
          );
          await ProductModel.updateOne(
            { _id: productId },
            {
              $set: {
                image: {
                  id: new Types.ObjectId(),
                  contentType,
                  url: uploaded.url,
                  publicId: uploaded.publicId,
                },
              },
            },
          );
          done += 1;
        } catch (error) {
          failed += 1;
          note(plan, `Foto no cargada (${error instanceof Error ? error.message : String(error)})`);
        }
        if ((done + failed) % 50 === 0) {
          console.log(`[import] Fotos: ${String(done)} listas, ${String(failed)} con error`);
        }
      });
      console.log(`[import] Fotos subidas: ${String(done)} · con error: ${String(failed)}`);
    }
  }

  const csv = reportRows
    .map((cells) => cells.map((cell) => `"${cell.replaceAll('"', '""')}"`).join(','))
    .join('\n');
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, `${BOM}${csv}\n`, 'utf8');
  console.log(
    `[import] Avisos para revisar a mano: ${String(reportRows.length - 1)} → ${reportPath}`,
  );
  if (!apply) console.log('[import] Para cargar de verdad: npm run import:traitiendas -- --apply');
} catch (error) {
  console.error(`[import] ${error instanceof Error ? error.message : String(error)}`);
  exitCode = 1;
} finally {
  await disconnectDatabase().catch(() => undefined);
}
process.exit(exitCode);
