import {
  slugify,
  type CashConcept,
  type CashMovementType,
  type CreateCashConceptRequest,
  type CreateStaffMemberRequest,
  type StaffMember,
  type UpdateCashConceptRequest,
  type UpdateStaffMemberRequest,
} from '@panesypan/shared';
import { mongo, trusted, Types } from 'mongoose';
import { AppError } from '../../lib/errors';
import { recordAudit } from '../audit/audit.service';
import { toAuditActor } from '../users/users.mapper';
import type { ActorContext } from '../users/users.service';
import {
  CashConceptModel,
  StaffMemberModel,
  type CashConceptDocument,
  type StaffMemberDocument,
} from './cash-config.models';

const conflict = (message: string): AppError => new AppError(409, 'CONFLICT', message);
const notFound = (what: string): AppError =>
  new AppError(404, 'NOT_FOUND', `${what} no encontrado`);
const isDuplicateKey = (error: unknown): boolean =>
  error instanceof mongo.MongoServerError && error.code === 11000;

function audit(
  ctx: ActorContext,
  entry: Omit<Parameters<typeof recordAudit>[0], 'actor' | 'meta'>,
) {
  return recordAudit({ ...entry, actor: toAuditActor(ctx.actor), meta: ctx.meta }, ctx.logger);
}

// ── Tipos de movimiento ────────────────────────────────────────────

/**
 * Tipos con los que arranca el sistema, tomados de los que usa la panadería en su POS anterior.
 * El dueño los renombra, desactiva o agrega más en Ajustes.
 */
export const DEFAULT_CASH_CONCEPTS: readonly {
  name: string;
  type: CashMovementType;
  requiresStaff?: boolean;
}[] = [
  { name: 'Compra de insumos', type: 'EXPENSE' },
  { name: 'Nómina / pago a trabajador', type: 'EXPENSE', requiresStaff: true },
  { name: 'Proveedor', type: 'EXPENSE' },
  { name: 'Servicios públicos', type: 'EXPENSE' },
  { name: 'Arriendo', type: 'EXPENSE' },
  { name: 'Gas', type: 'EXPENSE' },
  { name: 'Hielo', type: 'EXPENSE' },
  { name: 'Domicilio', type: 'EXPENSE' },
  { name: 'Gastos varios', type: 'EXPENSE' },
  { name: 'Retiro / ganancia del dueño', type: 'WITHDRAWAL' },
  { name: 'Guardar en caja fuerte', type: 'WITHDRAWAL' },
  { name: 'Base de proveedores', type: 'WITHDRAWAL' },
  { name: 'Base adicional', type: 'INCOME' },
  { name: 'Cambio que trae el dueño', type: 'INCOME' },
  { name: 'Reintegro', type: 'INCOME' },
];

/** Crea los tipos por defecto si todavía no hay ninguno. Se puede llamar las veces que sea. */
export async function ensureDefaultCashConcepts(): Promise<void> {
  if ((await CashConceptModel.estimatedDocumentCount()) > 0) return;
  try {
    await CashConceptModel.insertMany(
      DEFAULT_CASH_CONCEPTS.map((concept, index) => ({
        name: concept.name,
        key: slugify(concept.name),
        type: concept.type,
        requiresStaff: concept.requiresStaff ?? false,
        sortOrder: index + 1,
      })),
      { ordered: false },
    );
  } catch (error) {
    // Dos peticiones a la vez: la otra ya los creó.
    if (!isDuplicateKey(error)) throw error;
  }
}

function toConceptDto(concept: CashConceptDocument): CashConcept {
  return {
    id: concept.id,
    name: concept.name,
    type: concept.type,
    requiresStaff: concept.requiresStaff,
    isActive: concept.isActive,
    sortOrder: concept.sortOrder,
  };
}

const conceptEntity = (concept: CashConceptDocument) => ({
  type: 'CASH_CONCEPT',
  id: concept.id,
  label: concept.name,
});

export async function listCashConcepts(options: { activeOnly: boolean }): Promise<CashConcept[]> {
  await ensureDefaultCashConcepts();
  const concepts = await CashConceptModel.find(options.activeOnly ? { isActive: true } : {}).sort({
    sortOrder: 1,
    name: 1,
  });
  return concepts.map(toConceptDto);
}

export async function findActiveConcept(id: string): Promise<CashConceptDocument> {
  const concept = Types.ObjectId.isValid(id) ? await CashConceptModel.findById(id) : null;
  if (!concept?.isActive) throw notFound('Tipo de movimiento');
  return concept;
}

