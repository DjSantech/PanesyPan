import { RECEIPT_IMAGE_TYPES } from '@panesypan/shared';
import { model, Schema, type Types } from 'mongoose';

export type ReceiptImageType = (typeof RECEIPT_IMAGE_TYPES)[number];

/**
 * Foto guardada de un comprobante. Con `url` está en Cloudinary (`publicId` sirve para
 * borrarla); sin `url` está en MongoDB, en ReceiptImage.
 */
export interface StoredReceipt {
  id: Types.ObjectId;
  contentType: ReceiptImageType;
  url?: string | null;
  publicId?: string | null;
}

export const storedReceiptSchema = new Schema<StoredReceipt>(
  {
    id: { type: Schema.Types.ObjectId, required: true },
    contentType: { type: String, enum: RECEIPT_IMAGE_TYPES, required: true },
    url: { type: String, default: null },
    publicId: { type: String, default: null },
  },
  { _id: false },
);

export interface ReceiptImageAttrs {
  contentType: ReceiptImageType;
  data: Buffer;
  size: number;
  createdAt: Date;
}

const receiptImageSchema = new Schema<ReceiptImageAttrs>(
  {
    contentType: { type: String, enum: RECEIPT_IMAGE_TYPES, required: true },
    data: { type: Buffer, required: true },
    size: { type: Number, required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false }, strict: 'throw' },
);

export const ReceiptImageModel = model<ReceiptImageAttrs>('ReceiptImage', receiptImageSchema);
