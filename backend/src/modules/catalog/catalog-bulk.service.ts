import {
  adjustedPrice,
  formatCOP,
  slugify,
  type BulkMoveProductsRequest,
  type BulkMoveProductsResult,
  type BulkPriceRequest,
  type BulkPriceResult,
  type ImportProductsRequest,
  type ImportProductsResult,
} from '@panesypan/shared';
import { trusted, Types } from 'mongoose';
import { AppError } from '../../lib/errors';
import { recordAudit } from '../audit/audit.service';
import { InventoryItemModel } from '../inventory/inventory.models';
import { SupplierModel } from '../suppliers/supplier.model';
import { toCsv } from '../reports/csv';
import { toAuditActor } from '../users/users.mapper';
import type { ActorContext } from '../users/users.service';
import { CategoryModel, ProductModel } from './catalog.models';

/** Filas de cambios que se muestran en la vista previa. */
const PREVIEW_CHANGES = 30;

const CSV_HEADERS = [
  'Nombre',
  'Categoría',
  'Subcategoría',
  'Precio',
  'Costo',
  'Stock',
  'Stock mínimo',
  'Proveedor',
  'Controla inventario',
  'Activo',
];

/** CSV con todos los productos; se puede editar en Excel y volver a cargar. */
export async function exportProductsCsv(): Promise<string> {
  const [products, categories, stock, suppliers] = await Promise.all([
    ProductModel.find().sort({ name: 1 }).lean(),
    CategoryModel.find().lean(),
    InventoryItemModel.find().lean(),
    SupplierModel.find().lean(),
  ]);
  const categoryName = new Map(
    categories.map((category) => [category._id.toString(), category.name]),
  );
  const stockOf = new Map(stock.map((item) => [item.productId.toString(), item]));
  const supplierName = new Map(
    suppliers.map((supplier) => [supplier._id.toString(), supplier.name]),
  );
  return toCsv(
    CSV_HEADERS,
    products.map((product) => {
      const item = stockOf.get(product._id.toString());
      return [
        product.name,
        categoryName.get(product.categoryId.toString()) ?? '',
        product.subcategory,
        product.price,
        product.cost ?? null,
        product.trackStock ? (item?.quantity ?? 0) : null,
        item?.minStock ?? 0,
        product.supplierId === null ? '' : (supplierName.get(product.supplierId.toString()) ?? ''),
        product.trackStock ? 'Sí' : 'No',
        product.isActive ? 'Sí' : 'No',
      ];
    }),
  );
}

/**
 * Carga masiva: actualiza los productos que encuentra por nombre y, si se pide, crea los que
 * faltan. Con `dryRun` solo calcula el resultado para revisarlo antes de aplicarlo.
 */
