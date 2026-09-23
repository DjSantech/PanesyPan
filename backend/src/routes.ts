import { Router } from 'express';

/**
 * Rutas de negocio bajo /api/v1. Cada módulo de la Fase 1 (auth, users, catalog, sales,
 * cash, inventory, reports, audit) registra aquí su router.
 */
export function createApiRouter(): Router {
  const router = Router();
  return router;
}
