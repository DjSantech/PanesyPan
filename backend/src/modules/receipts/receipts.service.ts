import { RECEIPT_IMAGE_MAX_BYTES, type Receipt } from '@panesypan/shared';
import { Types } from 'mongoose';
import { destroyImage, uploadImage } from '../../lib/cloudinary';
import { AppError } from '../../lib/errors';
import { detectImageType } from '../catalog/catalog.service';
import { cloudinaryCredentials } from '../catalog/image-storage';
import type { ActorContext } from '../users/users.service';
import { ReceiptImageModel, type ReceiptImageAttrs, type StoredReceipt } from './receipts.model';

/** Carpeta de Cloudinary de los comprobantes (facturas y recibos). */
export const RECEIPTS_FOLDER = 'panesypan/comprobantes';

/** Dirección para ver la foto: la de Cloudinary o la de la API (exige sesión). */
export function toReceiptDto(receipt: StoredReceipt | null | undefined): Receipt | null {
  if (receipt === null || receipt === undefined) return null;
  const id = receipt.id.toString();
  return { id, url: receipt.url ?? `/api/v1/receipts/${id}` };
}

/** Valida el tipo real de la foto y la guarda en Cloudinary o, sin credenciales, en MongoDB. */
export async function storeReceipt(data: Buffer, ctx: ActorContext): Promise<StoredReceipt> {
  if (data.length === 0 || data.length > RECEIPT_IMAGE_MAX_BYTES) {
    throw new AppError(400, 'VALIDATION_ERROR', 'La foto debe pesar máximo 2 MB.');
  }
  const contentType = detectImageType(data);
  if (contentType === null) {
    throw new AppError(400, 'VALIDATION_ERROR', 'La foto debe ser JPG, PNG o WebP.');
  }
  const credentials = cloudinaryCredentials();
  if (credentials === null) {
    const image = await ReceiptImageModel.create({ contentType, data, size: data.length });
    return { id: image._id, contentType, url: null, publicId: null };
  }
  try {
    const uploaded = await uploadImage(credentials, { data, contentType }, RECEIPTS_FOLDER);
    return {
      id: new Types.ObjectId(),
      contentType,
      url: uploaded.url,
      publicId: uploaded.publicId,
    };
  } catch (error) {
    ctx.logger?.error(
      { reason: error instanceof Error ? error.message : String(error) },
      'No se pudo subir el comprobante a Cloudinary',
    );
    throw new AppError(503, 'SERVICE_UNAVAILABLE', 'No se pudo subir la foto. Intenta de nuevo.');
  }
}

/** Borra una foto que se reemplazó. Si Cloudinary falla, solo se registra. */
export async function deleteReceipt(receipt: StoredReceipt, ctx: ActorContext): Promise<void> {
  if (typeof receipt.publicId === 'string') {
    const credentials = cloudinaryCredentials();
    if (credentials === null) return;
    await destroyImage(credentials, receipt.publicId).catch((error: unknown) => {
      ctx.logger?.warn(
        { reason: error instanceof Error ? error.message : String(error) },
        'No se pudo borrar el comprobante anterior de Cloudinary',
      );
    });
    return;
  }
  await ReceiptImageModel.deleteOne({ _id: receipt.id });
}

export async function findReceiptImage(id: string): Promise<ReceiptImageAttrs | null> {
  if (!Types.ObjectId.isValid(id)) return null;
  return ReceiptImageModel.findById(id);
}
