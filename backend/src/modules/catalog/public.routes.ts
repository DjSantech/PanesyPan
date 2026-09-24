import { Router } from 'express';
import { AppError } from '../../lib/errors';
import { findPublicImage } from './catalog.service';

/** Un año: cada subida crea una imagen con otro id, así que una URL nunca cambia de contenido. */
const IMAGE_CACHE = 'public, max-age=31536000, immutable';

/**
 * /api/v1/public (sin sesión)
 *   GET /images/:file   imagen de un producto ("<id>.webp"), para el POS y la web pública
 */
export function createPublicRouter(): Router {
  const router = Router();

  router.get('/images/:file', async (req, res) => {
    const image = await findPublicImage(req.params.file);
    if (image === null) throw new AppError(404, 'NOT_FOUND', 'Imagen no encontrada');
    res.set({
      'Content-Type': image.contentType,
      'Cache-Control': IMAGE_CACHE,
      // La cargan el POS y la web (otros subdominios): helmet la limita al mismo origen por defecto.
      'Cross-Origin-Resource-Policy': 'cross-origin',
      'Content-Security-Policy': "default-src 'none'",
    });
    res.send(image.data);
  });

  return router;
}
