import { apiErrorResponseSchema, auditLogPageSchema } from '@panesypan/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { startTestDatabase } from '../../../test/database';
import {
  createTestUser,
  DEFAULT_PASSWORD,
  initModels,
  login,
  resetDatabase,
  type LoggedIn,
} from '../../../test/factories';
import { createTestEnv, silentLogger } from '../../../test/helpers';
import { createApp } from '../../app';
import { AuditLogModel } from './audit-log.model';
import { recordAudit } from './audit.service';

const app = createApp(createTestEnv({ AUTH_RATE_LIMIT_MAX: '1000' }), silentLogger);

let stopDatabase: (() => Promise<void>) | undefined;
let admin: LoggedIn;

beforeAll(async () => {
  stopDatabase = await startTestDatabase();
  await initModels();
});

afterAll(async () => {
  await stopDatabase?.();
});

beforeEach(async () => {
  await resetDatabase();
  await createTestUser({ username: 'admin', role: 'ADMIN' });
  admin = await login(app, 'admin', DEFAULT_PASSWORD);
});

const page = async (query = '') => {
  const response = await admin.agent.get(`/api/v1/audit-logs${query}`);
  expect(response.status).toBe(200);
  return auditLogPageSchema.parse(response.body);
};

describe('GET /audit-logs', () => {
  it('lista los eventos del más reciente al más antiguo', async () => {
    const result = await page();
    expect(result.items[0]?.action).toBe('AUTH_LOGIN_SUCCESS');
    expect(result.items[0]?.actor?.name).toBeDefined();
  });

  it('una cajera no puede ver la auditoría', async () => {
    const { user } = await createTestUser();
    const cashier = await login(app, user.username, DEFAULT_PASSWORD);
    const response = await cashier.agent.get('/api/v1/audit-logs');
    expect(response.status).toBe(403);
  });

  it('filtra por acción y por fecha (hora de Colombia)', async () => {
    await recordAudit({ action: 'USER_PIN_RESET', actor: null });

    const byAction = await page('?action=USER_PIN_RESET');
    expect(byAction.items.map((item) => item.action)).toEqual(['USER_PIN_RESET']);

    await AuditLogModel.collection.insertOne({
      action: 'USER_UNLOCKED',
      actor: null,
      entity: null,
      metadata: {},
      ip: null,
      userAgent: null,
      requestId: null,
      // 9 de marzo de 2025 a las 11:30 p. m. en Colombia (4:30 a. m. del 10 en UTC)
      createdAt: new Date('2025-03-10T04:30:00Z'),
    });
    const march9 = await page('?from=2025-03-09&to=2025-03-09');
    expect(march9.items.map((item) => item.action)).toEqual(['USER_UNLOCKED']);
    const march10 = await page('?from=2025-03-10&to=2025-03-10');
    expect(march10.items).toHaveLength(0);
  });

  it('pagina con cursor sin repetir ni saltar eventos', async () => {
    for (let index = 0; index < 5; index += 1) {
      await recordAudit({ action: 'USER_UNLOCKED', actor: null, metadata: { index } });
    }

    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const result = await page(
        `?action=USER_UNLOCKED&limit=2${cursor === null ? '' : `&cursor=${cursor}`}`,
      );
      seen.push(...result.items.map((item) => item.id));
      cursor = result.nextCursor;
    } while (cursor !== null);

    expect(seen).toHaveLength(5);
    expect(new Set(seen).size).toBe(5);
  });

  it('rechaza cursores y fechas inválidas con 400', async () => {
    const badCursor = await admin.agent.get('/api/v1/audit-logs?cursor=no-es-un-cursor');
    expect(badCursor.status).toBe(400);

    const badDate = await admin.agent.get('/api/v1/audit-logs?from=2026-02-31');
    expect(badDate.status).toBe(400);
    expect(apiErrorResponseSchema.parse(badDate.body).error.code).toBe('VALIDATION_ERROR');
  });
});

describe('inmutabilidad', () => {
  it('no permite modificar ni borrar eventos con Mongoose', async () => {
    await expect(AuditLogModel.updateOne({}, { $set: { action: 'USER_CREATED' } })).rejects.toThrow(
      /no se puede modificar/,
    );
    await expect(AuditLogModel.deleteMany({})).rejects.toThrow(/no se puede modificar/);
    expect(await AuditLogModel.countDocuments()).toBeGreaterThan(0);
  });
});
