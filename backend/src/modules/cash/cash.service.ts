import {
  CASH_MOVEMENT_LABELS,
  cashDifference,
  countDenominations,
  expectedCashOf,
  formatCOP,
  isDenomination,
  PAYMENT_METHODS,
  toBusinessDate,
  type CashMovement,
  type CashShift,
  type CashShiftSummary,
  type CashShiftDetail,
  type CloseCashShiftRequest,
  type ConfirmCashShiftRequest,
  type ListCashShiftsQuery,
  type CreateCashMovementRequest,
  type UpdateCashMovementRequest,
  type VoidCashMovementRequest,
  type DenominationCount,
  type OpenCashShiftRequest,
  type PaymentMethod,
} from '@panesypan/shared';
import mongoose, { mongo, trusted, Types, type ClientSession, type QueryFilter } from 'mongoose';
import { AppError } from '../../lib/errors';
import { recordAudit } from '../audit/audit.service';
import { userCan } from '../profiles/effective-permissions';
import { getShiftReport } from '../reports/performance.service';
import { PurchaseModel } from '../purchases/purchases.models';
import { deleteReceipt, storeReceipt, toReceiptDto } from '../receipts/receipts.service';
import { resolveApproval, type PosContext } from '../sales/approval.service';
import { nextSequence, SaleModel } from '../sales/sale.model';
import { getSettings } from '../settings/settings.service';
import { SupplierModel } from '../suppliers/supplier.model';
import { toAuditActor } from '../users/users.mapper';
import type { ActorContext } from '../users/users.service';
import { findActiveConcept, findActiveStaffMember } from './cash-config.service';
import { CashMovementModel, type CashMovementDocument } from './cash-movement.model';
import { CashShiftModel, type CashShiftAttrs, type CashShiftDocument } from './cash-shift.model';

const conflict = (message: string): AppError => new AppError(409, 'CONFLICT', message);

export async function findOpenShift(
  userId: string,
  session?: ClientSession,
): Promise<CashShiftDocument | null> {
  return CashShiftModel.findOne({ userId: new Types.ObjectId(userId), status: 'OPEN' }).session(
    session ?? null,
  );
}

/**
 * Para cobrar hay que tener la caja abierta: así cada peso queda en el turno de alguien.
 * Dentro de una transacción además reclama la caja (ver `claimOpenShift`).
 */
export async function requireOpenShift(
  userId: string,
  session?: ClientSession,
): Promise<CashShiftDocument> {
  const shift =
    session === undefined
      ? await findOpenShift(userId)
      : await CashShiftModel.findOneAndUpdate(
          { userId: new Types.ObjectId(userId), status: 'OPEN' },
          { $inc: { revision: 1 } },
          { returnDocument: 'after', session },
        );
  if (shift === null) {
    throw new AppError(409, 'CASH_SHIFT_REQUIRED', 'Abre la caja antes de cobrar.');
  }
  return shift;
}

/**
 * Reclama una caja abierta dentro de la transacción. Una lectura no basta: con aislamiento
 * de snapshot, un cobro y el cierre de la misma caja (o dos retiros) no chocan si solo uno
 * escribe la caja. Escribiendo ambos el mismo documento, MongoDB aborta uno y
 * `connection.transaction` lo reintenta viendo el estado nuevo.
 */
export async function claimOpenShift(
  shiftId: Types.ObjectId,
  session: ClientSession,
): Promise<CashShiftDocument> {
  const shift = await CashShiftModel.findOneAndUpdate(
    { _id: shiftId, status: 'OPEN' },
    { $inc: { revision: 1 } },
    { returnDocument: 'after', session },
  );
  if (shift === null) throw conflict('La caja de esta venta ya se cerró: no se puede anular.');
  return shift;
}

