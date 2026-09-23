export const USER_ROLES = ['ADMIN', 'CASHIER'] as const;

export type UserRole = (typeof USER_ROLES)[number];

export const USER_ROLE_LABELS: Readonly<Record<UserRole, string>> = {
  ADMIN: 'Administrador',
  CASHIER: 'Cajera',
};
