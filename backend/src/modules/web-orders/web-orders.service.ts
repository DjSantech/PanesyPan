import {
  businessDateRangeUtc,
  canCancelWebOrder,
  canCheckoutWebOrder,
  computeWebOrderTotals,
  isInDeliveryZone,
  nextWebOrderStatus,
  OUT_OF_ZONE_MESSAGE,
  toBusinessDate,
  WEB_ORDER_STATUS_LABELS,
  type CreateWebOrderRequest,
  type CreateWebOrderResponse,
  type ListWebOrdersQuery,
  type Sale,
  type webOrderCheckoutRequestSchema,
  type WebOrder,
  type WebOrderStatus,
} from '@panesypan/shared';
import mongoose, { mongo, trusted, Types, type ClientSession, type QueryFilter } from 'mongoose';
import type { z } from 'zod';
import { AppError } from '../../lib/errors';
import { recordAudit } from '../audit/audit.service';
import { requireOpenShift } from '../cash/cash.service';
import { CategoryModel, DailyMenuModel, ProductModel } from '../catalog/catalog.models';
import { enqueueInvoice } from '../einvoice/einvoice.service';
import { kickEInvoiceWorker } from '../einvoice/einvoice.worker';
import { applySaleStock } from '../inventory/inventory.service';
import { resolveApproval, type PosContext } from '../sales/approval.service';
import { nextSequence, SaleModel, type SaleDocument } from '../sales/sale.model';
import {
  adjustPortions,
  assertLunchChoice,
  buildLine,
  portionChangesOf,
  type SellableProduct,
} from '../sales/sale-lines';
import { toSaleDto } from '../sales/sales.mapper';
import {
  applyCheckout,
  auditDiscountApproval,
  personOf,
  prepareCheckout,
  runInTransaction,
} from '../sales/sales.service';
import { getSettings } from '../settings/settings.service';
import { toAuditActor } from '../users/users.mapper';
import type { ActorContext } from '../users/users.service';
import {
  WebOrderModel,
  type WebOrderAttrs,
  type WebOrderDocument,
  type WebOrderLineAttrs,
} from './web-order.model';

export const WEB_ORDER_SEQUENCE = 'webOrder';

const isDuplicateKey = (error: unknown): boolean =>
  error instanceof mongo.MongoServerError && error.code === 11000;

const plainLunch = (lunch: WebOrderLineAttrs['lunch']) =>
  lunch === null
    ? null
    : { protein: lunch.protein, principle: lunch.principle, soup: lunch.soup, drink: lunch.drink };

export function toPublicWebOrder(order: WebOrderDocument): CreateWebOrderResponse['order'] {
  return {
    number: order.number,
    status: order.status,
    lines: order.lines.map((line) => ({
      productId: line.productId.toString(),
      name: line.name,
      unitPrice: line.unitPrice,
      quantity: line.quantity,
      total: line.total,
      lunch: plainLunch(line.lunch),
    })),
    subtotal: order.subtotal,
    deliveryFee: order.deliveryFee,
    total: order.total,
    createdAt: order.createdAt.toISOString(),
  };
}

/** Número de la venta de cada pedido cobrado (una sola consulta para toda la lista). */
async function saleNumbersOf(
  orders: readonly WebOrderDocument[],
): Promise<Map<string, number | null>> {
  const ids = orders.flatMap((order) => (order.saleId ? [order.saleId] : []));
  if (ids.length === 0) return new Map();
  const sales = await SaleModel.find({ _id: trusted({ $in: ids }) }, { number: 1 }).lean();
  return new Map(sales.map((sale) => [sale._id.toString(), sale.number]));
}