export async function summarizeShift(
  shift: CashShiftDocument,
  session?: ClientSession,
): Promise<CashShiftSummary> {
  const [paid, voidedCount, movements, withReturns] = await Promise.all([
    SaleModel.find({ shiftId: shift._id, status: 'PAID' })
      .select('total discount payments')
      .session(session ?? null),
    SaleModel.countDocuments({ shiftId: shift._id, status: 'VOIDED' }).session(session ?? null),
    CashMovementModel.find({ shiftId: shift._id, status: trusted({ $ne: 'VOIDED' }) })
      .select('type amount')
      .session(session ?? null),
    SaleModel.find({ 'returns.shiftId': shift._id })
      .select('returns')
      .session(session ?? null),
  ]);
  let returnsTotal = 0;
  let cashRefundsTotal = 0;
  for (const sale of withReturns) {
    for (const entry of sale.returns) {
      if (!entry.shiftId.equals(shift._id)) continue;
      returnsTotal += entry.amount;
      if (entry.refundMethod === 'CASH') cashRefundsTotal += entry.amount;
    }
  }
  const byMethod = new Map<PaymentMethod, { amount: number; count: number }>();
  let salesTotal = 0;
  let discountsTotal = 0;
  for (const sale of paid) {
    salesTotal += sale.total;
    discountsTotal += sale.discount?.amount ?? 0;
    for (const payment of sale.payments) {
      const current = byMethod.get(payment.method) ?? { amount: 0, count: 0 };
      byMethod.set(payment.method, {
        amount: current.amount + payment.amount,
        count: current.count + 1,
      });
    }
  }
  let expensesTotal = 0;
  let withdrawalsTotal = 0;
  let incomesTotal = 0;
  for (const movement of movements) {
    if (movement.type === 'EXPENSE') expensesTotal += movement.amount;
    else if (movement.type === 'WITHDRAWAL') withdrawalsTotal += movement.amount;
    else incomesTotal += movement.amount;
  }
  return {
    salesCount: paid.length,
    salesTotal,
    discountsTotal,
    voidedCount,
    byMethod: PAYMENT_METHODS.flatMap((method) => {
      const totals = byMethod.get(method);
      return totals === undefined ? [] : [{ method, ...totals }];
    }),
    expensesTotal,
    withdrawalsTotal,
    incomesTotal,
    returnsTotal,
    cashRefundsTotal,
    expectedCash: expectedCashOf({
      openingAmount: shift.openingAmount,
      cashSales: byMethod.get('CASH')?.amount ?? 0,
      expenses: expensesTotal,
      withdrawals: withdrawalsTotal,
      incomes: incomesTotal,
      refunds: cashRefundsTotal,
    }),
  };
}

export async function toCashShiftDto(
  shift: CashShiftDocument,
  session?: ClientSession,
): Promise<CashShift> {
  return {
    id: shift.id,
    number: shift.number ?? null,
    status: shift.status,
    userId: shift.userId.toString(),
    userName: shift.userName,
    businessDate: shift.businessDate,
    openingAmount: shift.openingAmount,
    openingNote: shift.openingNote,
    openedAt: shift.openedAt.toISOString(),
    closedAt: shift.closedAt?.toISOString() ?? null,
    summary: await summarizeShift(shift, session),
    closing:
      shift.closing === null
        ? null
        : {
            countedCash: shift.closing.countedCash,
            expectedCash: shift.closing.expectedCash,
            difference: shift.closing.difference,
            counts: shift.closing.counts.map(({ denomination, quantity }) => ({
              denomination,
              quantity,
            })),
            note: shift.closing.note,
            leftForNext: shift.closing.leftForNext ?? null,
          },
    confirmedAt: shift.confirmedAt?.toISOString() ?? null,
    confirmedBy: shift.confirmedBy?.name ?? null,
    confirmNote: shift.confirmNote ?? '',
  };
}

export async function getCurrentShift(userId: string): Promise<CashShift | null> {
  const shift = await findOpenShift(userId);
  return shift === null ? null : toCashShiftDto(shift);
}

/** Base que dejó en el cajón el último cierre (se propone al abrir la siguiente caja). */
export async function suggestedOpeningAmount(): Promise<number | null> {
  const last = await CashShiftModel.findOne({ status: 'CLOSED' }).sort({ closedAt: -1 });
  return last?.closing?.leftForNext ?? null;
}

