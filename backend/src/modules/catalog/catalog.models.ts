import {
  CATEGORY_KINDS,
  PRODUCT_IMAGE_TYPES,
  TAX_CODES,
  type CategoryKind,
  type ProductImageType,
  type TaxCode,
} from '@panesypan/shared';
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
  /** Costo unitario (null sin registrar). */
  cost: number | null;
  /** Subcategoría dentro de la categoría ('' = ninguna). */
  subcategory: string;
  /** Proveedor principal (pedido sugerido). */
  supplierId: Types.ObjectId | null;
  /** false = agotado por hoy (lo puede marcar la cajera). */
  isAvailable: boolean;
  isFavorite: boolean;
  /** Si descuenta inventario (Fase 1E). */
  trackStock: boolean;
  /** Impuesto para la factura electrónica; null = el impuesto general de Ajustes. */
  tax: TaxCode | null;
  description: string;
  /** Código de barras o interno; único entre los productos que lo tienen. */
  code?: string | null;
  /**
   * Imagen actual; cambia de id con cada subida. Con `url` está en Cloudinary (`publicId` sirve
   * para borrarla); sin `url` está en MongoDB, en ProductImage.
   */
  image: {
    id: Types.ObjectId;
    contentType: ProductImageType;
    url?: string | null;
    publicId?: string | null;
  } | null;
  isVisibleOnline: boolean;
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
    cost: {
      type: Number,
      default: null,
      min: 0,
      validate: {
        validator: (value: number | null) => value === null || Number.isSafeInteger(value),
        message: 'El costo debe ser entero',
      },
    },
    supplierId: { type: Schema.Types.ObjectId, ref: 'Supplier', default: null },
    subcategory: { type: String, default: '', trim: true, maxlength: 40 },
    isAvailable: { type: Boolean, default: true },
    isFavorite: { type: Boolean, default: false },
    trackStock: { type: Boolean, default: false },
    tax: { type: String, enum: [...TAX_CODES, null], default: null },
    description: { type: String, default: '', maxlength: 300 },
    code: { type: String, default: null, trim: true, maxlength: 40 },
    image: {
      type: new Schema(
        {
          id: { type: Schema.Types.ObjectId, required: true },
          contentType: { type: String, enum: PRODUCT_IMAGE_TYPES, required: true },
          url: { type: String, default: null },
          publicId: { type: String, default: null },
        },
        { _id: false },
      ),
      default: null,
    },
    isVisibleOnline: { type: Boolean, default: true },
    isActive: { type: Boolean, default: true },
    sortOrder: { type: Number, default: 0 },
  },
  { timestamps: true, strict: 'throw' },
);
productSchema.index({ slug: 1 }, { unique: true });
productSchema.index({ categoryId: 1, isActive: 1, sortOrder: 1, name: 1 });
// Único solo entre los que tienen código (muchos productos no lo tienen).
productSchema.index(
  { code: 1 },
  { unique: true, partialFilterExpression: { code: { $type: 'string' } } },
);

export const ProductModel = model<ProductAttrs>('Product', productSchema);
export type ProductDocument = HydratedDocument<ProductAttrs>;

// ── Imágenes de producto ───────────────────────────────────────────

/**
 * Imágenes guardadas en la misma base (unos 100 KB cada una: el navegador las reduce antes de
 * subirlas). Cada subida crea un documento nuevo, así la URL cambia y la caché nunca sirve una vieja.
 */
export interface ProductImageAttrs {
  productId: Types.ObjectId;
  contentType: ProductImageType;
  data: Buffer;
  size: number;
  createdAt: Date;
}

const productImageSchema = new Schema<ProductImageAttrs>(
  {
    productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    contentType: { type: String, enum: PRODUCT_IMAGE_TYPES, required: true },
    data: { type: Buffer, required: true },
    size: { type: Number, required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false }, strict: 'throw' },
);
productImageSchema.index({ productId: 1 });

export const ProductImageModel = model<ProductImageAttrs>('ProductImage', productImageSchema);

// ── Menú del día ───────────────────────────────────────────────────

export interface MenuOptionAttrs {
  name: string;
  isAvailable: boolean;
}

const menuOptionSchema = new Schema<MenuOptionAttrs>(
  { name: { type: String, required: true }, isAvailable: { type: Boolean, default: true } },
  { _id: false },
);

export interface DailyMenuAttrs {
  /** Día de negocio AAAA-MM-DD (hora de Colombia). */
  date: string;
  soups: MenuOptionAttrs[];
  principles: MenuOptionAttrs[];
  proteins: MenuOptionAttrs[];
  drinks: MenuOptionAttrs[];
  /** Formato anterior (una sola sopa, un solo principio y un jugo en texto libre): legado. */
  soup?: string;
  principle?: string;
  sides?: string[];
  juice?: string;
  notes: string;
  offerings: {
    productId: Types.ObjectId;
    portions: number | null;
    sold: number;
    withChoices: boolean;
  }[];
  isPublished: boolean;
  updatedBy: Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}

const dailyMenuSchema = new Schema<DailyMenuAttrs>(
  {
    date: { type: String, required: true },
    soups: { type: [menuOptionSchema], default: [] },
    principles: { type: [menuOptionSchema], default: [] },
    proteins: { type: [menuOptionSchema], default: [] },
    drinks: { type: [menuOptionSchema], default: [] },
    soup: { type: String },
    principle: { type: String },
    sides: { type: [String], default: undefined },
    juice: { type: String },
    notes: { type: String, default: '' },
    offerings: {
      type: [
        new Schema(
          {
            productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
            portions: { type: Number, default: null },
            sold: { type: Number, default: 0 },
            withChoices: { type: Boolean, default: true },
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
