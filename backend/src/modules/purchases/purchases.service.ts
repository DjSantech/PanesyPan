import {
  formatCOP,
  purchaseTotalOf,
  slugify,
  suggestedOrderQuantity,
  toBusinessDate,
  type CreatePurchaseRequest,
  type CreateSupplierRequest,
  type ListPurchasesQuery,
  type OrderSuggestion,
  type Purchase,
  type Supplier,
  type UpdateSupplierRequest,
} from '@panesypan/shared';
import mongoose, { mongo, trusted, Types, type QueryFilter } from 'mongoose';
import { AppError } from '../../lib/errors';
import { recordAudit } from '../audit/audit.service';
import { CashConceptModel } from '../cash/cash-config.models';
import { ensureDefaultCashConcepts } from '../cash/cash-config.service';
import { CashMovementModel } from '../cash/cash-movement.model';
import { findOpenShift, requireOpenShift, summarizeShift } from '../cash/cash.service';
import { ProductModel } from '../catalog/catalog.models';
import { InventoryItemModel } from '../inventory/inventory.models';
import { applyPurchaseStock } from '../inventory/inventory.service';
import { resolveApproval, type PosContext } from '../sales/approval.service';
import { nextSequence, type PersonRef } from '../sales/sale.model';
import { getSettings } from '../settings/settings.service';
import { toAuditActor } from '../users/users.mapper';
import type { ActorContext } from '../users/users.service';
import {
  PurchaseModel,
  SupplierModel,
  type PurchaseAttrs,
  type PurchaseDocument,
  type PurchaseLineAttrs,
  type SupplierDocument,
} from './purchases.models';

const conflict = (message: string): AppError => new AppError(409, 'CONFLICT', message);
const notFound = (what: string): AppError =>
  new AppError(404, 'NOT_FOUND', `${what} no encontrado`);
const isDuplicateKey = (error: unknown): boolean =>
  error instanceof mongo.MongoServerError && error.code === 11000;

function audit(
  ctx: ActorContext,
  entry: Omit<Parameters<typeof recordAudit>[0], 'actor' | 'meta'>,
) {
  return recordAudit({ ...entry, actor: toAuditActor(ctx.actor), meta: ctx.meta }, ctx.logger);
}

// ── Proveedores ────────────────────────────────────────────────────

function toSupplierDto(supplier: SupplierDocument): Supplier {
  return {
    id: supplier.id,
    name: supplier.name,
    phone: supplier.phone,
    taxId: supplier.taxId,
    notes: supplier.notes,
    isActive: supplier.isActive,
  };
}

const supplierEntity = (supplier: SupplierDocument) => ({
  type: 'SUPPLIER',
  id: supplier.id,
  label: supplier.name,
});
const duplicateSupplier = () => conflict('Ya existe un proveedor con ese nombre');

export async function listSuppliers(options: { activeOnly: boolean }): Promise<Supplier[]> {
  const suppliers = await SupplierModel.find(options.activeOnly ? { isActive: true } : {}).sort({
    isActive: -1,
    name: 1,
  });
  return suppliers.map(toSupplierDto);
}

export async function createSupplier(
  input: CreateSupplierRequest,
  ctx: ActorContext,
): Promise<Supplier> {
  let supplier: SupplierDocument;
  try {
    supplier = await SupplierModel.create({
      name: input.name,
      key: slugify(input.name),
      phone: input.phone ?? '',
      taxId: input.taxId ?? '',
      notes: input.notes ?? '',
    });
  } catch (error) {
    if (isDuplicateKey(error)) throw duplicateSupplier();
    throw error;
  }
  await audit(ctx, { action: 'SUPPLIER_CREATED', entity: supplierEntity(supplier) });
  return toSupplierDto(supplier);
}

export async function updateSupplier(
  id: string,
  input: UpdateSupplierRequest,
  ctx: ActorContext,
): Promise<Supplier> {
  const supplier = Types.ObjectId.isValid(id) ? await SupplierModel.findById(id) : null;
  if (supplier === null) throw notFound('Proveedor');
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  if (input.name !== undefined && input.name !== supplier.name) {
    const key = slugify(input.name);
    if ((await SupplierModel.exists({ key, _id: trusted({ $ne: supplier._id }) })) !== null) {
      throw duplicateSupplier();
    }
    changes.name = { from: supplier.name, to: input.name };
    supplier.name = input.name;
    supplier.key = key;
  }
  for (const field of ['phone', 'taxId', 'notes', 'isActive'] as const) {
    const next = input[field];
    if (next !== undefined && next !== supplier[field]) {
      changes[field] = { from: supplier[field], to: next };
      supplier.set(field, next);
    }
  }
  if (Object.keys(changes).length === 0) return toSupplierDto(supplier);
  try {
    await supplier.save();
  } catch (error) {
    if (isDuplicateKey(error)) throw duplicateSupplier();
    throw error;
  }
  await audit(ctx, {
    action: 'SUPPLIER_UPDATED',
    entity: supplierEntity(supplier),
    metadata: { changes },
  });
  return toSupplierDto(supplier);
}

