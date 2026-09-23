import { z } from 'zod';
import { AUDIT_ACTIONS } from '../constants/audit-actions';
import { USER_ROLES } from '../constants/roles';
import { objectIdSchema } from './common';

export const auditLogSchema = z.object({
  id: z.string(),
  action: z.enum(AUDIT_ACTIONS),
  actor: z.object({ id: z.string(), name: z.string(), role: z.enum(USER_ROLES) }).nullable(),
  entity: z.object({ type: z.string(), id: z.string(), label: z.string().nullable() }).nullable(),
  metadata: z.record(z.string(), z.unknown()),
  ip: z.string().nullable(),
  createdAt: z.iso.datetime(),
});
export type AuditLog = z.infer<typeof auditLogSchema>;

export const listAuditLogsQuerySchema = z.strictObject({
  action: z.enum(AUDIT_ACTIONS).optional(),
  actorId: objectIdSchema.optional(),
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});
export type ListAuditLogsQuery = z.infer<typeof listAuditLogsQuerySchema>;

export const auditLogPageSchema = z.object({
  items: z.array(auditLogSchema),
  nextCursor: z.string().nullable(),
});
export type AuditLogPage = z.infer<typeof auditLogPageSchema>;
