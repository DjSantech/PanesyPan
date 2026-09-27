import {
  businessDateRangeUtc,
  computeWebOrderTotals,
  isInDeliveryZone,
  nextWebOrderStatus,
  OUT_OF_ZONE_MESSAGE,
  toBusinessDate,
  WEB_ORDER_STATUS_LABELS,
  type CreateWebOrderRequest,
  type CreateWebOrderResponse,
  type ListWebOrdersQuery,
  type WebOrder,
  type WebOrderStatus,
} from '@panesypan/shared';
import mongoose, { mongo, trusted, Types, type QueryFilter } from 'mongoose';
import { AppError } from '../../lib/errors';
import { recordAudit } from '../audit/audit.service';
import { CategoryModel, ProductModel } from '../catalog/catalog.models';
import { nextSequence } from '../sales/sale.model';
import { toAuditActor } from '../users/users.mapper';
import type { ActorContext } from '../users/users.service';
import { WebOrderModel, type WebOrderAttrs, type WebOrderDocument } from './web-order.model';

export const WEB_ORDER_SEQUENCE = 'webOrder';

const isDuplicateKey = (error: unknown): boolean =>
  error instanceof mongo.MongoServerError && error.code === 11000;

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
      lunch: null,
    })),
    subtotal: order.subtotal,
    deliveryFee: order.deliveryFee,
    total: order.total,
    createdAt: order.createdAt.toISOString(),
  };
}

export function toWebOrderDto(order: WebOrderDocument): WebOrder {
  const { number, status, lines, subtotal, deliveryFee, total, createdAt } =
    toPublicWebOrder(order);
  const { name, phone, address, neighborhood, note } = order.customer;
  return {
    id: order.id,
    number,
    status,
    customer: { name, phone, address, neighborhood, note },
    lines,
    subtotal,
    deliveryFee,
    total,
    sale: null,
    cancelReason: null,
    createdAt,
    updatedAt: order.updatedAt.toISOString(),
  };
}

/**
 * Precios y nombres desde la BD, con las mismas reglas de visibilidad del catálogo público:
 * producto activo, visible en la web y disponible, de una categoría activa que no es de almuerzos.
 */
async function priceLines(input: CreateWebOrderRequest['lines']) {
  const ids = [...new Set(input.map((line) => line.productId))];
  const products = await ProductModel.find({
    _id: trusted({ $in: ids.map((id) => new Types.ObjectId(id)) }),
  }).lean();
  const categories = await CategoryModel.find({
    _id: trusted({ $in: products.map((product) => product.categoryId) }),
  }).lean();
  const byId = new Map(products.map((product) => [product._id.toString(), product]));
  const categoryById = new Map(categories.map((category) => [category._id.toString(), category]));

  return input.map((line) => {
    const product = byId.get(line.productId);
    const category =
      product === undefined ? undefined : categoryById.get(product.categoryId.toString());
    const sellable =
      product !== undefined &&
      product.isActive &&
      product.isVisibleOnline &&
      product.isAvailable &&
      Number.isSafeInteger(product.price) &&
      product.price >= 0 &&
      category?.isActive === true &&
      category.kind !== 'LUNCH';
    if (!sellable) {
      const name = product?.name ?? 'Un producto';
      throw new AppError(409, 'OUT_OF_STOCK', `${name} no está disponible en este momento.`);
    }
    return {
      productId: product._id.toString(),
      name: product.name,
      unitPrice: product.price,
      quantity: line.quantity,
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

  const totals = computeWebOrderTotals(await priceLines(input.lines));
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

/** Pedidos de hoy y todos los que siguen sin entregar, más nuevos primero. */
export async function listWebOrders(query: ListWebOrdersQuery, now = new Date()) {
  const { start } = businessDateRangeUtc(toBusinessDate(now));
  const filter: QueryFilter<WebOrderAttrs> = {
    $or: [{ createdAt: trusted({ $gte: start }) }, { status: trusted({ $ne: 'DELIVERED' }) }],
  };
  if (query.status !== undefined) filter.status = query.status;
  const orders = await WebOrderModel.find(filter).sort({ createdAt: -1 }).limit(200);
  return orders.map(toWebOrderDto);
}

/** Pasa el pedido al estado siguiente (y solo a ese). */
export async function updateWebOrderStatus(
  id: string,
  status: WebOrderStatus,
  ctx: ActorContext,
  now = new Date(),
): Promise<WebOrder> {
  const order = await WebOrderModel.findById(id);
  if (order === null) throw new AppError(404, 'NOT_FOUND', 'El pedido no existe.');
  const from = order.status;
  if (nextWebOrderStatus(from) !== status) {
    throw new AppError(
      409,
      'CONFLICT',
      `El pedido está ${WEB_ORDER_STATUS_LABELS[from].toLowerCase()}: no puede pasar a ${WEB_ORDER_STATUS_LABELS[status].toLowerCase()}.`,
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
      entity: { type: 'WebOrder', id: updated.id, label: `Pedido web #${String(updated.number)}` },
      metadata: { number: updated.number, from, to: status },
      meta: ctx.meta,
    },
    ctx.logger,
  );
  return toWebOrderDto(updated);
}
