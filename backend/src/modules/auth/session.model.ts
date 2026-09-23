import { model, Schema, type HydratedDocument, type Types } from 'mongoose';

export const SESSION_REVOKE_REASONS = [
  'LOGOUT',
  'LOGOUT_ALL',
  'REUSE_DETECTED',
  'PIN_ATTEMPTS',
  'USER_DEACTIVATED',
  'PASSWORD_RESET',
  'PASSWORD_CHANGED',
] as const;

export type SessionRevokeReason = (typeof SESSION_REVOKE_REASONS)[number];

/**
 * Una sesión por inicio de sesión y dispositivo. Guarda el hash del token de refresco actual y
 * de los anteriores: si alguien reutiliza un token viejo, se detecta el robo y se cierra la sesión.
 */
export interface SessionAttrs {
  userId: Types.ObjectId;
  tokenHash: string;
  previousTokenHashes: string[];
  rotatedAt: Date;
  expiresAt: Date;
  lastActivityAt: Date;
  lockedAt: Date | null;
  pinFailedAttempts: number;
  revokedAt: Date | null;
  revokedReason: SessionRevokeReason | null;
  ip: string | null;
  userAgent: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const sessionSchema = new Schema<SessionAttrs>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    tokenHash: { type: String, required: true },
    previousTokenHashes: { type: [String], default: [] },
    rotatedAt: { type: Date, required: true },
    expiresAt: { type: Date, required: true },
    lastActivityAt: { type: Date, required: true },
    lockedAt: { type: Date, default: null },
    pinFailedAttempts: { type: Number, default: 0, min: 0 },
    revokedAt: { type: Date, default: null },
    revokedReason: { type: String, enum: SESSION_REVOKE_REASONS, default: null },
    ip: { type: String, default: null },
    userAgent: { type: String, default: null },
  },
  { timestamps: true, strict: 'throw' },
);

sessionSchema.index({ tokenHash: 1 }, { unique: true });
sessionSchema.index({ previousTokenHashes: 1 });
sessionSchema.index({ userId: 1, revokedAt: 1 });
// MongoDB borra automáticamente las sesiones vencidas.
sessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const SessionModel = model<SessionAttrs>('Session', sessionSchema);
export type SessionDocument = HydratedDocument<SessionAttrs>;
