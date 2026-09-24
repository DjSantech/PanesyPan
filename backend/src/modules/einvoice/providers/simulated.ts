import { createHash } from 'node:crypto';
import type { EInvoiceProviderClient, IssueRequest, IssueResult } from './provider';
import { ProviderRejectedError } from './provider';

/**
 * Proveedor simulado: responde como si la DIAN hubiera validado el documento, sin enviar nada.
 * Sirve para desarrollo, pruebas y para conocer el flujo antes de contratar el proveedor real.
 * Sus documentos NO tienen validez tributaria (el tiquete lo dice).
 */
export function createSimulatedProvider(): EInvoiceProviderClient {
  return {
    name: 'SIMULATED',
    environment: 'SIMULATED',
    issue({ draft, related }: IssueRequest): Promise<IssueResult> {
      if (draft.lines.length === 0 || draft.total <= 0) {
        return Promise.reject(new ProviderRejectedError('El documento no tiene productos'));
      }
      if (draft.kind === 'CREDIT_NOTE' && related === null) {
        return Promise.reject(new ProviderRejectedError('La nota crédito no tiene factura'));
      }
      const prefix = draft.kind === 'INVOICE' ? 'SIMU' : 'SIMUNC';
      const number = `${prefix}${String(draft.saleNumber)}`;
      const cufe = createHash('sha384').update(draft.referenceCode).digest('hex');
      return Promise.resolve({
        number,
        cufe,
        qrData: `DOCUMENTO SIMULADO SIN VALIDEZ ANTE LA DIAN · ${number}`,
        publicUrl: null,
        validatedAt: new Date(),
        providerId: null,
      });
    },
  };
}
