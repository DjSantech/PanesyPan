/**
 * Impuestos de los productos para la facturación electrónica. Los precios del catálogo ya
 * incluyen el impuesto; la factura necesita la base y el impuesto por separado.
 * Qué tarifa lleva cada producto lo define el contador del negocio.
 */
export const TAX_CODES = ['IVA_19', 'IVA_5', 'IVA_0', 'INC_8', 'NONE'] as const;
export type TaxCode = (typeof TAX_CODES)[number];

export const TAX_CODE_LABELS: Readonly<Record<TaxCode, string>> = {
  IVA_19: 'IVA 19 %',
  IVA_5: 'IVA 5 %',
  IVA_0: 'IVA 0 % (exento)',
  INC_8: 'Impuesto al consumo 8 %',
  NONE: 'Sin impuesto (excluido o no responsable)',
};

export type TaxKind = 'IVA' | 'INC' | 'NONE';

export interface TaxDefinition {
  kind: TaxKind;
  /** Tarifa en porcentaje (19 = 19 %). */
  rate: number;
}

export const TAX_DEFINITIONS: Readonly<Record<TaxCode, TaxDefinition>> = {
  IVA_19: { kind: 'IVA', rate: 19 },
  IVA_5: { kind: 'IVA', rate: 5 },
  IVA_0: { kind: 'IVA', rate: 0 },
  INC_8: { kind: 'INC', rate: 8 },
  NONE: { kind: 'NONE', rate: 0 },
};

export interface TaxSplit {
  /** Valor sin impuesto, con centavos. */
  base: number;
  /** Impuesto, con centavos. */
  tax: number;
}

/**
 * Separa un valor con impuesto incluido en base e impuesto, redondeando a centavos.
 * Se calcula en centavos enteros: base + impuesto siempre suman exactamente el valor original.
 */
export function splitTaxIncluded(gross: number, ratePercent: number): TaxSplit {
  const grossCents = Math.round(gross * 100);
  const baseCents = Math.round((grossCents * 100) / (100 + ratePercent));
  return { base: baseCents / 100, tax: (grossCents - baseCents) / 100 };
}

/**
 * Reparte un descuento en pesos entre varias líneas, en proporción a su valor
 * (método del mayor residuo): la suma de las partes es exactamente el descuento.
 */
export function allocateDiscount(amounts: readonly number[], discount: number): number[] {
  const total = amounts.reduce((sum, amount) => sum + amount, 0);
  if (discount <= 0 || total <= 0) return amounts.map(() => 0);
  if (discount >= total) return [...amounts];

  const exact = amounts.map((amount) => (amount * discount) / total);
  const parts = exact.map((value) => Math.floor(value));
  let remainder = discount - parts.reduce((sum, part) => sum + part, 0);
  const byResidue = exact
    .map((value, index) => ({ index, residue: value - Math.floor(value) }))
    .sort((a, b) => b.residue - a.residue || a.index - b.index);
  for (const { index } of byResidue) {
    if (remainder === 0) break;
    parts[index] = (parts[index] ?? 0) + 1;
    remainder -= 1;
  }
  return parts;
}
