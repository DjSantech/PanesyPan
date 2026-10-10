import {
  formatCOP,
  purchaseTotalOf,
  slugify,
  suggestedOrderQuantity,
  toBusinessDate,
  type CreatePurchaseRequest,
  type CreateSupplierReturnRequest,
  type ListPurchasesQuery,
  type OrderSuggestion,
  type Purchase,
  type SupplierReturn,
  type VoidPurchaseRequest,
} from '@panesypan/shared';
import mongoose, { trusted, Types, type QueryFilter } from 'mongoose';
import { AppError } from '../../lib/errors';
import { recordAudit } from '../audit/audit.service';
import { CashConceptModel } from '../cash/cash-config.models';
import { ensureDefaultCashConcepts } from '../cash/cash-config.service';
import { CashMovementModel } from '../cash/cash-movement.model';
import { CashShiftModel } from '../cash/cash-shift.model';
import { deleteReceipt, storeReceipt, toReceiptDto } from '../receipts/receipts.service';
import { findOpenShift, requireOpenShift, summarizeShift } from '../cash/cash.service';
import { ProductModel } from '../catalog/catalog.models';
import { InventoryItemModel } from '../inventory/inventory.models';
import { applyPurchaseStock, removeSupplierStock } from '../inventory/inventory.service';
import { resolveApproval, type PosContext } from '../sales/approval.service';
import { nextSequence, type PersonRef } from '../sales/sale.model';
import { getSettings } from '../settings/settings.service';
import { SupplierModel } from '../suppliers/supplier.model';
import { toAuditActor } from '../users/users.mapper';
import type { ActorContext } from '../users/users.service';
import {
  PurchaseModel,
  type PurchaseAttrs,
  type PurchaseDocument,
  type PurchaseLineAttrs,
  SupplierReturnModel,
  type SupplierReturnAttrs,
  type SupplierReturnDocument,
  type SupplierReturnLineAttrs,
} from './purchases.models';

const conflict = (message: string): AppError => new AppError(409, 'CONFLICT', message);
const notFound = (what: string): AppError =>
  new AppError(404, 'NOT_FOUND', `${what} no encontrado`);

function audit(
  ctx: ActorContext,
  entry: Omit<Parameters<typeof recordAudit>[0], 'actor' | 'meta'>,
) {
  return recordAudit({ ...entry, actor: toAuditActor(ctx.actor), meta: ctx.meta }, ctx.logger);
}

// ── Compras ────────────────────────────────────────────────────────

/** Adjunta (o reemplaza) la foto de la factura de una compra. */
export async function setPurchaseReceipt(
  id: string,
  data: Buffer,
  ctx: ActorContext,
): Promise<Purchase> {
  const purchase = Types.ObjectId.isValid(id) ? await PurchaseModel.findById(id) : null;
  if (purchase === null) throw notFound('Compra');
  const stored = await storeReceipt(data, ctx);
  const previous = purchase.receipt ?? null;
  purchase.receipt = stored;
  await purchase.save();
  if (previous !== null) await deleteReceipt(previous, ctx);
  await audit(ctx, {
    action: 'RECEIPT_ATTACHED',
    entity: {
      type: 'PURCHASE',
      id: purchase.id,
      label: `Compra N.º ${String(purchase.number)}`,
    },
    metadata: { replaced: previous !== null },
  });
  return toPurchaseDto(purchase);
}

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
    status: purchase.status ?? 'ACTIVE',
    voidedAt: purchase.voidedAt?.toISOString() ?? null,
    voidedBy: purchase.voidedBy?.name ?? null,
    voidReason: purchase.voidReason ?? '',
    voidCashRefunded:
      purchase.status === 'VOIDED' && purchase.paymentMethod === 'CASH_DRAWER'
        ? (purchase.voidCashMovementId ?? null) !== null
        : null,
    receipt: toReceiptDto(purchase.receipt),
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
    // Las anuladas se listan, pero no suman.
    total: purchases.reduce(
      (sum, purchase) => (purchase.status === 'VOIDED' ? sum : sum + purchase.total),
      0,
    ),
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
            // El proveedor va en su propio campo: el motivo solo lleva el número de la compra.
            reason: `Compra N.º ${String(number)}`,
            createdBy: by,
            approvedBy: approver,
            supplier: { id: supplier._id, name: supplier.name },
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

// ── Anular una compra ──────────────────────────────────────────────