// ── Compras ────────────────────────────────────────────────────────

export function toPurchaseDto(purchase: PurchaseDocument): Purchase {
  return {
    id: purchase.id,
    number: purchase.number,
    businessDate: purchase.businessDate,
    supplier: { id: purchase.supplier.id.toString(), name: purchase.supplier.name },
    lines: purchase.lines.map((line) => ({
      productId: line.productId?.toString() ?? null,
      name: line.name,
      quantity: line.quantity,
      unitCost: line.unitCost,
      total: line.total,
    })),
    total: purchase.total,
    paymentMethod: purchase.paymentMethod,
    reference: purchase.reference,
    note: purchase.note,
    createdBy: purchase.createdBy.name,
    approvedBy: purchase.approvedBy?.name ?? null,
    createdAt: purchase.createdAt.toISOString(),
  };
}

export async function listPurchases(
  query: ListPurchasesQuery,
): Promise<{ items: Purchase[]; total: number }> {
  const filter: QueryFilter<PurchaseAttrs> = {
    businessDate: trusted({ $gte: query.from, $lte: query.to }),
  };
  if (query.supplierId !== undefined) filter['supplier.id'] = new Types.ObjectId(query.supplierId);
  const purchases = await PurchaseModel.find(filter).sort({ createdAt: -1 }).limit(500);
  return {
    items: purchases.map(toPurchaseDto),
    total: purchases.reduce((sum, purchase) => sum + purchase.total, 0),
  };
}

/**
 * Registra una compra de contado:
 * - Los productos del catálogo suben su stock (si lo controlan) y quedan con el costo de esta
 *   compra (último costo). Lo que no está en el catálogo (insumos) solo queda en la compra.
 * - Con efectivo de la caja: sale de la caja abierta de quien la registra como un egreso del
 *   tipo "Proveedor" (sin registrarlo dos veces). Sobre el tope de egresos de la cajera pide el
 *   PIN de un administrador, y nunca saca más efectivo del que hay.
 * - Por transferencia o banco: no toca la caja.
 */
