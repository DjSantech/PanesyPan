import {
  computeSaleTotals,
  type counterCheckoutRequestSchema,
  discountNeedsApproval,
  discountProblem,
  formatCOP,
  hasPermission,
  settlePayments,
  type tabCheckoutRequestSchema,
  toBusinessDate,
  type CloseSaleRequest,
  type ListSalesQuery,
  type PricedLine,
  type Sale,
  type SaleTotals,
} from '@panesypan/shared';
import mongoose, { mongo, trusted, Types, type ClientSession, type QueryFilter } from 'mongoose';
import type { z } from 'zod';
import { AppError } from '../../lib/errors';
import { recordAudit } from '../audit/audit.service';
import { CashShiftModel, type CashShiftDocument } from '../cash/cash-shift.model';
import { findOpenShift, requireOpenShift } from '../cash/cash.service';
import { applySaleStock } from '../inventory/inventory.service';
import { getSettings } from '../settings/settings.service';
import type { UserDocument } from '../users/user.model';
import { toAuditActor } from '../users/users.mapper';
import type { ActorContext } from '../users/users.service';
import { resolveApproval, type PosContext } from './approval.service';
import {
  nextSequence,
  SaleModel,
  type PersonRef,
  type SaleAttrs,
  type SaleDocument,
} from './sale.model';
import {
  adjustPortions,
  buildLine,
  loadSellableProducts,
  portionChangesOf,
  type SellableProduct,
} from './sale-lines';
import { toSaleDto } from './sales.mapper';

type CounterCheckoutInput = z.output<typeof counterCheckoutRequestSchema>;
type TabCheckoutInput = z.output<typeof tabCheckoutRequestSchema>;
type CheckoutFields = TabCheckoutInput;

const SALE_SEQUENCE = 'sale';

export const notFound = (): AppError => new AppError(404, 'NOT_FOUND', 'Venta no encontrada');
export const conflict = (message: string): AppError => new AppError(409, 'CONFLICT', message);

export const personOf = (user: UserDocument): PersonRef => ({ id: user._id, name: user.name });

export const saleEntity = (sale: SaleDocument) => ({
  type: 'SALE',
  id: sale.id,
  label:
    sale.number === null
      ? `Mesa ${String(sale.tableNumber ?? '')}`
      : `Venta #${String(sale.number)}`,
});

/** Transacción con reintento automático ante conflictos de escritura. */
export function runInTransaction<T>(fn: (session: ClientSession) => Promise<T>): Promise<T> {
  return mongoose.connection.transaction(fn);
}

export async function findSaleOrThrow(id: string, session?: ClientSession): Promise<SaleDocument> {
  const sale = await SaleModel.findById(id).session(session ?? null);
  if (sale === null) throw notFound();
  return sale;
}

export function productFor(products: Map<string, SellableProduct>, id: string): SellableProduct {
  const product = products.get(id);
  if (product === undefined) throw new AppError(404, 'NOT_FOUND', 'Producto no encontrado');
  return product;
}

// ── Cobro ──────────────────────────────────────────────────────────

interface PreparedCheckout {
  totals: SaleTotals;
  change: number;
  cashReceived: number | null;
  needsApproval: boolean;
}

/** Valida total, descuento y pagos. La API recalcula todo: la tablet solo propone. */
function prepareCheckout(
  lines: readonly PricedLine[],
  input: CheckoutFields,
  maxDiscountPercent: number,
): PreparedCheckout {
  const totals = computeSaleTotals(lines, input.discount);
  if (totals.total !== input.expectedTotal) {
    throw new AppError(
      409,
      'TOTAL_MISMATCH',
      `El total cambió: ahora es ${formatCOP(totals.total)}. Revisa la cuenta.`,
      { total: totals.total },
    );
  }
  const problem = discountProblem(totals);
  if (problem !== null) throw new AppError(400, 'VALIDATION_ERROR', problem);
  const settlement = settlePayments(totals.total, input.payments, input.cashReceived);
  if (!settlement.ok) throw new AppError(400, 'VALIDATION_ERROR', settlement.message);
  return {
    totals,
    change: settlement.change,
    cashReceived: settlement.cashReceived,
    needsApproval: input.discount !== null && discountNeedsApproval(totals, maxDiscountPercent),
  };
}

interface PaymentContext {
  actor: UserDocument;
  approver: PersonRef | null;
  shift: CashShiftDocument;
  session: ClientSession;
}

