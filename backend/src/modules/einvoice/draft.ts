import {
  allocateDiscount,
  type BusinessSettings,
  type BuyerIdType,
  type EInvoiceKind,
  type PaymentMethod,
  type TaxCode,
} from '@panesypan/shared';
import type { SaleDocument } from '../sales/sale.model';

/**
 * Borrador de un documento electrónico, independiente del proveedor. Se arma al cobrar (o al
 * anular) y se guarda tal cual: aunque después cambien precios o impuestos del catálogo, lo que
 * se envía a la DIAN es lo que se vendió.
 */
export interface DraftCustomer {
  idType: BuyerIdType;
  idNumber: string;
  checkDigit: number | null;
  name: string;
  email: string;
}

export interface DraftLine {
  /** Código interno del producto. */
  code: string;
  name: string;
  quantity: number;
  /** Precio unitario con impuesto incluido, en pesos. */
  unitPrice: number;
  /** unitPrice × quantity, antes del descuento. */
  gross: number;
  /** Parte del descuento de la venta que le toca a esta línea, en pesos. */
  discount: number;
  tax: TaxCode;
}

export interface DraftPayment {
  method: PaymentMethod;
  amount: number;
}

export interface DocumentDraft {
  kind: EInvoiceKind;
  /** Identificador único ante el proveedor: evita emitir dos veces el mismo documento. */
  referenceCode: string;
  saleNumber: number;
  issuedAt: string;
  /** null = consumidor final. */
  customer: DraftCustomer | null;
  lines: DraftLine[];
  /** Total cobrado en pesos (con impuestos y descuento). */
  total: number;
  payments: DraftPayment[];
  observation: string;
  sendEmail: boolean;
  numberingRangeId: number | null;
}

export const invoiceReference = (saleId: string): string => `V-${saleId}`;
export const creditNoteReference = (saleId: string): string => `NC-${saleId}`;

/**
 * Arma el borrador a partir de la venta. El impuesto de cada línea es el del producto o, si no
 * tiene, el impuesto general de Ajustes. El descuento de la venta se reparte entre las líneas.
 */
export function buildDraft(
  kind: EInvoiceKind,
  sale: SaleDocument,
  taxByProduct: ReadonlyMap<string, TaxCode | null>,
  settings: BusinessSettings,
  observation: string,
): DocumentDraft {
  if (sale.number === null) throw new Error('La venta aún no tiene número');
  const grosses = sale.lines.map((line) => line.total);
  const discounts = allocateDiscount(grosses, sale.discount?.amount ?? 0);
  return {
    kind,
    referenceCode: kind === 'INVOICE' ? invoiceReference(sale.id) : creditNoteReference(sale.id),
    saleNumber: sale.number,
    issuedAt: new Date().toISOString(),
    customer:
      sale.customer === null
        ? null
        : {
            idType: sale.customer.idType,
            idNumber: sale.customer.idNumber,
            checkDigit: sale.customer.checkDigit,
            name: sale.customer.name,
            email: sale.customer.email,
          },
    lines: sale.lines.map((line, index) => ({
      code: line.productId.toString(),
      name: line.note === '' ? line.name : `${line.name} (${line.note})`,
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      gross: line.total,
      discount: discounts[index] ?? 0,
      tax: taxByProduct.get(line.productId.toString()) ?? settings.defaultTax ?? 'NONE',
    })),
    total: sale.total,
    payments: sale.payments.map((payment) => ({ method: payment.method, amount: payment.amount })),
    observation,
    sendEmail: settings.einvoiceSendEmail && (sale.customer?.email ?? '') !== '',
    numberingRangeId:
      kind === 'INVOICE' ? settings.einvoiceNumberingRangeId : settings.einvoiceCreditNoteRangeId,
  };
}
