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
  'catalog:read',
  'catalog:availability',
  'catalog:manage',
  'inventory:manage',
  'reports:read',
  'sales:void:approve',
  'settings:manage',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export const ROLE_PERMISSIONS: Readonly<Record<UserRole, readonly Permission[]>> = {
  ADMIN: PERMISSIONS,
  // La cajera ve el catálogo y puede marcar productos como agotados, pero no cambia precios.
  // Anular ventas o dar descuentos por encima del tope exige el PIN de un administrador.
  CASHIER: ['pos:sell', 'cash:operate', 'catalog:read', 'catalog:availability'],
};

export function hasPermission(role: UserRole, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}

export function permissionsFor(role: UserRole): Permission[] {
  return [...ROLE_PERMISSIONS[role]];
}