async function applyCheckout(
  sale: SaleDocument,
  prepared: PreparedCheckout,
  input: CheckoutFields,
  { actor, approver, shift, session }: PaymentContext,
): Promise<void> {
  if (prepared.needsApproval && approver === null) {
    throw new AppError(
      403,
      'APPROVAL_REQUIRED',
      'Este descuento necesita la autorización de un administrador.',
    );
  }
  const now = new Date();
  const { totals } = prepared;
  sale.subtotal = totals.subtotal;
  sale.discount =
    input.discount === null
      ? null
      : {
          mode: input.discount.mode,
          value: input.discount.value,
          amount: totals.discount,
          reason: input.discount.reason,
          approvedBy: prepared.needsApproval ? approver : null,
        };
  sale.total = totals.total;
  sale.payments = input.payments.map((payment) => ({
    method: payment.method,
    amount: payment.amount,
    reference: payment.reference,
  }));
  sale.cashReceived = prepared.cashReceived;
  sale.change = prepared.change;
  sale.shiftId = shift._id;
  sale.paidBy = personOf(actor);
  sale.paidAt = now;
  sale.businessDate = toBusinessDate(now);
  sale.clientRequestId = input.clientRequestId;
  sale.number = await nextSequence(SALE_SEQUENCE, session);
  sale.status = 'PAID';
}

async function auditDiscountApproval(
  sale: SaleDocument,
  approver: PersonRef | null,
  ctx: ActorContext,
): Promise<void> {
  if (approver === null || approver.id.equals(ctx.actor._id) || sale.discount === null) return;
  await recordAudit(
    {
      action: 'SALE_DISCOUNT_APPROVED',
      actor: toAuditActor(ctx.actor),
      entity: saleEntity(sale),
      metadata: {
        saleNumber: sale.number,
        discount: sale.discount.amount,
        note: sale.discount.reason,
        approvedBy: approver.name,
      },
      meta: ctx.meta,
    },
    ctx.logger,
  );
}

const isDuplicateKey = (error: unknown): boolean =>
  error instanceof mongo.MongoServerError && error.code === 11000;

/** Un reintento del mismo cobro devuelve la venta ya registrada en vez de cobrar dos veces. */
function replayCheckout(existing: SaleDocument, ctx: ActorContext): { sale: Sale; created: false } {
  if (!existing.openedBy.id.equals(ctx.actor._id)) throw conflict('Esta venta ya se registró.');
  return { sale: toSaleDto(existing), created: false };
}

/** Venta de mostrador: se arma el pedido en la tablet y se cobra en un solo paso. */
export async function checkoutCounter(
  input: CounterCheckoutInput,
  ctx: PosContext,
): Promise<{ sale: Sale; created: boolean }> {
  const existing = await SaleModel.findOne({ clientRequestId: input.clientRequestId });
  if (existing !== null) return replayCheckout(existing, ctx);

  await requireOpenShift(ctx.actor.id);
  const settings = await getSettings();
  const productIds = input.lines.map((line) => line.productId);
  const buildLines = (products: Map<string, SellableProduct>, today: string) =>
    input.lines.map((line) =>
      buildLine(productFor(products, line.productId), line.quantity, line.note, today),
    );

  const draft = prepareCheckout(
    buildLines(await loadSellableProducts(productIds), toBusinessDate()),
    input,
    settings.maxCashierDiscountPercent,
  );
  const approver = draft.needsApproval
    ? await resolveApproval(ctx, input.approverPin, 'DISCOUNT')
    : null;

  let sale: SaleDocument;
  try {
    sale = await runInTransaction(async (session) => {
      const shift = await requireOpenShift(ctx.actor.id, session);
      const lines = buildLines(await loadSellableProducts(productIds, session), toBusinessDate());
      const prepared = prepareCheckout(lines, input, settings.maxCashierDiscountPercent);
      await adjustPortions(portionChangesOf(lines, 1), session);
      const created = new SaleModel({
        type: 'COUNTER',
        tableNumber: null,
        status: 'OPEN',
        lines,
        subtotal: prepared.totals.subtotal,
        total: prepared.totals.total,
        openedBy: personOf(ctx.actor),
        openedAt: new Date(),
      });
      await applyCheckout(created, prepared, input, { actor: ctx.actor, approver, shift, session });
      await applySaleStock(lines, 1, personOf(ctx.actor), created._id, session);
      await created.save({ session });
      return created;
    });
  } catch (error) {
    if (isDuplicateKey(error)) {
      const again = await SaleModel.findOne({ clientRequestId: input.clientRequestId });
      if (again !== null) return replayCheckout(again, ctx);
    }
    throw error;
  }

  await auditDiscountApproval(sale, approver, ctx);
  return { sale: toSaleDto(sale), created: true };
}

export function assertOpenTab(sale: SaleDocument): void {
  if (sale.status !== 'OPEN' || sale.type !== 'TABLE') {
    throw conflict('Esta cuenta ya fue cobrada o cancelada.');
  }
}