export async function openShift(
  input: OpenCashShiftRequest,
  ctx: ActorContext,
): Promise<CashShift> {
  const alreadyOpen = (): AppError => new AppError(409, 'CONFLICT', 'Ya tienes una caja abierta.');
  if ((await findOpenShift(ctx.actor.id)) !== null) throw alreadyOpen();

  const now = new Date();
  let shift: CashShiftDocument;
  try {
    shift = await CashShiftModel.create({
      number: await nextSequence('cash-shift'),
      userId: ctx.actor._id,
      userName: ctx.actor.name,
      status: 'OPEN',
      businessDate: toBusinessDate(now),
      openingAmount: input.openingAmount,
      openingNote: input.note ?? '',
      openedAt: now,
    });
  } catch (error) {
    // Dos toques seguidos en "Abrir caja": el índice único deja pasar solo uno.
    if (error instanceof mongo.MongoServerError && error.code === 11000) throw alreadyOpen();
    throw error;
  }

  await recordAudit(
    {
      action: 'CASH_SHIFT_OPENED',
      actor: toAuditActor(ctx.actor),
      entity: { type: 'CASH_SHIFT', id: shift.id, label: shift.businessDate },
      metadata: { openingAmount: shift.openingAmount },
      meta: ctx.meta,
    },
    ctx.logger,
  );
  return toCashShiftDto(shift);
}

// ── Egresos, retiros e ingresos ────────────────────────────────────

export function toMovementDto(movement: CashMovementDocument, fromPurchase = false): CashMovement {
  return {
    id: movement.id,
    type: movement.type,
    amount: movement.amount,
    conceptId: movement.concept?.id.toString() ?? null,
    conceptName: movement.concept?.name ?? null,
    staffId: movement.staff?.id.toString() ?? null,
    staffName: movement.staff?.name ?? null,
    reason: movement.reason,
    createdBy: movement.createdBy.name,
    approvedBy: movement.approvedBy?.name ?? null,
    supplier: movement.supplier?.name ?? null,
    receipt: toReceiptDto(movement.receipt),
    status: movement.status ?? 'ACTIVE',
    voidReason: movement.voidReason ?? null,
    voidedBy: movement.voidedBy?.name ?? null,
    fromPurchase,
    createdAt: movement.createdAt.toISOString(),
  };
}

/** Ids de los egresos que registraron las compras pagadas con la caja. */
async function purchaseMovementIds(movementIds: Types.ObjectId[]): Promise<Set<string>> {
  if (movementIds.length === 0) return new Set();
  const purchases = await PurchaseModel.find({ cashMovementId: trusted({ $in: movementIds }) })
    .select('cashMovementId')
    .lean();
  return new Set(
    purchases.flatMap((purchase) =>
      purchase.cashMovementId === null ? [] : [purchase.cashMovementId.toString()],
    ),
  );
}

async function toMovementDtos(movements: CashMovementDocument[]): Promise<CashMovement[]> {
  const fromPurchases = await purchaseMovementIds(movements.map((movement) => movement._id));
  return movements.map((movement) => toMovementDto(movement, fromPurchases.has(movement.id)));
}

export async function listMovements(userId: string): Promise<CashMovement[]> {
  const shift = await findOpenShift(userId);
  if (shift === null) return [];
  const movements = await CashMovementModel.find({ shiftId: shift._id }).sort({ createdAt: -1 });
  return toMovementDtos(movements);
}

const movementNotFound = (): AppError =>
  new AppError(404, 'NOT_FOUND', 'Movimiento de caja no encontrado');

/**
 * Movimiento que se puede tocar: de una caja abierta y de quien opera (un administrador puede
 * con cualquier caja abierta).
 */
async function findMovementInOpenShift(id: string, ctx: PosContext): Promise<CashMovementDocument> {
  const movement = Types.ObjectId.isValid(id) ? await CashMovementModel.findById(id) : null;
  if (movement === null) throw movementNotFound();
  const shift = await CashShiftModel.findById(movement.shiftId);
  if (shift === null) throw movementNotFound();
  const isOwner = shift.userId.equals(ctx.actor._id);
  if (!isOwner && !userCan(ctx.actor, 'cash:review')) throw movementNotFound();
  if (shift.status !== 'OPEN') {
    throw conflict('La caja de este movimiento ya se cerró: no se puede cambiar.');
  }
  return movement;
}