export async function importProducts(
  input: ImportProductsRequest,
  ctx: ActorContext,
): Promise<ImportProductsResult> {
  const dryRun = input.dryRun ?? true;
  const createMissing = input.createMissing ?? false;
  const [products, categories] = await Promise.all([ProductModel.find(), CategoryModel.find()]);
  const productBySlug = new Map(products.map((product) => [product.slug, product]));
  const categoryBySlug = new Map(categories.map((category) => [category.slug, category]));
  const result: ImportProductsResult = {
    dryRun,
    created: 0,
    updated: 0,
    unchanged: 0,
    skipped: [],
    changes: [],
  };
  const seen = new Set<string>();
  const note = (name: string, detail: string) => {
    if (result.changes.length < PREVIEW_CHANGES) result.changes.push({ name, detail });
  };

  for (const [index, row] of input.rows.entries()) {
    const rowNumber = index + 2; // la fila 1 del archivo son los títulos
    const slug = slugify(row.name);
    if (seen.has(slug)) {
      result.skipped.push({
        row: rowNumber,
        name: row.name,
        reason: 'Está repetido en el archivo',
      });
      continue;
    }
    seen.add(slug);
    const product = productBySlug.get(slug);

    if (product === undefined) {
      const category = categoryBySlug.get(slugify(row.category ?? ''));
      if (!createMissing) {
        result.skipped.push({ row: rowNumber, name: row.name, reason: 'No existe en el catálogo' });
      } else if (row.price === undefined) {
        result.skipped.push({
          row: rowNumber,
          name: row.name,
          reason: 'Producto nuevo sin precio',
        });
      } else if (category === undefined) {
        result.skipped.push({
          row: rowNumber,
          name: row.name,
          reason: `No existe la categoría "${row.category ?? ''}"`,
        });
      } else {
        result.created += 1;
        note(row.name, `Nuevo en ${category.name} a ${formatCOP(row.price)}`);
        if (!dryRun) {
          const created = await ProductModel.create({
            name: row.name,
            slug,
            categoryId: category._id,
            subcategory: row.subcategory ?? '',
            price: row.price,
            cost: row.cost ?? null,
            trackStock: category.kind !== 'LUNCH',
          });
          if (row.minStock !== undefined) {
            await InventoryItemModel.updateOne(
              { productId: created._id },
              { $set: { minStock: row.minStock } },
              { upsert: true },
            );
          }
        }
      }
      continue;
    }

    const details: string[] = [];
    if (row.price !== undefined && row.price !== product.price) {
      details.push(`precio ${formatCOP(product.price)} → ${formatCOP(row.price)}`);
      product.price = row.price;
    }
    if (row.cost !== undefined && row.cost !== product.cost) {
      details.push(
        `costo ${product.cost === null ? '—' : formatCOP(product.cost)} → ${formatCOP(row.cost)}`,
      );
      product.cost = row.cost;
    }
    if (row.subcategory !== undefined && row.subcategory !== product.subcategory) {
      details.push(`subcategoría "${row.subcategory}"`);
      product.subcategory = row.subcategory;
    }
    let minStockChanged = false;
    if (row.minStock !== undefined && product.trackStock) {
      const item = await InventoryItemModel.findOne({ productId: product._id });
      if ((item?.minStock ?? 0) !== row.minStock) {
        details.push(`mínimo ${String(item?.minStock ?? 0)} → ${String(row.minStock)}`);
        minStockChanged = true;
      }
    }
    if (details.length === 0) {
      result.unchanged += 1;
      continue;
    }
    result.updated += 1;
    note(product.name, details.join(' · '));
    if (!dryRun) {
      await product.save();
      if (minStockChanged) {
        await InventoryItemModel.updateOne(
          { productId: product._id },
          { $set: { minStock: row.minStock } },
          { upsert: true },
        );
      }
    }
  }

  if (!dryRun) {
    await recordAudit(
      {
        action: 'PRODUCTS_IMPORTED',
        actor: toAuditActor(ctx.actor),
        entity: { type: 'CATALOG', id: 'import', label: 'Carga masiva de productos' },
        metadata: {
          created: result.created,
          updated: result.updated,
          skipped: result.skipped.length,
        },
        meta: ctx.meta,
      },
      ctx.logger,
    );
  }
  return result;
}