/** Cobro de la cuenta de una mesa. */
export async function checkoutTab(
  id: string,
  input: TabCheckoutInput,
  ctx: PosContext,
): Promise<Sale> {
  const current = await findSaleOrThrow(id);
  if (current.status === 'PAID' && current.clientRequestId === input.clientRequestId) {
    return toSaleDto(current);
  }
  assertOpenTab(current);
  if (current.lines.length === 0) {
    throw new AppError(400, 'VALIDATION_ERROR', 'La cuenta está vacía.');
  }
  await requireOpenShift(ctx.actor.id);
  const settings = await getSettings();
  const draft = prepareCheckout(current.lines, input, settings.maxCashierDiscountPercent);
  const approver = draft.needsApproval
    ? await resolveApproval(ctx, input.approverPin, 'DISCOUNT')
    : null;

  const sale = await runInTransaction(async (session) => {
    const tab = await findSaleOrThrow(id, session);
    assertOpenTab(tab);
    const shift = await requireOpenShift(ctx.actor.id, session);
    // Si otra cajera agregó algo mientras se cobraba, el total cambia y se avisa.
    const prepared = prepareCheckout(tab.lines, input, settings.maxCashierDiscountPercent);
    await applyCheckout(tab, prepared, input, { actor: ctx.actor, approver, shift, session });
    await applySaleStock(tab.lines, 1, personOf(ctx.actor), tab._id, session);
    await tab.save({ session });
    return tab;
  });

  await auditDiscountApproval(sale, approver, ctx);
  return toSaleDto(sale);
}

// ── Anulación ──────────────────────────────────────────────────────

/**
 * Anula una venta pagada: se devuelven las porciones y deja de contar en la caja.
 * Solo mientras la caja de la venta siga abierta (una caja cerrada no se modifica).
 */
export async function voidSale(
  id: string,
  input: CloseSaleRequest,
  ctx: PosContext,
): Promise<Sale> {
  const sale = await findSaleOrThrow(id);
  if (sale.status !== 'PAID') throw conflict('Solo se pueden anular ventas pagadas.');
  const shift = sale.shiftId === null ? null : await CashShiftModel.findById(sale.shiftId);
  if (shift?.status !== 'OPEN') {
    throw conflict('La caja de esta venta ya se cerró: no se puede anular.');
  }
  if (!hasPermission(ctx.actor.role, 'sales:void:approve') && !shift.userId.equals(ctx.actor._id)) {
    throw new AppError(403, 'FORBIDDEN', 'Solo puedes anular ventas de tu propia caja.');
  }
  const approver = await resolveApproval(ctx, input.approverPin, 'VOID');

  const voided = await runInTransaction(async (session) => {
    const doc = await findSaleOrThrow(id, session);
    if (doc.status !== 'PAID') throw conflict('La venta ya fue anulada.');
    doc.status = 'VOIDED';
    doc.closure = {
      at: new Date(),
      by: personOf(ctx.actor),
      approvedBy: approver,
      reason: input.reason,
    };
    await adjustPortions(portionChangesOf(doc.lines, -1), session);
    await applySaleStock(doc.lines, -1, personOf(ctx.actor), doc._id, session);
    await doc.save({ session });
    return doc;
  });

  await recordAudit(
    {
      action: 'SALE_VOIDED',
      actor: toAuditActor(ctx.actor),
      entity: saleEntity(voided),
      metadata: {
        saleNumber: voided.number,
        total: voided.total,
        note: input.reason,
        approvedBy: approver.name,
      },
      meta: ctx.meta,
    },
    ctx.logger,
  );
  return toSaleDto(voided);
}

// ── Consultas ──────────────────────────────────────────────────────

/**
 * La cajera ve las ventas de su caja abierta. Quien tiene acceso a reportes ve las de
 * cualquier día o caja.
 */
export async function listSales(query: ListSalesQuery, ctx: ActorContext): Promise<Sale[]> {
  const filter: QueryFilter<SaleAttrs> = {};
  if (hasPermission(ctx.actor.role, 'reports:read')) {
    if (query.shiftId !== undefined) filter.shiftId = new Types.ObjectId(query.shiftId);
    else filter.businessDate = query.date ?? toBusinessDate();
  } else {
    const shift = await findOpenShift(ctx.actor.id);
    if (shift === null) return [];
    filter.shiftId = shift._id;
  }
  filter.status = query.status ?? trusted({ $in: ['PAID', 'VOIDED', 'CANCELED'] });

  const sales = await SaleModel.find(filter).sort({ paidAt: -1, openedAt: -1 }).limit(1_000);
  return sales.map(toSaleDto);
}

export async function getSale(id: string): Promise<Sale> {
  return toSaleDto(await findSaleOrThrow(id));
}
