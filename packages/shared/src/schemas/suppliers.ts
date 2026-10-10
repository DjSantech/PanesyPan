import { z } from 'zod';

/** Proveedores a los que la panadería les paga (con la caja o por fuera). */
export const SUPPLIER_DOCUMENT_TYPES = ['', 'NIT', 'CC'] as const;
export type SupplierDocumentType = (typeof SUPPLIER_DOCUMENT_TYPES)[number];

export const SUPPLIER_DOCUMENT_LABELS: Readonly<Record<SupplierDocumentType, string>> = {
  '': 'Sin documento',
  NIT: 'NIT',
  CC: 'Cédula',
};

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Máximo ${String(max)} caracteres`);

const supplierNameSchema = z
  .string()
  .trim()
  .min(2, 'El nombre debe tener al menos 2 caracteres')
  .max(80, 'Máximo 80 caracteres');

export const supplierSchema = z.object({
  id: z.string(),
  name: z.string(),
  documentType: z.enum(SUPPLIER_DOCUMENT_TYPES),
  documentNumber: z.string(),
  phone: z.string(),
  email: z.string(),
  city: z.string(),
  address: z.string(),
  isActive: z.boolean(),
});
export type Supplier = z.infer<typeof supplierSchema>;

export const supplierResponseSchema = z.object({ supplier: supplierSchema });
export const listSuppliersResponseSchema = z.object({ items: z.array(supplierSchema) });

export const listSuppliersQuerySchema = z.strictObject({
  status: z.enum(['active', 'archived', 'all']).default('active'),
  search: z.string().trim().max(60).optional(),
});
export type ListSuppliersQuery = z.infer<typeof listSuppliersQuerySchema>;

export const createSupplierRequestSchema = z.strictObject({
  name: supplierNameSchema,
  documentType: z.enum(SUPPLIER_DOCUMENT_TYPES).default(''),
  documentNumber: optionalText(30).default(''),
  phone: optionalText(30).default(''),
  email: z
    .union([z.literal(''), z.email('Escribe un correo válido').max(80)])
    .default('')
    .transform((value) => value.trim()),
  city: optionalText(60).default(''),
  address: optionalText(120).default(''),
});
export type CreateSupplierRequest = z.input<typeof createSupplierRequestSchema>;

export const updateSupplierRequestSchema = createSupplierRequestSchema
  .partial()
  .extend({ isActive: z.boolean().optional() })
  .refine((data) => Object.keys(data).length > 0, { message: 'No hay cambios para guardar' });
export type UpdateSupplierRequest = z.input<typeof updateSupplierRequestSchema>;