/** Sube o baja en un porcentaje los precios de los productos activos de una categoría. */
export async function bulkChangePrices(
  input: BulkPriceRequest,
  ctx: ActorContext,
): Promise<BulkPriceResult> {
  const dryRun = input.dryRun ?? true;
  const roundTo = input.roundTo ?? 100;
  const category = Types.ObjectId.isValid(input.categoryId)
    ? await CategoryModel.findById(input.categoryId)
    : null;
  if (category === null) throw new AppError(404, 'NOT_FOUND', 'Categoría no encontrada');
  const products = await ProductModel.find({ categoryId: category._id, isActive: true }).sort({
    name: 1,
  });
  const items = products
    .map((product) => ({
      product,
      from: product.price,
      to: adjustedPrice(product.price, input.percent, roundTo),
    }))
    .filter((item) => item.to !== item.from);

  if (!dryRun && items.length > 0) {
    for (const item of items) {
      await ProductModel.updateOne({ _id: item.product._id }, { $set: { price: item.to } });
    }
    await recordAudit(
      {
        action: 'PRICES_BULK_CHANGED',
        actor: toAuditActor(ctx.actor),
        entity: { type: 'CATEGORY', id: category.id, label: category.name },
        metadata: {
          percent: input.percent,
          roundTo,
          changes: Object.fromEntries(
            items.map((item) => [item.product.name, { from: item.from, to: item.to }]),
          ),
        },
        meta: ctx.meta,
      },
      ctx.logger,
    );
  }
  return {
    dryRun,
    items: items.map((item) => ({
      productId: item.product.id,
      name: item.product.name,
      from: item.from,
      to: item.to,
    })),
  };
}

/**
 * Mueve varios productos a otra categoría (y les pone la subcategoría indicada). Los almuerzos
 * no entran ni salen así: sus porciones se manejan en el menú del día.
 */
export async function bulkMoveProducts(
  input: BulkMoveProductsRequest,
  ctx: ActorContext,
): Promise<BulkMoveProductsResult> {
  const subcategory = input.subcategory ?? '';
  const target = Types.ObjectId.isValid(input.categoryId)
    ? await CategoryModel.findById(input.categoryId)
    : null;
  if (target === null) throw new AppError(404, 'NOT_FOUND', 'Categoría no encontrada');
  if (!target.isActive) throw new AppError(409, 'CONFLICT', 'La categoría está desactivada');
  if (target.kind === 'LUNCH') {
    throw new AppError(
      409,
      'CONFLICT',
      'A la categoría de almuerzos no se mueven productos en lote: créalos en el catálogo.',
    );
  }

  const ids = [...new Set(input.productIds)].map((id) => new Types.ObjectId(id));
  const [products, lunchCategories] = await Promise.all([
    ProductModel.find({ _id: trusted({ $in: ids }) }),
    CategoryModel.find({ kind: 'LUNCH' }).select('_id').lean(),
  ]);
  if (products.length !== ids.length) {
    throw new AppError(404, 'NOT_FOUND', 'Alguno de los productos ya no existe');
  }
  const lunchIds = new Set(lunchCategories.map((category) => category._id.toString()));
  const lunch = products.find((product) => lunchIds.has(product.categoryId.toString()));
  if (lunch !== undefined) {
    throw new AppError(
      409,
      'CONFLICT',
      `"${lunch.name}" es un almuerzo: sus porciones se manejan en el menú del día y no se mueve en lote.`,
    );
  }

  const toMove = products.filter(
    (product) =>
      !product.categoryId.equals(target._id) || (product.subcategory ?? '') !== subcategory,
  );
  if (toMove.length > 0) {
    await ProductModel.updateMany(
      { _id: trusted({ $in: toMove.map((product) => product._id) }) },
      { $set: { categoryId: target._id, subcategory } },
    );
    const categories = await CategoryModel.find({
      _id: trusted({ $in: [...new Set(toMove.map((product) => product.categoryId.toString()))] }),
    }).lean();
    const nameOf = new Map(categories.map((category) => [category._id.toString(), category.name]));
    await recordAudit(
      {
        action: 'PRODUCTS_BULK_MOVED',
        actor: toAuditActor(ctx.actor),
        entity: { type: 'CATEGORY', id: target.id, label: target.name },
        metadata: {
          subcategory,
          products: Object.fromEntries(
            toMove.map((product) => [
              product.name,
              { from: nameOf.get(product.categoryId.toString()) ?? '', to: target.name },
            ]),
          ),
        },
        meta: ctx.meta,
      },
      ctx.logger,
    );
  }
  return { moved: toMove.length, unchanged: products.length - toMove.length };
}