export function toWebOrderDto(
  order: WebOrderDocument,
  saleNumbers: ReadonlyMap<string, number | null> = new Map(),
): WebOrder {
  const { number, status, lines, subtotal, deliveryFee, total, createdAt } =
    toPublicWebOrder(order);
  const { name, phone, address, neighborhood, note } = order.customer;
  const saleId = order.saleId ? order.saleId.toString() : null;
  return {
    id: order.id,
    number,
    status,
    customer: { name, phone, address, neighborhood, note },
    lines,
    subtotal,
    deliveryFee,
    total,
    sale: saleId === null ? null : { id: saleId, number: saleNumbers.get(saleId) ?? null },
    cancelReason: order.cancelReason ?? null,
    createdAt,
    updatedAt: order.updatedAt.toISOString(),
  };
}

const unavailable = (name: string): AppError =>
  new AppError(409, 'OUT_OF_STOCK', `${name} no está disponible en este momento.`);

/**
 * Precios y nombres desde la BD, con las mismas reglas de visibilidad del catálogo público:
 * producto activo, visible en la web y disponible, de una categoría activa. Los almuerzos se
 * aceptan solo si están en el menú publicado de hoy, con la elección que exige el POS. En el
 * pedido no se descuentan porciones: se descuentan al cobrarlo.
 */
async function priceLines(input: CreateWebOrderRequest['lines'], now: Date) {
  const ids = [...new Set(input.map((line) => line.productId))];
  const products = await ProductModel.find({
    _id: trusted({ $in: ids.map((id) => new Types.ObjectId(id)) }),
  }).lean();
  const categories = await CategoryModel.find({
    _id: trusted({ $in: products.map((product) => product.categoryId) }),
  }).lean();
  const byId = new Map(products.map((product) => [product._id.toString(), product]));
  const categoryById = new Map(categories.map((category) => [category._id.toString(), category]));
  const today = toBusinessDate(now);
  const hasLunch = categories.some((category) => category.kind === 'LUNCH');
  const menu = hasLunch ? await DailyMenuModel.findOne({ date: today }) : null;

  return input.map((line) => {
    const product = byId.get(line.productId);
    const category =
      product === undefined ? undefined : categoryById.get(product.categoryId.toString());
    const sellable =
      product !== undefined &&
      product.isActive &&
      product.isAvailable &&
      Number.isSafeInteger(product.price) &&
      product.price >= 0 &&
      category?.isActive === true;
    if (!sellable) throw unavailable(product?.name ?? 'Un producto');

    if (category.kind === 'LUNCH') {
      const offering =
        menu?.isPublished === true
          ? menu.offerings.find((item) => item.productId.equals(product._id))
          : undefined;
      if (menu === null || offering === undefined) throw unavailable(product.name);
      if (offering.portions !== null && offering.sold >= offering.portions) {
        throw new AppError(409, 'OUT_OF_STOCK', `Se acabaron las porciones de ${product.name}`);
      }
      const change = {
        productId: product._id,
        name: product.name,
        menuDate: today,
        lunch: line.lunch,
        delta: line.quantity,
      };
      assertLunchChoice(menu, change, offering.withChoices);
    } else {
      if (!product.isVisibleOnline) throw unavailable(product.name);
      if (line.lunch !== null) {
        throw new AppError(400, 'VALIDATION_ERROR', `${product.name} no es un almuerzo`);
      }
    }
    return {
      productId: product._id.toString(),
      name: product.name,
      unitPrice: product.price,
      quantity: line.quantity,
      lunch: line.lunch,
    };
  });
}

