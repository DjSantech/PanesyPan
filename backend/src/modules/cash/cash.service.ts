import {
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
  type CloseCashShiftRequest,
  type CreateCashMovementRequest,
  type DenominationCount,
  type OpenCashShiftRequest,
  type PaymentMethod,
} from '@panesypan/shared';
import mongoose, { mongo, Types, type ClientSession } from 'mongoose';
import { AppError } from '../../lib/errors';
import { recordAudit } from '../audit/audit.service';
import { resolveApproval, type PosContext } from '../sales/approval.service';
import { SaleModel } from '../sales/sale.model';
import { getSettings } from '../settings/settings.service';
import { toAuditActor } from '../users/users.mapper';
import type { ActorContext } from '../users/users.service';
import { CashMovementModel, type CashMovementDocument } from './cash-movement.model';
import { CashShiftModel, type CashShiftDocument } from './cash-shift.model';

const conflict = (message: string): AppError => new AppError(409, 'CONFLICT', message);

export async function findOpenShift(
  userId: string,
  session?: ClientSession,
): Promise<CashShiftDocument | null> {
  return CashShiftModel.findOne({ userId: new Types.ObjectId(userId), status: 'OPEN' }).session(
    session ?? null,
  );
}

/** Para cobrar hay que tener la caja abierta: así cada peso queda en el turno de alguien. */
export async function requireOpenShift(
  userId: string,
  session?: ClientSession,
): Promise<CashShiftDocument> {
  const shift = await findOpenShift(userId, session);
  if (shift === null) {
    throw new AppError(409, 'CASH_SHIFT_REQUIRED', 'Abre la caja antes de cobrar.');
  }
  return shift;
}

export async function summarizeShift(
  shift: CashShiftDocument,
  session?: ClientSession,
): Promise<CashShiftSummary> {
  const [paid, voidedCount, movements] = await Promise.all([
    SaleModel.find({ shiftId: shift._id, status: 'PAID' })
      .select('total discount payments')
      .session(session ?? null),
    SaleModel.countDocuments({ shiftId: shift._id, status: 'VOIDED' }).session(session ?? null),
    CashMovementModel.find({ shiftId: shift._id })
      .select('type amount')
      .session(session ?? null),
  ]);
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
  for (const movement of movements) {
    if (movement.type === 'EXPENSE') expensesTotal += movement.amount;
    else withdrawalsTotal += movement.amount;
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
    expectedCash: expectedCashOf({
      openingAmount: shift.openingAmount,
      cashSales: byMethod.get('CASH')?.amount ?? 0,
      expenses: expensesTotal,
      withdrawals: withdrawalsTotal,
    }),
  };
}

export async function toCashShiftDto(
  shift: CashShiftDocument,
  session?: ClientSession,
): Promise<CashShift> {
  return {
    id: shift.id,
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
          },
  };
}

export async function getCurrentShift(userId: string): Promise<CashShift | null> {
  const shift = await findOpenShift(userId);
  return shift === null ? null : toCashShiftDto(shift);
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

// ── Egresos y retiros ──────────────────────────────────────────────

function toMovementDto(movement: CashMovementDocument): CashMovement {
  return {
    id: movement.id,
    type: movement.type,
    amount: movement.amount,
    reason: movement.reason,
    createdBy: movement.createdBy.name,
    approvedBy: movement.approvedBy?.name ?? null,
    createdAt: movement.createdAt.toISOString(),
  };
}

export async function listMovements(userId: string): Promise<CashMovement[]> {
  const shift = await findOpenShift(userId);
  if (shift === null) return [];
  const movements = await CashMovementModel.find({ shiftId: shift._id }).sort({ createdAt: -1 });
  return movements.map(toMovementDto);
}

/**
 * Registra un egreso o un retiro en la caja abierta de quien opera.
 * - Los retiros siempre necesitan a un administrador (él mismo o su PIN en la tablet).
 * - Los egresos hasta el tope de Ajustes los hace la cajera sola; por encima, con el PIN.
 * - Nunca sale más efectivo del que hay en el cajón según el sistema.
 */
export async function createMovement(
  input: CreateCashMovementRequest,
  ctx: PosContext,
): Promise<CashMovement> {
  const { maxCashierExpense } = await getSettings();
  const needsApproval = input.type === 'WITHDRAWAL' || input.amount > maxCashierExpense;
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
    if (input.amount > expectedCash) {
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
          reason: input.reason,
          createdBy: { id: ctx.actor._id, name: ctx.actor.name },
          approvedBy: approver,
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
        note: movement.reason,
        approvedBy: approver?.name ?? null,
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
    shift.closing = { countedCash, expectedCash, difference, counts, note };
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
        note,
      },
      meta: ctx.meta,
    },
    ctx.logger,
  );
  return closed;
}
