import {
  nitCheckDigit,
  splitTaxIncluded,
  TAX_DEFINITIONS,
  type BuyerIdType,
  type PaymentMethod,
} from '@panesypan/shared';
import type { DocumentDraft, DraftCustomer, DraftLine } from '../draft';
import {
  ProviderRejectedError,
  ProviderUnavailableError,
  type EInvoiceProviderClient,
  type IssueRequest,
  type IssueResult,
} from './provider';

/**
 * Adaptador de Factus (API v2, https://developers.factus.com.co).
 * - Autenticación OAuth2 (password grant); el token se reutiliza hasta que vence.
 * - Factura: POST /v2/bills/validate · Nota crédito: POST /v2/credit-notes/validate.
 * - Factus recibe precios SIN impuesto: se separan del precio de venta (que lo incluye) y la
 *   diferencia de centavos se ajusta con `cash_rounding_amount` (máximo ± $ 500).
 * - `reference_code` evita duplicados: si una respuesta se pierde y se reintenta, Factus
 *   responde conflicto y se busca el documento ya emitido.
 * Antes de producción hay que validar el flujo en el sandbox (ver README, "Facturación electrónica").
 */
export interface FactusCredentials {
  environment: 'sandbox' | 'production';
  clientId: string;
  clientSecret: string;
  username: string;
  password: string;
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

const BASE_URLS = {
  sandbox: 'https://api-sandbox.factus.com.co',
  production: 'https://api.factus.com.co',
} as const;

const REQUEST_TIMEOUT_MS = 20_000;
const TOKEN_MARGIN_MS = 60_000;
const MAX_ROUNDING = 500;
const MESSAGE_MAX = 500;

/** Códigos de la DIAN (tabla de tipos de documento de identidad). */
const ID_TYPE_CODES: Readonly<Record<BuyerIdType, string>> = {
  CC: '13',
  NIT: '31',
  CE: '22',
  PP: '41',
  PPT: '48',
};

/** Códigos de la DIAN para medios de pago. Nequi y Daviplata son transferencias. */
const PAYMENT_CODES: Readonly<Record<PaymentMethod, string>> = {
  CASH: '10',
  NEQUI: '47',
  DAVIPLATA: '47',
  DEBIT_CARD: '49',
  CREDIT_CARD: '48',
  BANK_TRANSFER: '47',
};

/** Consumidor final según la DIAN: cédula 222222222222. */
const FINAL_CONSUMER = {
  identification_document_code: '13',
  identification: '222222222222',
  names: 'Consumidor final',
  legal_organization_code: '2',
  tribute_code: 'ZZ',
} as const;

const UNIT_MEASURE_UNIT = '94';
const STANDARD_CODE_OWN = '999';
/** Concepto de corrección de la DIAN: 2 = anulación de la factura electrónica. */
const CORRECTION_VOID = '2';

const cents = (value: number): number => Math.round(value * 100) / 100;
const money = (value: number): string => cents(value).toFixed(2);

// ── Construcción de las peticiones ───────────────────────────────────

function toCustomer(customer: DraftCustomer | null): Record<string, string> {
  if (customer === null) return { ...FINAL_CONSUMER };
  const isCompany = customer.idType === 'NIT';
  const result: Record<string, string> = {
    identification_document_code: ID_TYPE_CODES[customer.idType],
    identification: customer.idNumber,
    legal_organization_code: isCompany ? '1' : '2',
    tribute_code: 'ZZ',
    country_code: 'CO',
  };
  if (isCompany) {
    result.company = customer.name;
    result.dv = String(customer.checkDigit ?? nitCheckDigit(customer.idNumber) ?? '');
  } else {
    result.names = customer.name;
  }
  if (customer.email !== '') result.email = customer.email;
  return result;
}

interface ItemComputation {
  item: Record<string, unknown>;
  /** Total de la línea como lo calculará Factus (base − descuento + impuesto). */
  total: number;
}

function toItem(line: DraftLine): ItemComputation {
  const { kind, rate } = TAX_DEFINITIONS[line.tax];
  const unitBase = splitTaxIncluded(line.unitPrice, rate).base;
  // En enteros (centésimas de punto porcentual) para no arrastrar errores de punto flotante.
  const discountRate =
    line.gross === 0 ? 0 : Math.round((line.discount * 10_000) / line.gross) / 100;
  const base = cents(unitBase * line.quantity);
  const taxable = cents(base - cents((base * discountRate) / 100));
  const tax = cents((taxable * rate) / 100);

  const item: Record<string, unknown> = {
    code_reference: line.code,
    name: line.name.slice(0, 150),
    quantity: line.quantity.toFixed(2),
    discount_rate: discountRate.toFixed(2),
    price: money(unitBase),
    unit_measure_code: UNIT_MEASURE_UNIT,
    standard_code: STANDARD_CODE_OWN,
  };
  if (kind === 'NONE') {
    item.is_excluded = 1;
    item.taxes = [];
  } else {
    item.is_excluded = 0;
    item.taxes = [{ code: kind === 'IVA' ? '01' : '04', rate: rate.toFixed(2) }];
  }
  return { item, total: cents(taxable + tax) };
}

/** Cuerpo de la factura o de la nota crédito para Factus. */
export function buildFactusPayload(request: IssueRequest): Record<string, unknown> {
  const { draft, related } = request;
  const computed = draft.lines.map(toItem);
  const factusTotal = cents(computed.reduce((sum, line) => sum + line.total, 0));
  const rounding = cents(draft.total - factusTotal);
  if (Math.abs(rounding) > MAX_ROUNDING) {
    throw new ProviderRejectedError(
      `La diferencia de redondeo (${money(rounding)}) supera el máximo que acepta Factus`,
    );
  }

  const payload: Record<string, unknown> = {
    reference_code: draft.referenceCode,
    observation: draft.observation.slice(0, 250),
    payment_details: draft.payments.map((payment, index) => ({
      payment_form: '1',
      payment_method_code: PAYMENT_CODES[payment.method],
      reference_code: `pago-${String(index + 1)}`,
      amount: money(payment.amount),
    })),
    cash_rounding_amount: money(rounding),
    customer: toCustomer(draft.customer),
    items: computed.map((line) => line.item),
  };
  if (draft.numberingRangeId !== null) payload.numbering_range_id = draft.numberingRangeId;

  if (draft.kind === 'INVOICE') {
    payload.document = '01';
    payload.operation_type = '10';
    payload.send_email = draft.sendEmail;
  } else {
    if (related === null) throw new ProviderRejectedError('La nota crédito no tiene factura');
    payload.correction_concept_code = CORRECTION_VOID;
    payload.customization_id = '20';
    payload.bill_number = related.number;
    payload.send_email = draft.sendEmail;
  }
  return payload;
}

// ── Lectura de respuestas ────────────────────────────────────────────

type Json = Record<string, unknown>;

const asObject = (value: unknown): Json | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Json) : null;
const asString = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() !== '' ? value : null;

