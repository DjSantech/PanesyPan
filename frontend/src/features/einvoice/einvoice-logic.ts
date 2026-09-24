import {
  customerInputSchema,
  type BuyerIdType,
  type CustomerInput,
  type EInvoiceStatus,
} from '@panesypan/shared';

/** La factura todavía puede cambiar de estado sola (el servidor la está enviando). */
export const isEInvoiceInFlight = (status: EInvoiceStatus | undefined): boolean =>
  status === 'PENDING' || status === 'SENDING';

export interface CustomerDraft {
  idType: BuyerIdType;
  idNumber: string;
  name: string;
  email: string;
}

export const EMPTY_CUSTOMER: CustomerDraft = { idType: 'CC', idNumber: '', name: '', email: '' };

/** Valida los datos del cliente: devuelve lo que se envía a la API o el primer error. */
export function parseCustomer(
  draft: CustomerDraft,
): { ok: true; value: CustomerInput } | { ok: false; message: string } {
  const result = customerInputSchema.safeParse({
    idType: draft.idType,
    idNumber: draft.idNumber,
    name: draft.name,
    email: draft.email.trim(),
  });
  if (result.success) return { ok: true, value: result.data };
  return { ok: false, message: result.error.issues[0]?.message ?? 'Revisa los datos del cliente' };
}
