import {
  businessDateRangeUtc,
  type AuditAction,
  type AuditLog,
  type AuditLogPage,
  type ListAuditLogsQuery,
  type UserRole,
} from '@panesypan/shared';
import { trusted, Types, type QueryFilter } from 'mongoose';
import type { Logger } from 'pino';
import { z } from 'zod';
import { AppError } from '../../lib/errors';
import type { RequestMeta } from '../../lib/request-meta';
import { AuditLogModel, type AuditLogAttrs, type AuditLogDocument } from './audit-log.model';

export interface AuditActor {
  id: string;
  name: string;
  role: UserRole;
}

export interface AuditEntry {
  action: AuditAction;
  actor: AuditActor | null;
  entity?: { type: string; id: string; label?: string | null };
  metadata?: Record<string, unknown>;
  meta?: RequestMeta;
}

/**
 * Registra un evento de auditoría. Si falla, se deja constancia en los logs pero no se
 * interrumpe la operación del usuario.
 */
export async function recordAudit(entry: AuditEntry, logger?: Logger): Promise<void> {
  try {
    await AuditLogModel.create({
      action: entry.action,
      actor:
        entry.actor === null
          ? null
          : {
              id: new Types.ObjectId(entry.actor.id),
              name: entry.actor.name,
              role: entry.actor.role,
            },
      entity:
        entry.entity === undefined
          ? null
          : { type: entry.entity.type, id: entry.entity.id, label: entry.entity.label ?? null },
      metadata: entry.metadata ?? {},
      ip: entry.meta?.ip ?? null,
      userAgent: entry.meta?.userAgent ?? null,
      requestId: entry.meta?.requestId ?? null,
    });
  } catch (error) {
    logger?.error({ err: error, action: entry.action }, 'No se pudo registrar la auditoría');
  }
}

// ── Consulta con paginación por cursor (fecha + id) ────────────────

const cursorSchema = z.object({ t: z.iso.datetime(), id: z.string().regex(/^[a-f\d]{24}$/i) });

function encodeCursor(log: AuditLogDocument): string {
  return Buffer.from(JSON.stringify({ t: log.createdAt.toISOString(), id: log.id })).toString(
    'base64url',
  );
}

function decodeCursor(cursor: string): { t: Date; id: Types.ObjectId } {
  try {
    const parsed = cursorSchema.parse(
      JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')),
    );
    return { t: new Date(parsed.t), id: new Types.ObjectId(parsed.id) };
  } catch {
    throw new AppError(400, 'VALIDATION_ERROR', 'El cursor de paginación no es válido');
  }
}

function dayRange(date: string): { start: Date; end: Date } {
  try {
    return businessDateRangeUtc(date);
  } catch {
    throw new AppError(400, 'VALIDATION_ERROR', `La fecha ${date} no es válida`);
  }
}

export function toAuditLogDto(log: AuditLogDocument): AuditLog {
  return {
    id: log.id,
    action: log.action,
    actor:
      log.actor === null
        ? null
        : { id: log.actor.id.toString(), name: log.actor.name, role: log.actor.role },
    entity:
      log.entity === null
        ? null
        : { type: log.entity.type, id: log.entity.id, label: log.entity.label },
    metadata: log.metadata,
    ip: log.ip,
    createdAt: log.createdAt.toISOString(),
  };
}

/**
 * Los operadores propios ($gte, $lt) van envueltos en trusted(): Mongoose tiene activado
 * sanitizeFilter y neutraliza cualquier operador que no esté marcado como confiable.
 */
export async function listAuditLogs(query: ListAuditLogsQuery): Promise<AuditLogPage> {
  const conditions: QueryFilter<AuditLogAttrs>[] = [];
  if (query.action !== undefined) conditions.push({ action: query.action });
  if (query.actorId !== undefined) {
    conditions.push({ 'actor.id': new Types.ObjectId(query.actorId) });
  }
  if (query.from !== undefined) {
    conditions.push({ createdAt: trusted({ $gte: dayRange(query.from).start }) });
  }
  if (query.to !== undefined) {
    conditions.push({ createdAt: trusted({ $lt: dayRange(query.to).end }) });
  }
  if (query.cursor !== undefined) {
    const { t, id } = decodeCursor(query.cursor);
    conditions.push({
      $or: [{ createdAt: trusted({ $lt: t }) }, { createdAt: t, _id: trusted({ $lt: id }) }],
    });
  }

  const filter: QueryFilter<AuditLogAttrs> = conditions.length > 0 ? { $and: conditions } : {};
  const rows = await AuditLogModel.find(filter)
    .sort({ createdAt: -1, _id: -1 })
    .limit(query.limit + 1);

  const hasMore = rows.length > query.limit;
  const items = hasMore ? rows.slice(0, query.limit) : rows;
  const last = items.at(-1);
  return {
    items: items.map(toAuditLogDto),
    nextCursor: hasMore && last !== undefined ? encodeCursor(last) : null,
  };
}
