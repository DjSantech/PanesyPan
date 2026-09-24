import { describe, expect, it } from 'vitest';
import type { DocumentDraft } from '../draft';
import {
  buildFactusPayload,
  createFactusProvider,
  readErrorMessage,
  type FetchLike,
} from './factus';
import { ProviderRejectedError, ProviderUnavailableError } from './provider';

const credentials = {
  environment: 'sandbox',
  clientId: 'cliente',
  clientSecret: 'secreto',
  username: 'panaderia@example.com',
  password: 'clave',
} as const;

const draft: DocumentDraft = {
  kind: 'INVOICE',
  referenceCode: 'V-64b000000000000000000001',
  saleNumber: 12,
  issuedAt: '2026-09-24T15:00:00.000Z',
  customer: null,
  lines: [
    {
      code: 'p1',
      name: 'Pan de bono',
      quantity: 2,
      unitPrice: 2_000,
      gross: 4_000,
      discount: 0,
      tax: 'INC_8',
    },
    {
      code: 'p2',
      name: 'Café',
      quantity: 1,
      unitPrice: 3_000,
      gross: 3_000,
      discount: 0,
      tax: 'IVA_19',
    },
  ],
  total: 7_000,
  payments: [
    { method: 'CASH', amount: 5_000 },
    { method: 'NEQUI', amount: 2_000 },
  ],
  observation: 'Venta N.º 12',
  sendEmail: false,
  numberingRangeId: 8,
};

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const validated = (): Response =>
  json(201, {
    status: 'Created',
    data: {
      bill: {
        id: 55,
        number: 'SETP990000012',
        reference_code: draft.referenceCode,
        cufe: 'a'.repeat(96),
        qr: 'https://catalogo-vpfe-hab.dian.gov.co/document/searchqr?documentkey=aaa',
        public_url: 'https://factus.com.co/f/abc',
        validated: '2026-09-24T15:00:05Z',
      },
    },
  });

interface Call {
  url: string;
  init: RequestInit | undefined;
}

/** fetch de mentira: responde en orden y guarda cada llamada. */
function fakeFetch(responses: (Response | Error)[]): { fetch: FetchLike; calls: Call[] } {
  const calls: Call[] = [];
  const queue = [...responses];
  return {
    calls,
    fetch: (url, init) => {
      calls.push({ url, init });
      const next = queue.shift();
      if (next === undefined) return Promise.reject(new Error('Llamada inesperada'));
      return next instanceof Error ? Promise.reject(next) : Promise.resolve(next);
    },
  };
}

const token = (value = 'tok-1') =>
  json(200, { token_type: 'Bearer', access_token: value, refresh_token: 'r', expires_in: 3600 });

describe('payload de Factus', () => {
  it('separa el impuesto del precio y cuadra con lo cobrado', () => {
    const payload = buildFactusPayload({ draft, related: null });
    expect(payload).toMatchObject({
      reference_code: draft.referenceCode,
      numbering_range_id: 8,
      document: '01',
      operation_type: '10',
      cash_rounding_amount: '0.00',
      customer: {
        identification_document_code: '13',
        identification: '222222222222',
        names: 'Consumidor final',
      },
      payment_details: [
        { payment_method_code: '10', amount: '5000.00' },
        { payment_method_code: '47', amount: '2000.00' },
      ],
      items: [
        {
          code_reference: 'p1',
          quantity: '2.00',
          price: '1851.85',
          taxes: [{ code: '04', rate: '8.00' }],
        },
        { code_reference: 'p2', price: '2521.01', taxes: [{ code: '01', rate: '19.00' }] },
      ],
    });
  });

  it('reparte el descuento como porcentaje por línea y ajusta los centavos', () => {
    const payload = buildFactusPayload({
      draft: {
        ...draft,
        lines: [
          { ...draft.lines[0]!, discount: 571 },
          { ...draft.lines[1]!, discount: 429 },
        ],
        total: 6_000,
        payments: [{ method: 'CASH', amount: 6_000 }],
      },
      related: null,
    });
    const items = payload.items as { discount_rate: string }[];
    expect(items.map((item) => item.discount_rate)).toEqual(['14.28', '14.30']);
    expect(Math.abs(Number(payload.cash_rounding_amount))).toBeLessThan(1);
  });

  it('productos sin impuesto van como excluidos', () => {
    const payload = buildFactusPayload({
      draft: { ...draft, lines: [{ ...draft.lines[0]!, tax: 'NONE' }], total: 4_000 },
      related: null,
    });
    expect((payload.items as object[])[0]).toMatchObject({
      price: '2000.00',
      is_excluded: 1,
      taxes: [],
    });
  });

  it('un NIT va como empresa con su dígito de verificación', () => {
    const payload = buildFactusPayload({
      draft: {
        ...draft,
        customer: {
          idType: 'NIT',
          idNumber: '900123456',
          checkDigit: null,
          name: 'Cafetería La Esquina',
          email: 'compras@laesquina.co',
        },
      },
      related: null,
    });
    expect(payload.customer).toEqual({
      identification_document_code: '31',
      identification: '900123456',
      dv: '8',
      company: 'Cafetería La Esquina',
      legal_organization_code: '1',
      tribute_code: 'ZZ',
      country_code: 'CO',
      email: 'compras@laesquina.co',
    });
  });

  it('la nota crédito anula la factura indicada', () => {
    const payload = buildFactusPayload({
      draft: { ...draft, kind: 'CREDIT_NOTE', referenceCode: 'NC-1', numberingRangeId: 9 },
      related: { number: 'SETP990000012', cufe: 'a'.repeat(96) },
    });
    expect(payload).toMatchObject({
      reference_code: 'NC-1',
      numbering_range_id: 9,
      correction_concept_code: '2',
      customization_id: '20',
      bill_number: 'SETP990000012',
    });
    expect(payload.document).toBeUndefined();
  });
});

