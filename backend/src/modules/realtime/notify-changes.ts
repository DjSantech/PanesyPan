import type { RequestHandler } from 'express';
import { UNSAFE_METHODS } from '../../lib/http';
import { notifyDashboardChanged } from './realtime';

/**
 * Rutas de la API (relativas a /api/v1) cuyos cambios mueven el dashboard: cobros y anulaciones,
 * movimientos de caja e inventario. Editar una cuenta de mesa no cuenta hasta que se cobra.
 */
const DASHBOARD_ROUTES: readonly RegExp[] = [
  /^\/sales\//,
  /^\/tabs\/[^/]+\/(checkout|cancel)$/,
  /^\/cash-shifts(\/|$)/,
  /^\/inventory\//,
];

/**
 * Cuando una petición que modifica datos termina bien, avisa al dashboard. Va en el router y no
 * en cada servicio para no tocar la lógica de negocio: los servicios siguen sin saber de sockets.
 */
export const notifyDashboardOnChanges: RequestHandler = (req, res, next) => {
  if (UNSAFE_METHODS.has(req.method) && DASHBOARD_ROUTES.some((route) => route.test(req.path))) {
    res.on('finish', () => {
      if (res.statusCode >= 200 && res.statusCode < 300) notifyDashboardChanged();
    });
  }
  next();
};