const duplicateConcept = () => conflict('Ya existe un tipo de movimiento con ese nombre');

export async function createCashConcept(
  input: CreateCashConceptRequest,
  ctx: ActorContext,
): Promise<CashConcept> {
  await ensureDefaultCashConcepts();
  const last = await CashConceptModel.findOne().sort({ sortOrder: -1 });
  let concept: CashConceptDocument;
  try {
    concept = await CashConceptModel.create({
      name: input.name,
      key: slugify(input.name),
      type: input.type,
      requiresStaff: input.requiresStaff ?? false,
      sortOrder: (last?.sortOrder ?? 0) + 1,
    });
  } catch (error) {
    if (isDuplicateKey(error)) throw duplicateConcept();
    throw error;
  }
  await audit(ctx, { action: 'CASH_CONCEPT_CREATED', entity: conceptEntity(concept) });
  return toConceptDto(concept);
}

export async function updateCashConcept(
  id: string,
  input: UpdateCashConceptRequest,
  ctx: ActorContext,
): Promise<CashConcept> {
  const concept = Types.ObjectId.isValid(id) ? await CashConceptModel.findById(id) : null;
  if (concept === null) throw notFound('Tipo de movimiento');
  const changes: Record<string, { from: unknown; to: unknown }> = {};

  if (input.name !== undefined && input.name !== concept.name) {
    const key = slugify(input.name);
    const taken = await CashConceptModel.exists({
      type: concept.type,
      key,
      _id: trusted({ $ne: concept._id }),
    });
    if (taken !== null) throw duplicateConcept();
    changes.name = { from: concept.name, to: input.name };
    concept.name = input.name;
    concept.key = key;
  }
  if (input.requiresStaff !== undefined && input.requiresStaff !== concept.requiresStaff) {
    changes.requiresStaff = { from: concept.requiresStaff, to: input.requiresStaff };
    concept.requiresStaff = input.requiresStaff;
  }
  if (input.isActive !== undefined && input.isActive !== concept.isActive) {
    changes.isActive = { from: concept.isActive, to: input.isActive };
    concept.isActive = input.isActive;
  }
  if (Object.keys(changes).length === 0) return toConceptDto(concept);

  try {
    await concept.save();
  } catch (error) {
    if (isDuplicateKey(error)) throw duplicateConcept();
    throw error;
  }
  await audit(ctx, {
    action: 'CASH_CONCEPT_UPDATED',
    entity: conceptEntity(concept),
    metadata: { changes },
  });
  return toConceptDto(concept);
}

// ── Personal ───────────────────────────────────────────────────────

function toStaffDto(member: StaffMemberDocument): StaffMember {
  return {
    id: member.id,
    name: member.name,
    position: member.position,
    isActive: member.isActive,
  };
}

const staffEntity = (member: StaffMemberDocument) => ({
  type: 'STAFF',
  id: member.id,
  label: member.name,
});

export async function listStaff(options: { activeOnly: boolean }): Promise<StaffMember[]> {
  const members = await StaffMemberModel.find(options.activeOnly ? { isActive: true } : {}).sort({
    isActive: -1,
    name: 1,
  });
  return members.map(toStaffDto);
}

export async function findActiveStaffMember(id: string): Promise<StaffMemberDocument> {
  const member = Types.ObjectId.isValid(id) ? await StaffMemberModel.findById(id) : null;
  if (!member?.isActive) throw notFound('Persona del personal');
  return member;
}

export async function createStaffMember(
  input: CreateStaffMemberRequest,
  ctx: ActorContext,
): Promise<StaffMember> {
  const member = await StaffMemberModel.create({
    name: input.name,
    position: input.position ?? '',
  });
  await audit(ctx, { action: 'STAFF_CREATED', entity: staffEntity(member) });
  return toStaffDto(member);
}

export async function updateStaffMember(
  id: string,
  input: UpdateStaffMemberRequest,
  ctx: ActorContext,
): Promise<StaffMember> {
  const member = Types.ObjectId.isValid(id) ? await StaffMemberModel.findById(id) : null;
  if (member === null) throw notFound('Persona del personal');
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  for (const field of ['name', 'position', 'isActive'] as const) {
    const next = input[field];
    if (next !== undefined && next !== member[field]) {
      changes[field] = { from: member[field], to: next };
      member.set(field, next);
    }
  }
  if (Object.keys(changes).length === 0) return toStaffDto(member);
  await member.save();
  await audit(ctx, { action: 'STAFF_UPDATED', entity: staffEntity(member), metadata: { changes } });
  return toStaffDto(member);
}
