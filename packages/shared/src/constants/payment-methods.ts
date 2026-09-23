export const PAYMENT_METHODS = [
  'CASH',
  'NEQUI',
  'DAVIPLATA',
  'DEBIT_CARD',
  'CREDIT_CARD',
  'BANK_TRANSFER',
] as const;

export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const PAYMENT_METHOD_LABELS: Readonly<Record<PaymentMethod, string>> = {
  CASH: 'Efectivo',
  NEQUI: 'Nequi',
  DAVIPLATA: 'Daviplata',
  DEBIT_CARD: 'Tarjeta débito',
  CREDIT_CARD: 'Tarjeta crédito',
  BANK_TRANSFER: 'Transferencia',
};
