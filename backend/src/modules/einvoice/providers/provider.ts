import type { EInvoiceEnvironment, EInvoiceProvider } from '@panesypan/shared';
import type { DocumentDraft } from '../draft';

/** Documento que se corrige (la factura original, para una nota crédito). */
export interface RelatedDocument {
  number: string;
  cufe: string;
}

export interface IssueRequest {
  draft: DocumentDraft;
  related: RelatedDocument | null;
}

/** Lo que devuelve el proveedor cuando la DIAN valida el documento. */
export interface IssueResult {
  number: string;
  /** CUFE (factura) o CUDE (nota crédito). */
  cufe: string;
  qrData: string | null;
  publicUrl: string | null;
  validatedAt: Date;
  providerId: string | null;
}

export interface EInvoiceProviderClient {
  readonly name: EInvoiceProvider;
  readonly environment: EInvoiceEnvironment;
  issue(request: IssueRequest): Promise<IssueResult>;
}

/**
 * El proveedor o la DIAN rechazaron el documento (datos inválidos, rango vencido, cuenta sin
 * saldo…). Reintentar igual no sirve: alguien debe corregir la causa y reenviarlo.
 */
export class ProviderRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProviderRejectedError';
  }
}

/** Falla temporal (sin red, proveedor caído, límite de peticiones): se reintenta solo. */
export class ProviderUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProviderUnavailableError';
  }
}