/** Efecto de un movimiento en el efectivo del cajón: los ingresos suman, lo demás resta. */
const cashEffect = (type: CashMovement['type'], amount: number): number =>
  type === 'INCOME' ? amount : -amount;

async function ensureEditable(movement: CashMovementDocument): Promise<void> {
  if (movement.status === 'VOIDED') throw conflict('Este movimiento ya está anulado.');
  if ((await purchaseMovementIds([movement._id])).size > 0) {
    throw conflict('Este egreso lo registró una compra: para corregirlo, anula la compra.');
  }
}

/** Adjunta (o reemplaza) la foto del comprobante de un movimiento de la caja abierta. */
export async function setMovementReceipt(
  id: string,
  data: Buffer,
  ctx: PosContext,
): Promise<CashMovement> {
  const movement = await findMovementInOpenShift(id, ctx);
  const stored = await storeReceipt(data, ctx);
  const previous = movement.receipt ?? null;
  movement.receipt = stored;
  await movement.save();
  if (previous !== null) await deleteReceipt(previous, ctx);
  await recordAudit(
    {
      action: 'RECEIPT_ATTACHED',
      actor: toAuditActor(ctx.actor),
      entity: { type: 'CASH_SHIFT', id: movement.shiftId.toString(), label: 'Movimiento de caja' },
      metadata: { movementId: movement.id, replaced: previous !== null },
      meta: ctx.meta,
    },
    ctx.logger,
  );
  const fromPurchase = (await purchaseMovementIds([movement._id])).size > 0;
  return toMovementDto(movement, fromPurchase);
}

const movementSnapshot = (movement: CashMovementDocument) => ({
  amount: movement.amount,
  concept: movement.concept?.name ?? null,
  reason: movement.reason,
});

/**
 * Corrige el monto, el tipo o el detalle de un egreso, retiro o ingreso. Siempre con la
 * autorización de un administrador y solo mientras la caja siga abierta.
 */
export async function updateMovement(
  id: string,
  input: UpdateCashMovementRequest,
  ctx: PosContext,
): Promise<CashMovement> {
  const found = await findMovementInOpenShift(id, ctx);
  await ensureEditable(found);

  let concept: { id: Types.ObjectId; name: string } | null | undefined;
  if (input.conceptId === null) concept = null;
  else if (input.conceptId !== undefined) {
    const active = await findActiveConcept(input.conceptId);
    if (active.type !== found.type) {
      throw new AppError(
        400,
        'VALIDATION_ERROR',
        `"${active.name}" no es un tipo de ${CASH_MOVEMENT_LABELS[found.type].toLowerCase()}.`,
      );
    }
    if (active.requiresStaff && found.staff === null) {
      throw new AppError(
        400,
        'VALIDATION_ERROR',
        `"${active.name}" pide la persona del personal: anula el movimiento y regístralo de nuevo.`,
      );
    }
    concept = { id: active._id, name: active.name };
  }
  const finalConcept = concept === undefined ? found.concept : concept;
  const finalReason = input.reason?.trim() ?? found.reason;
  if (finalConcept === null && finalReason.length < 3) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Escribe el motivo (mínimo 3 caracteres)');
  }

  const approver = await resolveApproval(ctx, input.approverPin, 'CASH_MOVEMENT_EDIT');

  const { before, after } = await mongoose.connection.transaction(async (session) => {
    const movement = await CashMovementModel.findById(found._id).session(session);
    if (movement === null) throw movementNotFound();
    if (movement.status === 'VOIDED') throw conflict('Este movimiento ya está anulado.');
    const shift = await claimOpenShift(movement.shiftId, session);
    const previous = movementSnapshot(movement);
    const amount = input.amount ?? movement.amount;
    const { expectedCash } = await summarizeShift(shift, session);
    const nextCash =
      expectedCash - cashEffect(movement.type, movement.amount) + cashEffect(movement.type, amount);
    if (nextCash < 0) {
      throw conflict(
        `Con ese monto la caja quedaría en ${formatCOP(nextCash)}: no alcanza el efectivo.`,
      );
    }
    movement.amount = amount;
    movement.concept = finalConcept;
    movement.reason = finalReason;
    await movement.save({ session });
    return { before: previous, after: movement };
  });

  await recordAudit(
    {
      action: 'CASH_MOVEMENT_UPDATED',
      actor: toAuditActor(ctx.actor),
      entity: { type: 'CASH_SHIFT', id: after.shiftId.toString(), label: 'Movimiento de caja' },
      metadata: {
        movementId: after.id,
        type: after.type,
        before,
        after: movementSnapshot(after),
        approvedBy: approver.name,
      },
      meta: ctx.meta,
    },
    ctx.logger,
  );
  return toMovementDto(after);
}

