import {
  STOCK_MOVEMENT_TYPES,
  WASTE_REASONS,
  type StockMovementType,
  type WasteReason,
} from '@panesypan/shared';
import { model, Schema, type HydratedDocument, type Types } from 'mongoose';

// ── Existencias ────────────────────────────────────────────────────

/**
 * Existencias de un producto terminado. Se crea la primera vez que el producto recibe
 * producción o un ajuste; mientras no exista, el stock es 0.
 */
export interface InventoryItemAttrs {
  productId: Types.ObjectId;
  quantity: number;
  /** 0 = sin alerta de bajo stock. */
  minStock: number;
  createdAt: Date;
  updatedAt: Date;
}

const inventoryItemSchema = new Schema<InventoryItemAttrs>(
  {
    productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    quantity: {
      type: Number,
      default: 0,
      min: 0,
      validate: { validator: Number.isSafeInteger, message: 'La cantidad debe ser entera' },
    },
    minStock: { type: Number, default: 0, min: 0 },
  },
  { timestamps: true, strict: 'throw' },
);
inventoryItemSchema.index({ productId: 1 }, { unique: true });

export const InventoryItemModel = model<InventoryItemAttrs>('InventoryItem', inventoryItemSchema);
export type InventoryItemDocument = HydratedDocument<InventoryItemAttrs>;

// ── Movimientos (libro de solo inserción) ──────────────────────────

export interface StockMovementAttrs {
  productId: Types.ObjectId;
  productName: string;
  type: StockMovementType;
  /** Con signo: positivo entra, negativo sale. */
  delta: number;
  quantityAfter: number;
  reason: WasteReason | null;
  note: string;
  /** Día de negocio AAAA-MM-DD (hora de Colombia). */
  businessDate: string;
  by: { id: Types.ObjectId; name: string };
  saleId: Types.ObjectId | null;
  createdAt: Date;
}

const stockMovementSchema = new Schema<StockMovementAttrs>(
  {
    productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    productName: { type: String, required: true },
    type: { type: String, enum: STOCK_MOVEMENT_TYPES, required: true },
    delta: { type: Number, required: true },
    quantityAfter: { type: Number, required: true },
    reason: { type: String, enum: WASTE_REASONS, default: null },
    note: { type: String, default: '', maxlength: 200 },
    businessDate: { type: String, required: true },
    by: {
      type: new Schema(
        {
          id: { type: Schema.Types.ObjectId, required: true },
          name: { type: String, required: true },
        },
        { _id: false },
      ),
      required: true,
    },
    saleId: { type: Schema.Types.ObjectId, ref: 'Sale', default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false }, strict: 'throw' },
);
stockMovementSchema.index({ businessDate: 1, type: 1, createdAt: -1 });
stockMovementSchema.index({ productId: 1, createdAt: -1 });

export const StockMovementModel = model<StockMovementAttrs>('StockMovement', stockMovementSchema);
export type StockMovementDocument = HydratedDocument<StockMovementAttrs>;
