import { AUTH_POLICY, hasPermission, USER_ROLES } from '@panesypan/shared';
import { trusted } from 'mongoose';
import { AppError } from '../../lib/errors';
import { verifySecret } from '../../lib/password';
import { recordAudit } from '../audit/audit.service';
import { SessionModel, type SessionDocument } from '../auth/session.model';
import { revokeSession } from '../auth/session.service';
import { UserModel } from '../users/user.model';
import { toAuditActor } from '../users/users.mapper';
import type { ActorContext } from '../users/users.service';
import type { PersonRef } from './sale.model';

/** Contexto de las operaciones del POS: además de quién actúa, su sesión (para los intentos de PIN). */
export interface PosContext extends ActorContext {
  session: SessionDocument;
}

export type ApprovalPurpose =
  'DISCOUNT' | 'VOID' | 'CANCEL_TAB' | 'EXPENSE' | 'WITHDRAWAL' | 'CASH_MOVEMENT_EDIT';

const APPROVER_ROLES = USER_ROLES.filter((role) => hasPermission(role, 'sales:void:approve'));

/**
 * Autorización de un administrador para anular, cancelar una mesa o dar un descuento alto.
 * - Si quien actúa ya es administrador, se autoriza a sí mismo.
 * - Si no, un administrador digita su PIN en la tablet. Cada PIN equivocado cuenta en la sesión
 *   de la cajera: al quinto, la sesión se cierra (no se puede adivinar el PIN a punta de intentos).
 */
export async function resolveApproval(
  ctx: PosContext,
  pin: string | undefined,
  purpose: ApprovalPurpose,
): Promise<PersonRef> {
  if (hasPermission(ctx.actor.role, 'sales:void:approve')) {
    return { id: ctx.actor._id, name: ctx.actor.name };
  }
  if (pin === undefined) {
    throw new AppError(
      403,
      'APPROVAL_REQUIRED',
      'Esta operación necesita la autorización de un administrador.',
    );
  }

  const approvers = await UserModel.find({
    role: trusted({ $in: APPROVER_ROLES }),
    isActive: true,
    pinHash: trusted({ $type: 'string' }),
  }).select('+pinHash');
  for (const approver of approvers) {
    if (approver.pinHash !== null && (await verifySecret(approver.pinHash, pin))) {
      await SessionModel.updateOne({ _id: ctx.session._id }, { $set: { pinFailedAttempts: 0 } });
      return { id: approver._id, name: approver.name };
    }
  }

  const updated = await SessionModel.findOneAndUpdate(
    { _id: ctx.session._id, revokedAt: null },
    { $inc: { pinFailedAttempts: 1 } },
    { returnDocument: 'after' },
  );
  const attempts = updated?.pinFailedAttempts ?? AUTH_POLICY.maxPinAttempts;
  const remainingAttempts = Math.max(0, AUTH_POLICY.maxPinAttempts - attempts);
  await recordAudit(
    {
      action: 'APPROVAL_FAILED',
      actor: toAuditActor(ctx.actor),
      metadata: { purpose, attempts },
      meta: ctx.meta,
    },
    ctx.logger,
  );

  if (remainingAttempts === 0) {
    await revokeSession(ctx.session.id, 'PIN_ATTEMPTS');
    await recordAudit(
      {
        action: 'AUTH_SESSION_REVOKED_PIN',
        actor: toAuditActor(ctx.actor),
        entity: { type: 'SESSION', id: ctx.session.id },
        metadata: { purpose },
        meta: ctx.meta,
      },
      ctx.logger,
    );
    throw new AppError(
      401,
      'UNAUTHORIZED',
      'Demasiados PIN incorrectos: por seguridad se cerró la sesión.',
    );
  }
  throw new AppError(403, 'INVALID_PIN', 'PIN de autorización incorrecto.', {
    remainingAttempts,
  });
}