/**
 * Anula un egreso, retiro o ingreso: el registro queda (con el motivo y quién autorizó) pero
 * deja de contar en el efectivo esperado y en los reportes.
 */
export async function voidMovement(
  id: string,
  input: VoidCashMovementRequest,
  ctx: PosContext,
): Promise<CashMovement> {
  const found = await findMovementInOpenShift(id, ctx);
  await ensureEditable(found);
  const reason = input.reason.trim();
  const approver = await resolveApproval(ctx, input.approverPin, 'CASH_MOVEMENT_EDIT');

  const voided = await mongoose.connection.transaction(async (session) => {
    const movement = await CashMovementModel.findById(found._id).session(session);
    if (movement === null) throw movementNotFound();
    if (movement.status === 'VOIDED') throw conflict('Este movimiento ya está anulado.');
    const shift = await claimOpenShift(movement.shiftId, session);
    const { expectedCash } = await summarizeShift(shift, session);
    const nextCash = expectedCash - cashEffect(movement.type, movement.amount);
    if (nextCash < 0) {
      throw conflict(
        `Sin este ingreso la caja quedaría en ${formatCOP(nextCash)}: no se puede anular.`,
      );
    }
    movement.status = 'VOIDED';
    movement.voidReason = reason;
    movement.voidedBy = approver;
    movement.voidedAt = new Date();
    await movement.save({ session });
    return movement;
  });

  await recordAudit(
    {
      action: 'CASH_MOVEMENT_VOIDED',
      actor: toAuditActor(ctx.actor),
      entity: { type: 'CASH_SHIFT', id: voided.shiftId.toString(), label: 'Movimiento de caja' },
      metadata: {
        movementId: voided.id,
        type: voided.type,
        before: { ...movementSnapshot(voided), status: 'ACTIVE' },
        after: { status: 'VOIDED' },
        reason,
        approvedBy: approver.name,
      },
      meta: ctx.meta,
    },
    ctx.logger,
  );
  return toMovementDto(voided);
}

/**
 * Registra un egreso, un retiro o un ingreso en la caja abierta de quien opera.
 * - Los retiros siempre necesitan a un administrador (él mismo o su PIN en la tablet).
 * - Los egresos hasta el tope de Ajustes los hace la cajera sola; por encima, con el PIN.
 * - Los ingresos (base adicional, cambio, reintegro) no necesitan autorización.
 * - Nunca sale más efectivo del que hay en el cajón según el sistema.
 * - El tipo de movimiento tiene que ser de la misma clase (egreso, retiro o ingreso); los de
 *   nómina exigen la persona del personal.
 */