/** Solo enlaces https: el enlace se muestra en el sistema y no debe poder ser otra cosa. */
const httpsUrl = (value: string | null): string | null =>
  value !== null && /^https:\/\/[^\s]+$/.test(value) ? value : null;

/** Fecha de validación que informa Factus; si no viene o no se entiende, ahora. */
function parseDate(value: string | null): Date {
  const parsed = value === null ? Number.NaN : Date.parse(value);
  return Number.isNaN(parsed) ? new Date() : new Date(parsed);
}

/** Toma el documento de la respuesta (Factus lo anida distinto según el endpoint y la versión). */
function readDocument(body: unknown): IssueResult | null {
  const data = asObject(asObject(body)?.data);
  if (data === null) return null;
  const doc = asObject(data.bill) ?? asObject(data.credit_note) ?? data;
  const links = asObject(data.links) ?? asObject(doc.links);
  const number = asString(doc.number);
  const cufe = asString(doc.cufe) ?? asString(doc.cude);
  if (number === null || cufe === null) return null;
  const id = doc.id;
  return {
    number,
    cufe,
    qrData: asString(doc.qr) ?? asString(links?.qr) ?? null,
    publicUrl: httpsUrl(asString(doc.public_url) ?? asString(links?.public_url)),
    validatedAt: parseDate(asString(doc.validated) ?? asString(doc.validated_at)),
    providerId: typeof id === 'number' || typeof id === 'string' ? String(id) : null,
  };
}

/** Mensaje legible de un error de Factus, sin datos sensibles y con largo acotado. */
export function readErrorMessage(body: unknown, status: number): string {
  const root = asObject(body);
  const parts: string[] = [];
  const message = asString(root?.message);
  if (message !== null) parts.push(message);
  const errors = asObject(asObject(root?.data)?.errors) ?? asObject(root?.errors);
  if (errors !== null) {
    for (const [field, value] of Object.entries(errors)) {
      const texts = Array.isArray(value) ? value.filter((item) => typeof item === 'string') : [];
      const text = texts.length > 0 ? texts.join(' ') : (asString(value) ?? '');
      if (text !== '') parts.push(`${field}: ${text}`);
    }
  }
  const joined = parts.join(' · ') || `Factus respondió ${String(status)}`;
  return joined.length > MESSAGE_MAX ? `${joined.slice(0, MESSAGE_MAX - 1)}…` : joined;
}

