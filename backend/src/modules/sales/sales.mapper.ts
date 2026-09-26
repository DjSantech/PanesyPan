import type { Sale, SaleEInvoice, SalePerson } from '@panesypan/shared';
import type { PersonRef, SaleDocument, SaleEInvoiceAttrs } from './sale.model';

const toPerson = (person: PersonRef): SalePerson => ({
  id: person.id.toString(),
  name: person.name,
});

export function toSaleDto(sale: SaleDocument): Sale {
  return {
    id: sale.id,
    number: sale.number,
    type: sale.type,
    tableNumber: sale.tableNumber,
    status: sale.status,
    lines: sale.lines.map((line) => ({
      id: line._id.toString(),
      productId: line.productId.toString(),
      name: line.name,
      unitPrice: line.unitPrice,
      quantity: line.quantity,
      note: line.note,
      total: line.total,
      isLunch: line.isLunch,
      lunch:
        line.lunch === null
          ? null
          : { protein: line.lunch.protein, principle: line.lunch.principle, soup: line.lunch.soup },
    })),
    subtotal: sale.subtotal,
    discount:
      sale.discount === null
        ? null
        : {
            mode: sale.discount.mode,
            value: sale.discount.value,
            amount: sale.discount.amount,
            reason: sale.discount.reason,
            approvedBy:
              sale.discount.approvedBy === null ? null : toPerson(sale.discount.approvedBy),
          },
    total: sale.total,
    payments: sale.payments.map((payment) => ({
      method: payment.method,
      amount: payment.amount,
      reference: payment.reference,
    })),
    cashReceived: sale.cashReceived,
    change: sale.change,
    shiftId: sale.shiftId?.toString() ?? null,
    openedBy: toPerson(sale.openedBy),
    paidBy: sale.paidBy === null ? null : toPerson(sale.paidBy),
    openedAt: sale.openedAt.toISOString(),
    paidAt: sale.paidAt?.toISOString() ?? null,
    businessDate: sale.businessDate,
    closure:
      sale.closure === null
        ? null
        : {
            at: sale.closure.at.toISOString(),
            by: toPerson(sale.closure.by),
            approvedBy: sale.closure.approvedBy === null ? null : toPerson(sale.closure.approvedBy),
            reason: sale.closure.reason,
          },
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
    einvoice: toSaleEInvoiceDto(sale.einvoice ?? null),
    updatedAt: sale.updatedAt.toISOString(),
  };
}

function toSaleEInvoiceDto(einvoice: SaleEInvoiceAttrs | null): SaleEInvoice | null {
  if (einvoice === null) return null;
  return {
    status: einvoice.status,
    environment: einvoice.environment,
    number: einvoice.number,
    cufe: einvoice.cufe,
    qrData: einvoice.qrData,
    publicUrl: einvoice.publicUrl,
    validatedAt: einvoice.validatedAt?.toISOString() ?? null,
    message: einvoice.message,
    creditNote:
      einvoice.creditNote === null
        ? null
        : { status: einvoice.creditNote.status, number: einvoice.creditNote.number },
  };
}