export async function createMovement(
  input: CreateCashMovementRequest,
  ctx: PosContext,
): Promise<CashMovement> {
  const reason = input.reason?.trim() ?? '';
  const concept = input.conceptId === undefined ? null : await findActiveConcept(input.conceptId);
  if (concept !== null && concept.type !== input.type) {
    throw new AppError(
      400,
      'VALIDATION_ERROR',
      `"${concept.name}" no es un tipo de ${CASH_MOVEMENT_LABELS[input.type].toLowerCase()}.`,
    );
  }
  if (concept === null && reason.length < 3) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Escribe el motivo (mínimo 3 caracteres)');
  }
  if (concept?.requiresStaff === true && input.staffId === undefined) {
    throw new AppError(400, 'VALIDATION_ERROR', `Elige a quién se le paga (${concept.name}).`);
  }
  const staff = input.staffId === undefined ? null : await findActiveStaffMember(input.staffId);

  const { maxCashierExpense } = await getSettings();
  let supplier: { id: Types.ObjectId; name: string } | null = null;
  if (input.supplierId !== undefined) {
    if (input.type !== 'EXPENSE') {
      throw new AppError(400, 'VALIDATION_ERROR', 'Solo los egresos se pagan a un proveedor.');
    }
    const found = await SupplierModel.findById(input.supplierId);
    if (found?.isActive !== true) throw conflict('Ese proveedor no está disponible');
    supplier = { id: found._id, name: found.name };
  }
  const needsApproval =
    input.type === 'WITHDRAWAL' || (input.type === 'EXPENSE' && input.amount > maxCashierExpense);
  const approver = needsApproval
    ? await resolveApproval(
        ctx,
        input.approverPin,
        input.type === 'WITHDRAWAL' ? 'WITHDRAWAL' : 'EXPENSE',
      )
    : null;

  const movement = await mongoose.connection.transaction(async (session) => {
    const shift = await requireOpenShift(ctx.actor.id, session);
    const { expectedCash } = await summarizeShift(shift, session);
    if (input.type !== 'INCOME' && input.amount > expectedCash) {
      throw conflict(
        `En la caja solo hay ${formatCOP(expectedCash)} en efectivo: no se puede sacar ${formatCOP(input.amount)}.`,
      );
    }
    const [created] = await CashMovementModel.create(
      [
        {
          shiftId: shift._id,
          type: input.type,
          amount: input.amount,
          concept: concept === null ? null : { id: concept._id, name: concept.name },
          staff: staff === null ? null : { id: staff._id, name: staff.name },
          reason,
          createdBy: { id: ctx.actor._id, name: ctx.actor.name },
          approvedBy: approver,
          supplier,
        },
      ],
      { session },
    );
    if (created === undefined) throw new Error('No se pudo registrar el movimiento');
    return created;
  });

  await recordAudit(
    {
      action: 'CASH_MOVEMENT_CREATED',
      actor: toAuditActor(ctx.actor),
      entity: { type: 'CASH_SHIFT', id: movement.shiftId.toString(), label: 'Movimiento de caja' },
      metadata: {
        type: movement.type,
        amount: movement.amount,
        concept: movement.concept?.name ?? null,
        staff: movement.staff?.name ?? null,
        note: movement.reason,
        approvedBy: approver?.name ?? null,
        supplier: supplier?.name ?? null,
      },
      meta: ctx.meta,
    },
    ctx.logger,
  );
  return toMovementDto(movement);
}

// ── Cierre con arqueo ──────────────────────────────────────────────

/**
 * Cierra la caja abierta con el conteo de billetes y monedas. Guarda el sobrante o faltante
 * (que exige una nota) y deja la caja sin cambios posibles: no admite más ventas, egresos
 * ni anulaciones.
 */
export async function closeShift(
  input: CloseCashShiftRequest,
  ctx: ActorContext,
): Promise<CashShift> {
  const note = input.note?.trim() ?? '';
  const counts: DenominationCount[] = [];
  for (const { denomination, quantity } of input.counts) {
    if (!isDenomination(denomination))
      throw new AppError(400, 'VALIDATION_ERROR', 'Denominación inválida');
    if (quantity > 0) counts.push({ denomination, quantity });
  }
  const countedCash = countDenominations(counts);
  const leftForNext = input.leftForNext ?? null;
  if (leftForNext !== null && leftForNext > countedCash) {
    throw new AppError(
      400,
      'VALIDATION_ERROR',
      `La base que queda (${formatCOP(leftForNext)}) no puede ser mayor a lo contado (${formatCOP(countedCash)}).`,
    );
  }

  const closed = await mongoose.connection.transaction(async (session) => {
    const shift = await requireOpenShift(ctx.actor.id, session);
    const openTabs = await SaleModel.countDocuments({
      status: 'OPEN',
      type: 'TABLE',
      'openedBy.id': ctx.actor._id,
    }).session(session);
    if (openTabs > 0) {
      throw conflict('Tienes mesas abiertas: cóbralas o cancélalas antes de cerrar la caja.');
    }

    const { expectedCash } = await summarizeShift(shift, session);
    const difference = cashDifference(countedCash, expectedCash);
    if (difference !== 0 && note === '') {
      throw new AppError(
        400,
        'VALIDATION_ERROR',
        'Hay una diferencia en el arqueo: escribe una nota que la explique.',
      );
    }
    shift.status = 'CLOSED';
    shift.closedAt = new Date();
    shift.closing = { countedCash, expectedCash, difference, counts, note, leftForNext };
    await shift.save({ session });
    return toCashShiftDto(shift, session);
  });

  await recordAudit(
    {
      action: 'CASH_SHIFT_CLOSED',
      actor: toAuditActor(ctx.actor),
      entity: { type: 'CASH_SHIFT', id: closed.id, label: closed.businessDate },
      metadata: {
        countedCash: closed.closing?.countedCash,
        expectedCash: closed.closing?.expectedCash,
        difference: closed.closing?.difference,
        leftForNext,
        note,
      },
      meta: ctx.meta,
    },
    ctx.logger,
  );
  return closed;
}