/** Crea el pedido. Si el clientRequestId ya existía, devuelve el pedido original (created: false). */
export async function createWebOrder(
  input: CreateWebOrderRequest,
  now = new Date(),
): Promise<{ order: WebOrderDocument; created: boolean }> {
  const existing = await WebOrderModel.findOne({ clientRequestId: input.clientRequestId });
  if (existing !== null) return { order: existing, created: false };

  if (!isInDeliveryZone({ ...input.customer, confirmsDosquebradas: input.confirmsDosquebradas })) {
    throw new AppError(400, 'VALIDATION_ERROR', OUT_OF_ZONE_MESSAGE);
  }

  const totals = computeWebOrderTotals(await priceLines(input.lines, now));
  try {
    const order = await mongoose.connection.transaction(async (session) => {
      const number = await nextSequence(WEB_ORDER_SEQUENCE, session);
      const [created] = await WebOrderModel.create(
        [
          {
            number,
            status: 'PENDING',
            source: 'WEB',
            customer: input.customer,
            lines: totals.lines.map((line) => ({
              ...line,
              productId: new Types.ObjectId(line.productId),
            })),
            subtotal: totals.subtotal,
            deliveryFee: totals.deliveryFee,
            total: totals.total,
            statusHistory: [{ status: 'PENDING', at: now, by: null }],
            clientRequestId: input.clientRequestId,
          },
        ],
        { session },
      );
      if (created === undefined) throw new Error('No se creó el pedido web');
      return created;
    });
    return { order, created: true };
  } catch (error) {
    if (isDuplicateKey(error)) {
      const again = await WebOrderModel.findOne({ clientRequestId: input.clientRequestId });
      if (again !== null) return { order: again, created: false };
    }
    throw error;
  }
}

/** Pedidos de hoy y todos los que siguen abiertos (sin cobrar ni cancelar), más nuevos primero. */
export async function listWebOrders(query: ListWebOrdersQuery, now = new Date()) {
  const { start } = businessDateRangeUtc(toBusinessDate(now));
  const filter: QueryFilter<WebOrderAttrs> = {
    $or: [
      { createdAt: trusted({ $gte: start }) },
      { status: trusted({ $nin: ['DELIVERED', 'CANCELED'] }) },
    ],
  };
  if (query.status !== undefined) filter.status = query.status;
  const orders = await WebOrderModel.find(filter).sort({ createdAt: -1 }).limit(200);
  const saleNumbers = await saleNumbersOf(orders);
  return orders.map((order) => toWebOrderDto(order, saleNumbers));
}

const orderEntity = (order: WebOrderDocument) => ({
  type: 'WebOrder',
  id: order.id,
  label: `Pedido web #${String(order.number)}`,
});

const statusText = (status: WebOrderStatus): string =>
  WEB_ORDER_STATUS_LABELS[status].toLowerCase();

async function findOrderOrThrow(id: string, session?: ClientSession): Promise<WebOrderDocument> {
  const order = await WebOrderModel.findById(id).session(session ?? null);
  if (order === null) throw new AppError(404, 'NOT_FOUND', 'El pedido no existe.');
  return order;
}

/** Pasa el pedido al estado siguiente (y solo a ese). */
export async function updateWebOrderStatus(
  id: string,
  status: WebOrderStatus,
  ctx: ActorContext,
  now = new Date(),
): Promise<WebOrder> {
  const order = await findOrderOrThrow(id);
  const from = order.status;
  if (nextWebOrderStatus(from) !== status) {
    throw new AppError(
      409,
      'CONFLICT',
      `El pedido está ${statusText(from)}: no puede pasar a ${statusText(status)}.`,
    );
  }
  const updated = await WebOrderModel.findOneAndUpdate(
    { _id: order._id, status: from },
    {
      $set: { status },
      $push: {
        statusHistory: { status, at: now, by: { id: ctx.actor._id, name: ctx.actor.name } },
      },
    },
    { returnDocument: 'after' },
  );
  if (updated === null) {
    throw new AppError(409, 'CONFLICT', 'Otra persona cambió el pedido. Recarga la lista.');
  }
  await recordAudit(
    {
      action: 'WEB_ORDER_STATUS_CHANGED',
      actor: toAuditActor(ctx.actor),
      entity: orderEntity(updated),
      metadata: { number: updated.number, from, to: status },
      meta: ctx.meta,
    },
    ctx.logger,
  );
  return toWebOrderDto(updated);
}

