import { Router } from 'express';
import { AppError } from '../../lib/errors';
import type { AuthGuards } from '../auth/auth.middleware';
import { findReceiptImage } from './receipts.service';

/**
 * /api/v1/receipts
 *   GET /:id   foto de un comprobante guardada en MongoDB (con sesión; nunca pública)
 */
export function createReceiptsRouter(guards: AuthGuards): Router {
  const router = Router();
  router.get('/:id', guards.authenticate(), async (req, res) => {
    const image = await findReceiptImage(String(req.params.id));
    if (image === null) throw new AppError(404, 'NOT_FOUND', 'Comprobante no encontrado');
    res.set({
      'Content-Type': image.contentType,
      'Cache-Control': 'private, max-age=86400',
      'Cross-Origin-Resource-Policy': 'cross-origin',
      'Content-Security-Policy': "default-src 'none'",
    });
    res.send(image.data);
  });
  return router;
}