// ── Cliente ──────────────────────────────────────────────────────────

export function createFactusProvider(
  credentials: FactusCredentials,
  fetchImpl: FetchLike = fetch,
): EInvoiceProviderClient {
  const baseUrl = BASE_URLS[credentials.environment];
  let token: { value: string; expiresAt: number } | null = null;

  async function request(path: string, init: RequestInit): Promise<Response> {
    try {
      return await fetchImpl(`${baseUrl}${path}`, {
        ...init,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new ProviderUnavailableError(`No se pudo conectar con Factus: ${reason}`);
    }
  }

  async function accessToken(): Promise<string> {
    if (token !== null && token.expiresAt > Date.now()) return token.value;
    const response = await request('/oauth/token', {
      method: 'POST',
      headers: { Accept: 'application/json' },
      body: new URLSearchParams({
        grant_type: 'password',
        client_id: credentials.clientId,
        client_secret: credentials.clientSecret,
        username: credentials.username,
        password: credentials.password,
      }),
    });
    const body: unknown = await response.json().catch(() => null);
    if (response.status === 400 || response.status === 401) {
      throw new ProviderRejectedError(
        'Factus rechazó las credenciales: revisa las variables FACTUS_* en el servidor',
      );
    }
    const value = asString(asObject(body)?.access_token);
    if (!response.ok || value === null) {
      throw new ProviderUnavailableError(`Factus no entregó el token (${String(response.status)})`);
    }
    const expiresIn = asObject(body)?.expires_in;
    const seconds = typeof expiresIn === 'number' && expiresIn > 0 ? expiresIn : 600;
    token = { value, expiresAt: Date.now() + seconds * 1_000 - TOKEN_MARGIN_MS };
    return value;
  }

  async function authorized(path: string, init: RequestInit): Promise<Response> {
    const send = async (): Promise<Response> =>
      request(path, {
        ...init,
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Authorization: `Bearer ${await accessToken()}`,
        },
      });
    const response = await send();
    if (response.status !== 401) return response;
    token = null; // Token vencido o revocado: se pide uno nuevo una sola vez.
    return send();
  }

  /** Busca un documento ya emitido con el mismo reference_code (tras un conflicto). */
  async function findExisting(draft: DocumentDraft): Promise<IssueResult | null> {
    const collection = draft.kind === 'INVOICE' ? 'bills' : 'credit-notes';
    const query = new URLSearchParams({ 'filter[reference_code]': draft.referenceCode });
    const response = await authorized(`/v2/${collection}?${query.toString()}`, { method: 'GET' });
    if (!response.ok) return null;
    const body = asObject(await response.json().catch(() => null));
    const page = asObject(body?.data);
    const items = Array.isArray(page?.data)
      ? page.data
      : Array.isArray(body?.data)
        ? body.data
        : [];
    for (const item of items as unknown[]) {
      const found = readDocument({ data: item });
      if (found !== null && asObject(item)?.reference_code === draft.referenceCode) return found;
    }
    return null;
  }

  return {
    name: 'FACTUS',
    environment: credentials.environment === 'production' ? 'PRODUCTION' : 'SANDBOX',
    async issue(issueRequest: IssueRequest): Promise<IssueResult> {
      const payload = buildFactusPayload(issueRequest);
      const path =
        issueRequest.draft.kind === 'INVOICE' ? '/v2/bills/validate' : '/v2/credit-notes/validate';
      const response = await authorized(path, { method: 'POST', body: JSON.stringify(payload) });
      const body: unknown = await response.json().catch(() => null);

      if (response.ok) {
        const result = readDocument(body);
        if (result === null) {
          throw new ProviderUnavailableError('Factus respondió sin número o sin CUFE');
        }
        return result;
      }
      if (response.status === 409) {
        // Mismo reference_code ya enviado (p. ej. se perdió la respuesta): se recupera.
        const existing = await findExisting(issueRequest.draft);
        if (existing !== null) return existing;
        throw new ProviderUnavailableError(readErrorMessage(body, response.status));
      }
      if (response.status === 429 || response.status >= 500) {
        throw new ProviderUnavailableError(readErrorMessage(body, response.status));
      }
      // 400, 401 (tras renovar el token), 402, 403, 404, 422: hay que corregir algo.
      throw new ProviderRejectedError(readErrorMessage(body, response.status));
    },
  };
}