// ── Cobro y cancelación ────────────────────────────────────────────

type WebOrderCheckoutInput = z.output<typeof webOrderCheckoutRequestSchema>;
type OrderProduct = Omit<SellableProduct, 'price'>;

function assertCanCheckout(order: WebOrderDocument): void {
  if (!canCheckoutWebOrder(order.status)) {
    throw new AppError(
      409,
      'CONFLICT',
      `El pedido está ${statusText(order.status)}: no se puede cobrar.`,
    );
  }
}

/** Productos del pedido para cobrarlo: si ya no existen o se archivaron, no se puede cobrar. */
async function loadOrderProducts(
  order: WebOrderDocument,
  session?: ClientSession,
): Promise<Map<string, OrderProduct>> {
  const products = await ProductModel.find({
    _id: trusted({ $in: order.lines.map((line) => line.productId) }),
  }).session(session ?? null);
  const categories = await CategoryModel.find({
    _id: trusted({ $in: products.map((product) => product.categoryId) }),
  }).session(session ?? null);
  const kindOf = new Map(categories.map((category) => [category.id, category.kind]));

  const result = new Map<string, OrderProduct>();
  for (const line of order.lines) {
    const product = products.find((item) => item._id.equals(line.productId));
    if (product?.isActive !== true) {
      throw new AppError(
        409,
        'CONFLICT',
        `${line.name} ya no está en el catálogo: no se puede cobrar este pedido.`,
      );
    }
    result.set(product.id, {
      id: product.id,
      _id: product._id,
      name: product.name,
      cost: product.cost ?? null,
      isLunch: kindOf.get(product.categoryId.toString()) === 'LUNCH',
    });
  }
  return result;
}

/** Líneas de la venta con el precio guardado en el pedido (lo que el cliente aceptó). */
function buildOrderLines(order: WebOrderDocument, products: Map<string, OrderProduct>) {
  const today = toBusinessDate();
  return order.lines.map((line) => {
    const product = products.get(line.productId.toString());
    if (product === undefined) throw new Error('Producto del pedido sin cargar');
    return buildLine(
      { ...product, price: line.unitPrice },
      line.quantity,
      '',
      today,
      plainLunch(line.lunch),
    );
  });
}

/** Un reintento del mismo cobro devuelve el pedido y la venta ya registrados. */
async function replayOrderCheckout(
  existing: SaleDocument,
  id: string,
  ctx: PosContext,
): Promise<{ order: WebOrder; sale: Sale; created: false }> {
  const order = await findOrderOrThrow(id);
  if (!existing.openedBy.id.equals(ctx.actor._id) || order.saleId?.equals(existing._id) !== true) {
    throw new AppError(409, 'CONFLICT', 'Esta venta ya se registró.');
  }
  return {
    order: toWebOrderDto(order, new Map([[existing.id, existing.number]])),
    sale: toSaleDto(existing),
    created: false,
  };
}

/**
 * Cobra el pedido: crea una venta de mostrador en la caja abierta de quien cobra, con las mismas
 * reglas del POS, y deja el pedido entregado. El domicilio se guarda en el pedido y no entra a
 * la venta ni a la caja. Venta y pedido se guardan en la misma transacción.
 */
