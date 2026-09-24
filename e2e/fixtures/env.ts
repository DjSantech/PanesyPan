/** Puertos y cuentas del entorno de pruebas (distintos a los de desarrollo: 4000 y 5173). */
export const API_PORT = 4100;
export const WEB_PORT = 5174;
export const API_URL = `http://localhost:${String(API_PORT)}`;
export const WEB_ORIGIN = `http://localhost:${String(WEB_PORT)}`;

/** Administrador inicial que crea la API (SEED_ADMIN_*). Cambia la clave en el primer ingreso. */
export const ADMIN = {
  name: 'Marta Administradora',
  username: 'marta',
  initialPassword: 'harina-de-trigo-inicial-42',
  password: 'horno-de-lena-mañanero-2026',
  pin: '739182',
} as const;

/** Cajera que crea el administrador desde la pantalla de Usuarios. */
export const CASHIER = {
  name: 'Laura Cajera',
  username: 'laura',
  password: 'pandebono-caliente-7am',
  pin: '508317',
} as const;