/** El ingreso "Reintegro" de la caja (se crea con los tipos por defecto). */
async function refundConcept() {
  await ensureDefaultCashConcepts();
  return CashConceptModel.findOne({ type: 'INCOME', key: slugify('Reintegro'), isActive: true });
}

/**
 * Anula una compra con la autorización de un administrador y un motivo:
 * - Saca del stock lo que entró con ella (si ya se vendió o se gastó, no se puede: 409).
 * - Si se pagó con efectivo de la caja y esa caja sigue abierta, el efectivo vuelve a ella como
 *   un ingreso "Reintegro". Si la caja ya se cerró, la compra se anula igual pero el efectivo no
 *   se toca (el cierre ya quedó cuadrado).
 * - El último costo de los productos no cambia.
 */
export async function voidPurchase(
  id: string,
  input: VoidPurchaseRequest,
  ctx: PosContext,
): Promise<Purchase> {
  const existing = Types.ObjectId.isValid(id) ? await PurchaseModel.findById(id) : null;
  if (existing === null) throw new AppError(404, 'NOT_FOUND', 'Compra no encontrada');
  if (existing.status === 'VOIDED') throw conflict('Esta compra ya está anulada.');

  const approver = await resolveApproval(ctx, input.approverPin, 'PURCHASE_VOID');
  const concept = existing.paymentMethod === 'CASH_DRAWER' ? await refundConcept() : null;
  const by = { id: ctx.actor._id, name: ctx.actor.name };
  const label = `Compra N.º ${String(existing.number)}`;

  const purchase = await mongoose.connection.transaction(async (session) => {
    // La condición sobre el estado evita que dos anulaciones simultáneas devuelvan dos veces.
    const voided = await PurchaseModel.findOneAndUpdate(
      { _id: existing._id, status: trusted({ $ne: 'VOIDED' }) },
      {
        $set: {
          status: 'VOIDED',
          voidedAt: new Date(),
          voidedBy: approver,
          voidReason: input.reason,
        },
      },
      { returnDocument: 'after', session },
    );
    if (voided === null) throw conflict('Esta compra ya está anulada.');

    const stockLines = voided.lines.flatMap((line) =>
      line.productId === null ? [] : [{ productId: line.productId, quantity: line.quantity }],
    );
    await removeSupplierStock(
      stockLines,
      'PURCHASE_VOID',
      by,
      `${label} anulada · ${voided.supplier.name}`,
      session,
    );

    if (voided.paymentMethod === 'CASH_DRAWER' && voided.shiftId !== null) {
      const shift = await CashShiftModel.findOneAndUpdate(
        { _id: voided.shiftId, status: 'OPEN' },
        { $inc: { revision: 1 } },
        { returnDocument: 'after', session },
      );
      if (shift !== null) {
        const [movement] = await CashMovementModel.create(
          [
            {
              shiftId: shift._id,
              type: 'INCOME',
              amount: voided.total,
              concept: concept === null ? null : { id: concept._id, name: concept.name },
              staff: null,
              reason: `Anulación de la ${label} · ${voided.supplier.name}`,
              createdBy: by,
              approvedBy: approver,
            },
          ],
          { session },
        );
        voided.voidCashMovementId = movement?._id ?? null;
        await voided.save({ session });
      }
    }
    return voided;
  });

  await audit(ctx, {
    action: 'PURCHASE_VOIDED',
    entity: { type: 'PURCHASE', id: purchase.id, label },
    metadata: {
      supplier: purchase.supplier.name,
      total: purchase.total,
      reason: input.reason,
      paymentMethod: purchase.paymentMethod,
      cashRefunded: (purchase.voidCashMovementId ?? null) !== null,
      approvedBy: approver.name,
    },
  });
  return toPurchaseDto(purchase);
}

// ── Devoluciones a proveedor ───────────────────────────────────────

export function toSupplierReturnDto(entry: SupplierReturnDocument): SupplierReturn {
  return {
    id: entry.id,
    number: entry.number,
    businessDate: entry.businessDate,
    supplier: { id: entry.supplier.id.toString(), name: entry.supplier.name },
    lines: entry.lines.map((line) => ({
      productId: line.productId.toString(),
      name: line.name,
      quantity: line.quantity,
      unitCost: line.unitCost,
      total: line.total,
    })),
    total: entry.total,
    refundMethod: entry.refundMethod,
    note: entry.note,
    createdBy: entry.createdBy.name,
    createdAt: entry.createdAt.toISOString(),
  };
}

