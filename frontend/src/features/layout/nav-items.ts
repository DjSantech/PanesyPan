import type { Permission } from '@panesypan/shared';
import { Activity, House, ScrollText, Users, type LucideIcon } from 'lucide-react';

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  /** Sin permiso: visible para cualquier usuario con sesión. */
  permission?: Permission;
}

export const NAV_ITEMS: readonly NavItem[] = [
  { to: '/', label: 'Inicio', icon: House },
  { to: '/usuarios', label: 'Usuarios', icon: Users, permission: 'users:manage' },
  { to: '/auditoria', label: 'Auditoría', icon: ScrollText, permission: 'audit:read' },
  { to: '/estado', label: 'Estado', icon: Activity, permission: 'system:status' },
];
