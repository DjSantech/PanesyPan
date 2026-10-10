import { PERMISSIONS, USER_ROLES, type Permission, type UserRole } from '@panesypan/shared';
import { model, Schema, type HydratedDocument } from 'mongoose';

export interface ProfileAttrs {
  name: string;
  permissions: Permission[];
  isActive: boolean;
  /** Perfiles creados por el sistema ("Administrador" y "Cajera"): no se borran ni desactivan. */
  isSystem: boolean;
  /** Rol al que corresponde por defecto un perfil del sistema (null en los demás). */
  systemRole: UserRole | null;
  createdAt: Date;
  updatedAt: Date;
}

const profileSchema = new Schema<ProfileAttrs>(
  {
    name: { type: String, required: true, trim: true, maxlength: 40 },
    permissions: { type: [{ type: String, enum: PERMISSIONS }], default: [] },
    isActive: { type: Boolean, default: true },
    isSystem: { type: Boolean, default: false },
    systemRole: { type: String, enum: [...USER_ROLES, null], default: null },
  },
  { timestamps: true, strict: 'throw' },
);

profileSchema.index({ name: 1 }, { unique: true, collation: { locale: 'es', strength: 2 } });
profileSchema.index(
  { systemRole: 1 },
  { unique: true, partialFilterExpression: { systemRole: { $type: 'string' } } },
);

export const ProfileModel = model<ProfileAttrs>('Profile', profileSchema);
export type ProfileDocument = HydratedDocument<ProfileAttrs>;
