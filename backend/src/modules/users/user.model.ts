import { USER_ROLES, type UserRole } from '@panesypan/shared';
import { model, Schema, type HydratedDocument, type Types } from 'mongoose';

export interface UserAttrs {
  name: string;
  username: string;
  email: string | null;
  role: UserRole;
  /**
   * Perfil de permisos asignado. Si falta (usuarios de antes de los perfiles) se usa el perfil
   * del sistema que corresponde a su rol. Un ADMIN conserva siempre todos los permisos.
   */
  profileId?: Types.ObjectId | null;
  /** argon2id. Nunca se devuelve en las consultas salvo que se pida explícitamente. */
  passwordHash: string;
  /** PIN de 6 dígitos cifrado con argon2id (desbloqueo rápido y autorizaciones). */
  pinHash: string | null;
  pinSetAt: Date | null;
  isActive: boolean;
  mustChangePassword: boolean;
  failedLoginAttempts: number;
  lockedUntil: Date | null;
  lastLoginAt: Date | null;
  passwordChangedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const userSchema = new Schema<UserAttrs>(
  {
    name: { type: String, required: true, trim: true, maxlength: 80 },
    username: { type: String, required: true, trim: true, lowercase: true, maxlength: 32 },
    email: { type: String, trim: true, lowercase: true, maxlength: 254, default: null },
    role: { type: String, enum: USER_ROLES, required: true },
    profileId: { type: Schema.Types.ObjectId, ref: 'Profile', default: null },
    passwordHash: { type: String, required: true, select: false },
    pinHash: { type: String, default: null, select: false },
    pinSetAt: { type: Date, default: null },
    isActive: { type: Boolean, default: true },
    mustChangePassword: { type: Boolean, default: true },
    failedLoginAttempts: { type: Number, default: 0, min: 0 },
    lockedUntil: { type: Date, default: null },
    lastLoginAt: { type: Date, default: null },
    passwordChangedAt: { type: Date, default: null },
  },
  { timestamps: true, strict: 'throw' },
);

userSchema.index({ username: 1 }, { unique: true });
// Correo opcional pero único cuando existe.
userSchema.index(
  { email: 1 },
  { unique: true, partialFilterExpression: { email: { $type: 'string' } } },
);
userSchema.index({ role: 1, isActive: 1 });

export const UserModel = model<UserAttrs>('User', userSchema);
export type UserDocument = HydratedDocument<UserAttrs>;
