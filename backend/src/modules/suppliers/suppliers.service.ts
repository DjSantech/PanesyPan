import {
  slugify,
  type CreateSupplierRequest,
  type ListSuppliersQuery,
  type Supplier,
  type UpdateSupplierRequest,
} from '@panesypan/shared';
import { mongo, trusted, type QueryFilter } from 'mongoose';
import { AppError } from '../../lib/errors';
import { escapeRegex } from '../../lib/regex';
import { recordAudit } from '../audit/audit.service';
import { toAuditActor } from '../users/users.mapper';
import type { ActorContext } from '../users/users.service';
import { SupplierModel, type SupplierAttrs, type SupplierDocument } from './supplier.model';

const conflict = (message: string): AppError => new AppError(409, 'CONFLICT', message);
const DUPLICATE = 'Ya existe un proveedor con ese nombre';

const isDuplicateKey = (error: unknown): boolean =>
  error instanceof mongo.MongoServerError && error.code === 11000;

const supplierEntity = (supplier: SupplierDocument) => ({
  type: 'SUPPLIER',
  id: supplier.id,
  label: supplier.name,
});

export function toSupplierDto(supplier: SupplierDocument): Supplier {
  return {
    id: supplier.id,
    name: supplier.name,
    documentType: supplier.documentType,
    documentNumber: supplier.documentNumber,
    phone: supplier.phone,
    email: supplier.email,
    city: supplier.city,
    address: supplier.address,
    isActive: supplier.isActive,
  };
}

export async function listSuppliers(query: ListSuppliersQuery): Promise<Supplier[]> {
  const filter: QueryFilter<SupplierAttrs> = {};
  if (query.status !== 'all') filter.isActive = query.status === 'active';
  if (query.search !== undefined && query.search.length > 0) {
    filter.slug = new RegExp(escapeRegex(slugify(query.search)), 'i');
  }
  const suppliers = await SupplierModel.find(filter).sort({ name: 1 }).limit(1_000);
  return suppliers.map(toSupplierDto);
}

export async function createSupplier(
  input: CreateSupplierRequest,
  ctx: ActorContext,
): Promise<Supplier> {
  const name = input.name.trim();
  const slug = slugify(name);
  if ((await SupplierModel.exists({ slug })) !== null) throw conflict(DUPLICATE);
  let supplier: SupplierDocument;
  try {
    supplier = await SupplierModel.create({
      name,
      slug,
      documentType: input.documentType ?? '',
      documentNumber: input.documentNumber ?? '',
      phone: input.phone ?? '',
      email: input.email ?? '',
      city: input.city ?? '',
      address: input.address ?? '',
    });
  } catch (error) {
    if (isDuplicateKey(error)) throw conflict(DUPLICATE);
    throw error;
  }
  await recordAudit(
    {
      action: 'SUPPLIER_CREATED',
      actor: toAuditActor(ctx.actor),
      entity: supplierEntity(supplier),
      meta: ctx.meta,
    },
    ctx.logger,
  );
  return toSupplierDto(supplier);
}

const EDITABLE = [
  'documentType',
  'documentNumber',
  'phone',
  'email',
  'city',
  'address',
  'isActive',
] as const;

export async function updateSupplier(
  id: string,
  input: UpdateSupplierRequest,
  ctx: ActorContext,
): Promise<Supplier> {
  const supplier = await SupplierModel.findById(id);
  if (supplier === null) throw new AppError(404, 'NOT_FOUND', 'Proveedor no encontrado');
  const changes: Record<string, { from: unknown; to: unknown }> = {};

  if (input.name !== undefined && input.name.trim() !== supplier.name) {
    const name = input.name.trim();
    const slug = slugify(name);
    if ((await SupplierModel.exists({ slug, _id: trusted({ $ne: supplier._id }) })) !== null) {
      throw conflict(DUPLICATE);
    }
    changes.name = { from: supplier.name, to: name };
    supplier.name = name;
    supplier.slug = slug;
  }
  for (const field of EDITABLE) {
    const value = input[field];
    if (value !== undefined && value !== supplier[field]) {
      changes[field] = { from: supplier[field], to: value };
      Object.assign(supplier, { [field]: value });
    }
  }
  if (Object.keys(changes).length === 0) return toSupplierDto(supplier);

  try {
    await supplier.save();
  } catch (error) {
    if (isDuplicateKey(error)) throw conflict(DUPLICATE);
    throw error;
  }
  await recordAudit(
    {
      action: 'SUPPLIER_UPDATED',
      actor: toAuditActor(ctx.actor),
      entity: supplierEntity(supplier),
      metadata: { changes },
      meta: ctx.meta,
    },
    ctx.logger,
  );
  return toSupplierDto(supplier);
}