export async function checkoutWebOrder(
  id: string,
  input: WebOrderCheckoutInput,
  ctx: PosContext,
  now = new Date(),
): Promise<{ order: WebOrder; sale: Sale; created: boolean }> {
  const existing = await SaleModel.findOne({ clientRequestId: input.clientRequestId });
  if (existing !== null) return replayOrderCheckout(existing, id, ctx);

  const current = await findOrderOrThrow(id);
  assertCanCheckout(current);
  await requireOpenShift(ctx.actor.id);
  const settings = await getSettings();
  const draft = prepareCheckout(
    buildOrderLines(current, await loadOrderProducts(current)),
    input,
    settings.maxCashierDiscountPercent,
  );
  const approver = draft.needsApproval
    ? await resolveApproval(ctx, input.approverPin, 'DISCOUNT')
    : null;

  let result: { order: WebOrderDocument; sale: SaleDocument };
  try {
    result = await runInTransaction(async (session) => {
      const order = await findOrderOrThrow(id, session);
      assertCanCheckout(order);
      const shift = await requireOpenShift(ctx.actor.id, session);
      const lines = buildOrderLines(order, await loadOrderProducts(order, session));
      const prepared = prepareCheckout(lines, input, settings.maxCashierDiscountPercent);
      await adjustPortions(portionChangesOf(lines, 1), session);
      const sale = new SaleModel({
        type: 'COUNTER',
        tableNumber: null,
        status: 'OPEN',
        lines,
        subtotal: prepared.totals.subtotal,
        total: prepared.totals.total,
        openedBy: personOf(ctx.actor),
        openedAt: new Date(),
        webOrderNumber: order.number,
      });
      await applyCheckout(sale, prepared, input, { actor: ctx.actor, approver, shift, session });
      await applySaleStock(lines, 1, personOf(ctx.actor), sale._id, session);
      await enqueueInvoice(sale, settings, session);
      await sale.save({ session });

      order.status = 'DELIVERED';
      order.saleId = sale._id;
      order.deliveryFee = input.deliveryFee;
      order.total = order.subtotal + input.deliveryFee;
      order.statusHistory.push({
        status: 'DELIVERED',
        at: now,
        by: { id: ctx.actor._id, name: ctx.actor.name },
      });
      await order.save({ session });
      return { order, sale };
    });
  } catch (error) {
    if (isDuplicateKey(error)) {
      const again = await SaleModel.findOne({ clientRequestId: input.clientRequestId });
      if (again !== null) return replayOrderCheckout(again, id, ctx);
    }
    throw error;
  }

  kickEInvoiceWorker();
  const { order, sale } = result;
  await auditDiscountApproval(sale, approver, ctx);
  await recordAudit(
    {
      action: 'WEB_ORDER_CHARGED',
      actor: toAuditActor(ctx.actor),
      entity: orderEntity(order),
      metadata: {
        number: order.number,
        saleNumber: sale.number,
        total: sale.total,
        deliveryFee: input.deliveryFee,
      },
      meta: ctx.meta,
    },
    ctx.logger,
  );
  return {
    order: toWebOrderDto(order, new Map([[sale.id, sale.number]])),
    sale: toSaleDto(sale),
    created: true,
  };
}

/** Cancela el pedido mientras no se haya cobrado. */
export async function cancelWebOrder(
  id: string,
  reason: string,
  ctx: ActorContext,
  now = new Date(),
): Promise<WebOrder> {
  const order = await findOrderOrThrow(id);
  const from = order.status;
  if (!canCancelWebOrder(from)) {
    throw new AppError(
      409,
      'CONFLICT',
      `El pedido está ${statusText(from)}: no se puede cancelar.`,
    );
  }
  const updated = await WebOrderModel.findOneAndUpdate(
    { _id: order._id, status: from },
    {
      $set: { status: 'CANCELED', cancelReason: reason },
      $push: {
        statusHistory: {
          status: 'CANCELED',
          at: now,
          by: { id: ctx.actor._id, name: ctx.actor.name },
        },
      },
    },
    { returnDocument: 'after' },
  );
  if (updated === null) {
    throw new AppError(409, 'CONFLICT', 'Otra persona cambió el pedido. Recarga la lista.');
  }
  await recordAudit(
    {
      action: 'WEB_ORDER_CANCELED',
      actor: toAuditActor(ctx.actor),
      entity: orderEntity(updated),
      metadata: { number: updated.number, from, note: reason },
      meta: ctx.meta,
    },
    ctx.logger,
  );
  return toWebOrderDto(updated);
}
