import type { Browser, BrowserContext, Page } from '@playwright/test';
import { ADMIN, API_URL, CASHIER, WEB_ORIGIN } from '../../fixtures/env';

/**
 * Personas ficticias de los videos. Las cuentas son las mismas de las pruebas de punta a punta
 * (fixtures/env.ts), con nombres que se ven naturales en pantalla.
 */
export const PEOPLE = {
  admin: { ...ADMIN, name: 'Marta Ríos' },
  cashier: { ...CASHIER, name: 'Laura Gómez' },
} as const;

export type Role = keyof typeof PEOPLE;

interface ApiResponse {
  status: number;
  body: unknown;
}

interface AuthSession {
  csrfToken: string;
  user: { id: string };
}

const isAuthSession = (body: unknown): body is AuthSession =>
  typeof body === 'object' && body !== null && 'csrfToken' in body && 'user' in body;

/** Peticiones a la API desde una página del POS, con sus cookies, como las hace la app. */
export class DemoApi {
  private csrfToken: string | null = null;

  private constructor(readonly page: Page) {}

  /** Abre una página liviana del POS (sin cargar la app) para usar sus cookies. */
  static async open(context: BrowserContext): Promise<DemoApi> {
    const page = await context.newPage();
    await page.goto('/robots.txt');
    return new DemoApi(page);
  }

  async send(method: string, path: string, body?: unknown): Promise<ApiResponse> {
    return this.page.evaluate(
      async ({ url, verb, payload, csrfToken }) => {
        const headers: Record<string, string> = { Accept: 'application/json' };
        if (payload !== undefined) headers['Content-Type'] = 'application/json';
        if (verb !== 'GET' && csrfToken !== null) headers['X-CSRF-Token'] = csrfToken;
        const init: RequestInit = { method: verb, headers, credentials: 'include' };
        if (payload !== undefined) init.body = JSON.stringify(payload);
        const response = await fetch(url, init);
        const text = await response.text();
        return {
          status: response.status,
          body: text === '' ? null : (JSON.parse(text) as unknown),
        };
      },
      { url: `${API_URL}${path}`, verb: method, payload: body, csrfToken: this.csrfToken },
    );
  }

  /** Igual que send, pero falla si la API responde con error. */
  async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const response = await this.send(method, path, body);
    if (response.status >= 400) {
      throw new Error(
        `${method} ${path} → ${String(response.status)} ${JSON.stringify(response.body)}`,
      );
    }
    // Las respuestas de sesión traen el token CSRF vigente.
    if (isAuthSession(response.body)) this.csrfToken = response.body.csrfToken;
    return response.body as T;
  }

  login(identifier: string, password: string): Promise<AuthSession> {
    return this.request<AuthSession>('POST', '/api/v1/auth/login', { identifier, password });
  }

  async close(): Promise<void> {
    await this.page.close();
  }
}

/**
 * Datos de demostración del entorno de los videos. Las cuentas se preparan por la API una sola
 * vez por ejecución: primer ingreso del administrador, la cajera y su primer ingreso.
 */
export class Demo {
  private constructor(
    private readonly browser: Browser,
    private readonly context: BrowserContext,
    /** Sesión del administrador para preparar datos. */
    readonly admin: DemoApi,
  ) {}

  static async connect(browser: Browser): Promise<Demo> {
    const context = await browser.newContext({ baseURL: WEB_ORIGIN });
    const admin = await DemoApi.open(context);
    const demo = new Demo(browser, context, admin);
    const { username, password } = PEOPLE.admin;
    const session = await admin.send('POST', '/api/v1/auth/login', {
      identifier: username,
      password,
    });
    if (session.status === 200) await admin.login(username, password);
    else await demo.createAccounts();
    return demo;
  }

  /** Inicia sesión en el contexto (las cookies quedan para la app). */
  async signIn(context: BrowserContext, role: Role): Promise<void> {
    const api = await DemoApi.open(context);
    await api.login(PEOPLE[role].username, PEOPLE[role].password);
    await api.close();
  }

  /** Sesión de la cajera para preparar datos a su nombre (su caja, sus ventas…). */
  async cashier(): Promise<DemoApi> {
    const context = await this.browser.newContext({ baseURL: WEB_ORIGIN });
    const api = await DemoApi.open(context);
    await api.login(PEOPLE.cashier.username, PEOPLE.cashier.password);
    return api;
  }

  /** El administrador crea un usuario nuevo; devuelve su contraseña temporal. */
  async createUser(name: string, username: string): Promise<string> {
    const created = await this.admin.request<{ temporaryPassword: string }>(
      'POST',
      '/api/v1/users',
      { name, username, role: 'CASHIER' },
    );
    return created.temporaryPassword;
  }

  async close(): Promise<void> {
    await this.context.close();
  }

  private async createAccounts(): Promise<void> {
    const { admin, cashier } = PEOPLE;
    const session = await this.admin.login(admin.username, admin.initialPassword);
    await this.admin.request('POST', '/api/v1/auth/change-password', {
      currentPassword: admin.initialPassword,
      newPassword: admin.password,
    });
    await this.admin.request('PUT', '/api/v1/auth/pin', { pin: admin.pin });
    await this.admin.request('PATCH', `/api/v1/users/${session.user.id}`, { name: admin.name });

    const created = await this.admin.request<{ temporaryPassword: string }>(
      'POST',
      '/api/v1/users',
      {
        name: cashier.name,
        username: cashier.username,
        role: 'CASHIER',
      },
    );
    const context = await this.browser.newContext({ baseURL: WEB_ORIGIN });
    try {
      const api = await DemoApi.open(context);
      await api.login(cashier.username, created.temporaryPassword);
      await api.request('POST', '/api/v1/auth/change-password', {
        currentPassword: created.temporaryPassword,
        newPassword: cashier.password,
      });
      await api.request('PUT', '/api/v1/auth/pin', { pin: cashier.pin });
    } finally {
      await context.close();
    }
  }
}