export async function createPurchase(
  input: CreatePurchaseRequest,
  ctx: PosContext,
): Promise<Purchase> {
  const supplier = Types.ObjectId.isValid(input.supplierId)
    ? await SupplierModel.findById(input.supplierId)
    : null;
  if (supplier?.isActive !== true) throw notFound('Proveedor');

  const productIds = input.lines.flatMap((line) =>
    line.productId === undefined ? [] : [new Types.ObjectId(line.productId)],
  );
  const products = await ProductModel.find({ _id: trusted({ $in: productIds }), isActive: true });
  const productById = new Map(products.map((product) => [product.id, product]));

  const lines: PurchaseLineAttrs[] = input.lines.map((line) => {
    const product = line.productId === undefined ? undefined : productById.get(line.productId);
    if (line.productId !== undefined && product === undefined) throw notFound('Producto');
    return {
      productId: product?._id ?? null,
      name: product?.name ?? (line.description ?? '').trim(),
      quantity: line.quantity,
      unitCost: line.unitCost,
      total: line.quantity * line.unitCost,
    };
  });
  const total = purchaseTotalOf(lines);
  const fromDrawer = input.paymentMethod === 'CASH_DRAWER';

  let approver: PersonRef | null = null;
  if (fromDrawer) {
    if ((await findOpenShift(ctx.actor.id)) === null) {
      throw new AppError(
        409,
        'CASH_SHIFT_REQUIRED',
        'Para pagar con efectivo de la caja, abre tu caja primero.',
      );
    }
    const { maxCashierExpense } = await getSettings();
    if (total > maxCashierExpense)
      approver = await resolveApproval(ctx, input.approverPin, 'EXPENSE');
  }
  await ensureDefaultCashConcepts();
  const concept = fromDrawer
    ? await CashConceptModel.findOne({ type: 'EXPENSE', key: slugify('Proveedor'), isActive: true })
    : null;
  const by = { id: ctx.actor._id, name: ctx.actor.name };

  const purchase = await mongoose.connection.transaction(async (session) => {
    const number = await nextSequence('purchase', session);
    const label = `Compra N.º ${String(number)} · ${supplier.name}`;

    let shiftId: Types.ObjectId | null = null;
    let cashMovementId: Types.ObjectId | null = null;
    if (fromDrawer) {
      const shift = await requireOpenShift(ctx.actor.id, session);
      const { expectedCash } = await summarizeShift(shift, session);
      if (total > expectedCash) {
        throw conflict(
          `En la caja solo hay ${formatCOP(expectedCash)} en efectivo: no alcanza para pagar ${formatCOP(total)}.`,
        );
      }
      const [movement] = await CashMovementModel.create(
        [
          {
            shiftId: shift._id,
            type: 'EXPENSE',
            amount: total,
            concept: concept === null ? null : { id: concept._id, name: concept.name },
            staff: null,
            reason: label,
            createdBy: by,
            approvedBy: approver,
          },
        ],
        { session },
      );
      shiftId = shift._id;
      cashMovementId = movement?._id ?? null;
    }

    const stockLines = lines.flatMap((line) =>
      line.productId === null ? [] : [{ productId: line.productId, quantity: line.quantity }],
    );
    await applyPurchaseStock(stockLines, by, label, session);
    // Último costo: si el producto viene dos veces, queda el de la última línea.
    for (const line of lines) {
      if (line.productId === null) continue;
      await ProductModel.updateOne(
        { _id: line.productId },
        { $set: { cost: line.unitCost } },
        { session },
      );
    }

    const [created] = await PurchaseModel.create(
      [
        {
          number,
          businessDate: toBusinessDate(),
          supplier: { id: supplier._id, name: supplier.name },
          lines,
          total,
          paymentMethod: input.paymentMethod,
          shiftId,
          cashMovementId,
          reference: input.reference ?? '',
          note: input.note ?? '',
          createdBy: by,
          approvedBy: approver,
        },
      ],
      { session },
    );
    if (created === undefined) throw new Error('No se pudo registrar la compra');
    return created;
  });

  await audit(ctx, {
    action: 'PURCHASE_CREATED',
    entity: { type: 'PURCHASE', id: purchase.id, label: `Compra N.º ${String(purchase.number)}` },
    metadata: {
      supplier: supplier.name,
      total,
      paymentMethod: input.paymentMethod,
      approvedBy: approver?.name ?? null,
    },
  });
  return toPurchaseDto(purchase);
}

// ── Pedido sugerido ────────────────────────────────────────────────

/** Productos en el mínimo o por debajo, agrupados por su proveedor principal. */
export async function getOrderSuggestions(): Promise<OrderSuggestion[]> {
  const low = (await InventoryItemModel.find({ minStock: trusted({ $gt: 0 }) })).filter(
    (item) => item.quantity <= item.minStock,
  );
  if (low.length === 0) return [];
  const products = await ProductModel.find({
    _id: trusted({ $in: low.map((item) => item.productId) }),
    isActive: true,
    trackStock: true,
  }).sort({ name: 1 });
  const itemByProduct = new Map(low.map((item) => [item.productId.toString(), item]));
  const supplierIds = products.flatMap((product) =>
    product.supplierId === null ? [] : [product.supplierId],
  );
  const suppliers = await SupplierModel.find({ _id: trusted({ $in: supplierIds }) });
  const supplierById = new Map(suppliers.map((supplier) => [supplier.id, supplier]));

  const groups = new Map<string, OrderSuggestion>();
  for (const product of products) {
    const item = itemByProduct.get(product.id);
    if (item === undefined) continue;
    const supplier =
      product.supplierId === null ? undefined : supplierById.get(product.supplierId.toString());
    const key = supplier?.id ?? 'sin-proveedor';
    const group = groups.get(key) ?? {
      supplier:
        supplier === undefined
          ? null
          : { id: supplier.id, name: supplier.name, phone: supplier.phone },
      items: [],
    };
    group.items.push({
      productId: product.id,
      name: product.name,
      quantity: item.quantity,
      minStock: item.minStock,
      suggested: suggestedOrderQuantity(item.quantity, item.minStock),
      cost: product.cost ?? null,
    });
    groups.set(key, group);
  }
  // Primero los que tienen proveedor (por nombre); al final los que no tienen.
  return [...groups.values()].sort((a, b) => {
    if (a.supplier === null) return 1;
    if (b.supplier === null) return -1;
    return a.supplier.name.localeCompare(b.supplier.name, 'es');
  });
}
