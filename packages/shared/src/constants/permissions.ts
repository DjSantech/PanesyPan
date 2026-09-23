import type { UserRole } from './roles';

/**
 * Permisos del sistema. El backend los valida SIEMPRE; el frontend solo los usa para
 * mostrar u ocultar opciones.
 */
export const PERMISSIONS = [
  'users:manage',
  'audit:read',
  'system:status',
  'pos:sell',
  'cash:operate',
  'catalog:manage',
  'inventory:manage',
  'reports:read',
  'sales:void:approve',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export const ROLE_PERMISSIONS: Readonly<Record<UserRole, readonly Permission[]>> = {
  ADMIN: PERMISSIONS,
  CASHIER: ['pos:sell', 'cash:operate'],
};

export function hasPermission(role: UserRole, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}

export function permissionsFor(role: UserRole): Permission[] {
  return [...ROLE_PERMISSIONS[role]];
}