export async function listSupplierReturns(
  query: ListPurchasesQuery,
): Promise<{ items: SupplierReturn[]; total: number }> {
  const filter: QueryFilter<SupplierReturnAttrs> = {
    businessDate: trusted({ $gte: query.from, $lte: query.to }),
  };
  if (query.supplierId !== undefined) filter['supplier.id'] = new Types.ObjectId(query.supplierId);
  const entries = await SupplierReturnModel.find(filter).sort({ createdAt: -1 }).limit(500);
  return {
    items: entries.map(toSupplierReturnDto),
    total: entries.reduce((sum, entry) => sum + entry.total, 0),
  };
}

/**
 * Registra mercancía devuelta a un proveedor: baja el stock (nunca lo deja negativo) y el
 * reintegro entra a la caja abierta de quien la registra como un ingreso "Reintegro", o queda
 * como saldo a favor / transferencia (no toca la caja).
 */
export async function createSupplierReturn(
  input: CreateSupplierReturnRequest,
  ctx: PosContext,
): Promise<SupplierReturn> {
  const supplier = Types.ObjectId.isValid(input.supplierId)
    ? await SupplierModel.findById(input.supplierId)
    : null;
  if (supplier?.isActive !== true) throw notFound('Proveedor');

  const products = await ProductModel.find({
    _id: trusted({ $in: input.lines.map((line) => new Types.ObjectId(line.productId)) }),
  });
  const productById = new Map(products.map((product) => [product.id, product]));
  const lines: SupplierReturnLineAttrs[] = input.lines.map((line) => {
    const product = productById.get(line.productId);
    if (product === undefined) throw notFound('Producto');
    return {
      productId: product._id,
      name: product.name,
      quantity: line.quantity,
      unitCost: line.unitCost,
      total: line.quantity * line.unitCost,
    };
  });
  const total = purchaseTotalOf(lines);
  const toDrawer = input.refundMethod === 'CASH_DRAWER';
  if (toDrawer && total === 0) throw conflict('La devolución no tiene valor para reintegrar.');
  if (toDrawer && (await findOpenShift(ctx.actor.id)) === null) {
    throw new AppError(
      409,
      'CASH_SHIFT_REQUIRED',
      'Para recibir el efectivo en la caja, abre tu caja primero.',
    );
  }
  const concept = toDrawer ? await refundConcept() : null;
  const by = { id: ctx.actor._id, name: ctx.actor.name };

  const created = await mongoose.connection.transaction(async (session) => {
    const number = await nextSequence('supplier-return', session);
    const label = `Devolución N.º ${String(number)} · ${supplier.name}`;
    await removeSupplierStock(
      lines.map((line) => ({ productId: line.productId, quantity: line.quantity })),
      'SUPPLIER_RETURN',
      by,
      label,
      session,
    );

    let shiftId: Types.ObjectId | null = null;
    let cashMovementId: Types.ObjectId | null = null;
    if (toDrawer) {
      const shift = await requireOpenShift(ctx.actor.id, session);
      const [movement] = await CashMovementModel.create(
        [
          {
            shiftId: shift._id,
            type: 'INCOME',
            amount: total,
            concept: concept === null ? null : { id: concept._id, name: concept.name },
            staff: null,
            reason: `Devolución a proveedor N.º ${String(number)} · ${supplier.name}`,
            createdBy: by,
            approvedBy: null,
          },
        ],
        { session },
      );
      shiftId = shift._id;
      cashMovementId = movement?._id ?? null;
    }

    const [entry] = await SupplierReturnModel.create(
      [
        {
          number,
          businessDate: toBusinessDate(),
          supplier: { id: supplier._id, name: supplier.name },
          lines,
          total,
          refundMethod: input.refundMethod,
          shiftId,
          cashMovementId,
          note: input.note ?? '',
          createdBy: by,
        },
      ],
      { session },
    );
    if (entry === undefined) throw new Error('No se pudo registrar la devolución');
    return entry;
  });

  await audit(ctx, {
    action: 'SUPPLIER_RETURN_CREATED',
    entity: {
      type: 'SUPPLIER_RETURN',
      id: created.id,
      label: `Devolución a proveedor N.º ${String(created.number)}`,
    },
    metadata: { supplier: supplier.name, total, refundMethod: input.refundMethod },
  });
  return toSupplierReturnDto(created);
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
