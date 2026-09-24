import {
  PAYMENT_METHODS,
  toBusinessDate,
  type CashShift,
  type CashShiftSummary,
  type OpenCashShiftRequest,
  type PaymentMethod,
} from '@panesypan/shared';
import { mongo, Types, type ClientSession } from 'mongoose';
import { AppError } from '../../lib/errors';
import { recordAudit } from '../audit/audit.service';
import { SaleModel } from '../sales/sale.model';
import { toAuditActor } from '../users/users.mapper';
import type { ActorContext } from '../users/users.service';
import { CashShiftModel, type CashShiftDocument } from './cash-shift.model';

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

export async function summarizeShift(shift: CashShiftDocument): Promise<CashShiftSummary> {
  const [paid, voidedCount] = await Promise.all([
    SaleModel.find({ shiftId: shift._id, status: 'PAID' }).select('total discount payments'),
    SaleModel.countDocuments({ shiftId: shift._id, status: 'VOIDED' }),
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
  return {
    salesCount: paid.length,
    salesTotal,
    discountsTotal,
    voidedCount,
    byMethod: PAYMENT_METHODS.flatMap((method) => {
      const totals = byMethod.get(method);
      return totals === undefined ? [] : [{ method, ...totals }];
    }),
    expectedCash: shift.openingAmount + (byMethod.get('CASH')?.amount ?? 0),
  };
}

export async function toCashShiftDto(shift: CashShiftDocument): Promise<CashShift> {
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
    summary: await summarizeShift(shift),
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
