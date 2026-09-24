import {
  authSessionResponseSchema,
  type AuthSessionResponse,
  type UserRole,
} from '@panesypan/shared';
import type { Express } from 'express';
import request from 'supertest';
import { hashSecret } from '../src/lib/password';
import { AuditLogModel } from '../src/modules/audit/audit-log.model';
import { SessionModel } from '../src/modules/auth/session.model';
import { CashShiftModel } from '../src/modules/cash/cash-shift.model';
import { CategoryModel, DailyMenuModel, ProductModel } from '../src/modules/catalog/catalog.models';
import { SaleModel, SequenceModel } from '../src/modules/sales/sale.model';
import { SettingsModel } from '../src/modules/settings/settings.model';
import { UserModel, type UserDocument } from '../src/modules/users/user.model';

export const DEFAULT_PASSWORD = 'horno caliente 7am';
export const DEFAULT_PIN = '482915';

let sequence = 0;

export interface TestUserOptions {
  name?: string;
  username?: string;
  email?: string | null;
  role?: UserRole;
  password?: string;
  pin?: string | null;
  mustChangePassword?: boolean;
  isActive?: boolean;
}

/** Crea un usuario directamente en la base de datos. */
export async function createTestUser(
  options: TestUserOptions = {},
): Promise<{ user: UserDocument; password: string }> {
  sequence += 1;
  const password = options.password ?? DEFAULT_PASSWORD;
  const pin = options.pin === undefined ? DEFAULT_PIN : options.pin;
  const user = await UserModel.create({
    name: options.name ?? `Persona ${String(sequence)}`,
    username: options.username ?? `usuario${String(sequence)}`,
    email: options.email ?? null,
    role: options.role ?? 'CASHIER',
    passwordHash: await hashSecret(password),
    pinHash: pin === null ? null : await hashSecret(pin),
    pinSetAt: pin === null ? null : new Date(),
    mustChangePassword: options.mustChangePassword ?? false,
    isActive: options.isActive ?? true,
  });
  return { user, password };
}

export type Agent = ReturnType<typeof request.agent>;

export interface LoggedIn {
  agent: Agent;
  csrfToken: string;
  body: AuthSessionResponse;
  /** Valor de la cookie de refresco (para simular robos o reusos). */
  refreshCookie: string;
}

/** Inicia sesión con un agente de Supertest que conserva las cookies. */
export async function login(app: Express, identifier: string, password: string): Promise<LoggedIn> {
  const agent = request.agent(app);
  const response = await agent.post('/api/v1/auth/login').send({ identifier, password });
  if (response.status !== 200) {
    throw new Error(`El login falló: ${String(response.status)} ${JSON.stringify(response.body)}`);
  }
  const body = authSessionResponseSchema.parse(response.body);
  return { agent, csrfToken: body.csrfToken, body, refreshCookie: readCookie(response, 'pyp_rt') };
}

/** Extrae el valor de una cookie de la respuesta (header Set-Cookie). */
export function readCookie(response: request.Response, name: string): string {
  const header = response.headers['set-cookie'] as unknown;
  const cookies = Array.isArray(header) ? (header as string[]) : [];
  const found = cookies.find((cookie) => cookie.startsWith(`${name}=`));
  if (found === undefined) return '';
  return found.slice(name.length + 1).split(';')[0] ?? '';
}

export function setCookieHeaders(response: request.Response): string[] {
  const header = response.headers['set-cookie'] as unknown;
  return Array.isArray(header) ? (header as string[]) : [];
}

/** Deja la base de datos limpia entre pruebas (la auditoría se borra sin pasar por Mongoose). */
export async function resetDatabase(): Promise<void> {
  await Promise.all([
    UserModel.deleteMany({}),
    SessionModel.deleteMany({}),
    AuditLogModel.collection.deleteMany({}),
    CategoryModel.deleteMany({}),
    ProductModel.deleteMany({}),
    DailyMenuModel.deleteMany({}),
    SettingsModel.deleteMany({}),
    CashShiftModel.deleteMany({}),
    SaleModel.deleteMany({}),
    SequenceModel.deleteMany({}),
  ]);
}

export async function initModels(): Promise<void> {
  await Promise.all([
    UserModel.init(),
    SessionModel.init(),
    AuditLogModel.init(),
    CategoryModel.init(),
    ProductModel.init(),
    DailyMenuModel.init(),
    SettingsModel.init(),
    CashShiftModel.init(),
    SaleModel.init(),
    SequenceModel.init(),
  ]);
}