// ── Historial y confirmación (administrador) ───────────────────────

export async function listShifts(query: ListCashShiftsQuery): Promise<CashShift[]> {
  const filter: QueryFilter<CashShiftAttrs> = {
    businessDate: trusted({ $gte: query.from, $lte: query.to }),
  };
  if (query.userId !== undefined) filter.userId = new Types.ObjectId(query.userId);
  const shifts = await CashShiftModel.find(filter).sort({ openedAt: -1 }).limit(200);
  return Promise.all(shifts.map((shift) => toCashShiftDto(shift)));
}

async function findShiftOrThrow(id: string): Promise<CashShiftDocument> {
  const shift = Types.ObjectId.isValid(id) ? await CashShiftModel.findById(id) : null;
  if (shift === null) throw new AppError(404, 'NOT_FOUND', 'Caja no encontrada');
  return shift;
}

/** Resumen detallado de una caja: lo de siempre más cada movimiento y el total por tipo. */
export async function getShiftDetail(id: string): Promise<CashShiftDetail> {
  const shift = await findShiftOrThrow(id);
  const movements = await CashMovementModel.find({ shiftId: shift._id }).sort({ createdAt: 1 });
  const byConcept = new Map<string, CashShiftDetail['byConcept'][number]>();
  for (const movement of movements) {
    if (movement.status === 'VOIDED') continue;
    const name = movement.concept?.name ?? 'Sin tipo';
    const key = `${movement.type}|${name}`;
    const current = byConcept.get(key) ?? { type: movement.type, name, amount: 0, count: 0 };
    byConcept.set(key, {
      ...current,
      amount: current.amount + movement.amount,
      count: current.count + 1,
    });
  }
  return {
    shift: await toCashShiftDto(shift),
    movements: await toMovementDtos(movements),
    byConcept: [...byConcept.values()].sort((a, b) => b.amount - a.amount),
    report: await getShiftReport(shift),
  };
}

/**
 * El administrador revisa un cierre y lo confirma. Solo las cajas cerradas, una sola vez; la
 * caja ya no admite cambios desde que se cerró, la confirmación deja constancia de la revisión.
 */
export async function confirmShift(
  id: string,
  input: ConfirmCashShiftRequest,
  ctx: ActorContext,
): Promise<CashShift> {
  const note = input.note?.trim() ?? '';
  const shift = await CashShiftModel.findOneAndUpdate(
    { _id: (await findShiftOrThrow(id))._id, status: 'CLOSED', confirmedAt: null },
    {
      $set: {
        confirmedAt: new Date(),
        confirmedBy: { id: ctx.actor._id, name: ctx.actor.name },
        confirmNote: note,
      },
    },
    { returnDocument: 'after' },
  );
  if (shift === null) throw conflict('Solo se confirman cajas cerradas que no estén confirmadas.');
  await recordAudit(
    {
      action: 'CASH_SHIFT_CONFIRMED',
      actor: toAuditActor(ctx.actor),
      entity: {
        type: 'CASH_SHIFT',
        id: shift.id,
        label:
          shift.number === null || shift.number === undefined
            ? shift.businessDate
            : `Caja N.º ${String(shift.number)}`,
      },
      metadata: { difference: shift.closing?.difference ?? null, note },
      meta: ctx.meta,
    },
    ctx.logger,
  );
  return toCashShiftDto(shift);
}
