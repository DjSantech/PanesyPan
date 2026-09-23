import { AUDIT_ACTIONS, USER_ROLES, type AuditAction, type UserRole } from '@panesypan/shared';
import { model, Schema, type HydratedDocument, type Types } from 'mongoose';

export interface AuditLogAttrs {
  action: AuditAction;
  /** Quién hizo la acción (copia del nombre y rol en ese momento). `null` = sistema o anónimo. */
  actor: { id: Types.ObjectId; name: string; role: UserRole } | null;
  entity: { type: string; id: string; label: string | null } | null;
  metadata: Record<string, unknown>;
  ip: string | null;
  userAgent: string | null;
  requestId: string | null;
  createdAt: Date;
}

const auditLogSchema = new Schema<AuditLogAttrs>(
  {
    action: { type: String, enum: AUDIT_ACTIONS, required: true },
    actor: {
      type: new Schema(
        {
          id: { type: Schema.Types.ObjectId, required: true },
          name: { type: String, required: true },
          role: { type: String, enum: USER_ROLES, required: true },
        },
        { _id: false },
      ),
      default: null,
    },
    entity: {
      type: new Schema(
        {
          type: { type: String, required: true },
          id: { type: String, required: true },
          label: { type: String, default: null },
        },
        { _id: false },
      ),
      default: null,
    },
    metadata: { type: Schema.Types.Mixed, default: {} },
    ip: { type: String, default: null },
    userAgent: { type: String, default: null },
    requestId: { type: String, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false }, minimize: false, strict: 'throw' },
);

auditLogSchema.index({ createdAt: -1, _id: -1 });
auditLogSchema.index({ action: 1, createdAt: -1 });
auditLogSchema.index({ 'actor.id': 1, createdAt: -1 });

// La auditoría es de solo inserción: cualquier intento de modificar o borrar falla.
const blockMutation = (): never => {
  throw new Error('La auditoría no se puede modificar ni borrar');
};
auditLogSchema.pre(
  [
    'updateOne',
    'updateMany',
    'findOneAndUpdate',
    'replaceOne',
    'findOneAndReplace',
    'deleteOne',
    'deleteMany',
    'findOneAndDelete',
  ],
  blockMutation,
);

export const AuditLogModel = model<AuditLogAttrs>('AuditLog', auditLogSchema);
export type AuditLogDocument = HydratedDocument<AuditLogAttrs>;
