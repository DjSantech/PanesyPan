import { CATEGORY_KINDS, type CategoryKind } from '@panesypan/shared';
import { model, Schema, type HydratedDocument, type Types } from 'mongoose';

// ── Categoría ──────────────────────────────────────────────────────

export interface CategoryAttrs {
  name: string;
  slug: string;
  kind: CategoryKind;
  sortOrder: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const categorySchema = new Schema<CategoryAttrs>(
  {
    name: { type: String, required: true, trim: true, maxlength: 60 },
    slug: { type: String, required: true },
    kind: { type: String, enum: CATEGORY_KINDS, default: 'STANDARD' },
    sortOrder: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true, strict: 'throw' },
);
categorySchema.index({ slug: 1 }, { unique: true });
categorySchema.index({ isActive: 1, sortOrder: 1 });

export const CategoryModel = model<CategoryAttrs>('Category', categorySchema);
export type CategoryDocument = HydratedDocument<CategoryAttrs>;

// ── Producto ───────────────────────────────────────────────────────

/**
 * Los productos nunca se borran (las ventas los referencian): se archivan con isActive=false.
 * El precio es el precio final en pesos, con impuestos incluidos.
 */
export interface ProductAttrs {
  name: string;
  slug: string;
  categoryId: Types.ObjectId;
  price: number;
  /** false = agotado por hoy (lo puede marcar la cajera). */
  isAvailable: boolean;
  isFavorite: boolean;
  /** Si descuenta inventario (Fase 1E). */
  trackStock: boolean;
  isActive: boolean;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
}

const productSchema = new Schema<ProductAttrs>(
  {
    name: { type: String, required: true, trim: true, maxlength: 60 },
    slug: { type: String, required: true },
    categoryId: { type: Schema.Types.ObjectId, ref: 'Category', required: true },
    price: {
      type: Number,
      required: true,
      min: 0,
      validate: { validator: Number.isSafeInteger, message: 'El precio debe ser entero' },
    },
    isAvailable: { type: Boolean, default: true },
    isFavorite: { type: Boolean, default: false },
    trackStock: { type: Boolean, default: false },
    isActive: { type: Boolean, default: true },
    sortOrder: { type: Number, default: 0 },
  },
  { timestamps: true, strict: 'throw' },
);
productSchema.index({ slug: 1 }, { unique: true });
productSchema.index({ categoryId: 1, isActive: 1, sortOrder: 1, name: 1 });

export const ProductModel = model<ProductAttrs>('Product', productSchema);
export type ProductDocument = HydratedDocument<ProductAttrs>;

// ── Menú del día ───────────────────────────────────────────────────

export interface DailyMenuAttrs {
  /** Día de negocio AAAA-MM-DD (hora de Colombia). */
  date: string;
  soup: string;
  principle: string;
  proteins: { name: string; isAvailable: boolean }[];
  sides: string[];
  juice: string;
  notes: string;
  offerings: { productId: Types.ObjectId; portions: number | null; sold: number }[];
  isPublished: boolean;
  updatedBy: Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}

const dailyMenuSchema = new Schema<DailyMenuAttrs>(
  {
    date: { type: String, required: true },
    soup: { type: String, default: '' },
    principle: { type: String, default: '' },
    proteins: {
      type: [
        new Schema(
          { name: { type: String, required: true }, isAvailable: { type: Boolean, default: true } },
          { _id: false },
        ),
      ],
      default: [],
    },
    sides: { type: [String], default: [] },
    juice: { type: String, default: '' },
    notes: { type: String, default: '' },
    offerings: {
      type: [
        new Schema(
          {
            productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
            portions: { type: Number, default: null },
            sold: { type: Number, default: 0 },
          },
          { _id: false },
        ),
      ],
      default: [],
    },
    isPublished: { type: Boolean, default: false },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true, strict: 'throw' },
);
dailyMenuSchema.index({ date: 1 }, { unique: true });

export const DailyMenuModel = model<DailyMenuAttrs>('DailyMenu', dailyMenuSchema);
export type DailyMenuDocument = HydratedDocument<DailyMenuAttrs>;