describe('cliente de Factus', () => {
  it('pide el token una vez, envía la factura y lee el CUFE', async () => {
    const { fetch, calls } = fakeFetch([token(), validated(), validated()]);
    const factus = createFactusProvider(credentials, fetch);

    const result = await factus.issue({ draft, related: null });
    expect(result).toMatchObject({
      number: 'SETP990000012',
      cufe: 'a'.repeat(96),
      publicUrl: 'https://factus.com.co/f/abc',
      providerId: '55',
    });
    await factus.issue({ draft, related: null });

    expect(calls.map((call) => call.url)).toEqual([
      'https://api-sandbox.factus.com.co/oauth/token',
      'https://api-sandbox.factus.com.co/v2/bills/validate',
      'https://api-sandbox.factus.com.co/v2/bills/validate',
    ]);
    const tokenBody = calls[0]?.init?.body;
    if (!(tokenBody instanceof URLSearchParams))
      throw new Error('El token se pide como formulario');
    expect(tokenBody.get('grant_type')).toBe('password');
    expect(tokenBody.get('client_id')).toBe('cliente');
    expect(new Headers(calls[1]?.init?.headers).get('Authorization')).toBe('Bearer tok-1');
  });

  it('si el token venció, pide otro y reintenta una sola vez', async () => {
    const { fetch, calls } = fakeFetch([
      token('viejo'),
      json(401, {}),
      token('nuevo'),
      validated(),
    ]);
    const factus = createFactusProvider(credentials, fetch);
    await factus.issue({ draft, related: null });
    expect(new Headers(calls[3]?.init?.headers).get('Authorization')).toBe('Bearer nuevo');
  });

  it('credenciales malas: rechazo (hay que corregir el servidor)', async () => {
    const { fetch } = fakeFetch([json(401, { error: 'invalid_client' })]);
    await expect(
      createFactusProvider(credentials, fetch).issue({ draft, related: null }),
    ).rejects.toThrow(ProviderRejectedError);
  });

  it('errores de validación: rechazo con los mensajes de Factus', async () => {
    const { fetch } = fakeFetch([
      token(),
      json(422, {
        message: 'Error de validación',
        data: { errors: { numbering_range_id: ['El rango de numeración no está activo'] } },
      }),
    ]);
    await expect(
      createFactusProvider(credentials, fetch).issue({ draft, related: null }),
    ).rejects.toThrow(
      'Error de validación · numbering_range_id: El rango de numeración no está activo',
    );
  });

  it('caídas, límites y falta de red se reintentan', async () => {
    const down = fakeFetch([token(), json(503, { message: 'Mantenimiento' })]);
    await expect(
      createFactusProvider(credentials, down.fetch).issue({ draft, related: null }),
    ).rejects.toThrow(ProviderUnavailableError);

    const offline = fakeFetch([new TypeError('fetch failed')]);
    await expect(
      createFactusProvider(credentials, offline.fetch).issue({ draft, related: null }),
    ).rejects.toThrow('No se pudo conectar con Factus');
  });

  it('un conflicto por reference_code repetido recupera la factura ya emitida', async () => {
    const existing = {
      id: 55,
      number: 'SETP990000012',
      reference_code: draft.referenceCode,
      cufe: 'b'.repeat(96),
    };
    const { fetch, calls } = fakeFetch([
      token(),
      json(409, { message: 'El código de referencia ya existe' }),
      json(200, { data: { data: [existing], pagination: { total: 1 } } }),
    ]);
    const result = await createFactusProvider(credentials, fetch).issue({ draft, related: null });
    expect(result).toMatchObject({ number: 'SETP990000012', cufe: 'b'.repeat(96) });
    expect(calls[2]?.url).toBe(
      `https://api-sandbox.factus.com.co/v2/bills?filter%5Breference_code%5D=${draft.referenceCode}`,
    );
  });

  it('los mensajes de error se acortan', () => {
    const long = readErrorMessage({ message: 'x'.repeat(2_000) }, 422);
    expect(long.length).toBe(500);
    expect(readErrorMessage(null, 500)).toBe('Factus respondió 500');
  });
});
