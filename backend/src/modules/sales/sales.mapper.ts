import type { Sale, SalePerson } from '@panesypan/shared';
import type { PersonRef, SaleDocument } from './sale.model';

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
    updatedAt: sale.updatedAt.toISOString(),
  };
}
