import type { Env } from '../../config/env';
import type { CloudinaryCredentials } from '../../lib/cloudinary';

/** Carpeta de Cloudinary donde quedan las fotos de productos. */
export const PRODUCT_IMAGES_FOLDER = 'panesypan/productos';

let cloudinary: CloudinaryCredentials | null = null;

/**
 * Dónde se guardan las fotos: Cloudinary si están sus credenciales (producción); si no, en
 * MongoDB (desarrollo y pruebas). `createApp` lo configura al arrancar.
 */
export function configureImageStorage(env: Env): void {
  const { CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET } = env;
  cloudinary =
    CLOUDINARY_CLOUD_NAME !== undefined &&
    CLOUDINARY_API_KEY !== undefined &&
    CLOUDINARY_API_SECRET !== undefined
      ? {
          cloudName: CLOUDINARY_CLOUD_NAME,
          apiKey: CLOUDINARY_API_KEY,
          apiSecret: CLOUDINARY_API_SECRET,
        }
      : null;
}

export const cloudinaryCredentials = (): CloudinaryCredentials | null => cloudinary;
