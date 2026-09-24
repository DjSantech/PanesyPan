import {
  BUYER_ID_TYPE_LABELS,
  BUYER_ID_TYPES,
  nitCheckDigit,
  onlyDigits,
  type BuyerIdType,
} from '@panesypan/shared';
import { Field, Input, NativeSelect } from '@/components/ui/form';
import type { CustomerDraft } from './einvoice-logic';

/**
 * Datos del cliente que pide la factura electrónica a su nombre. El dígito de verificación
 * del NIT se calcula solo y se muestra para confirmarlo con el cliente.
 */
export function CustomerFields({
  value,
  onChange,
  error,
}: {
  value: CustomerDraft;
  onChange: (value: CustomerDraft) => void;
  error: string | null;
}) {
  const checkDigit = value.idType === 'NIT' ? nitCheckDigit(onlyDigits(value.idNumber)) : null;

  return (
    <fieldset className="grid gap-3 rounded-2xl border border-border p-3.5 sm:grid-cols-2">
      <legend className="px-1 text-sm font-bold">Factura a nombre del cliente</legend>
      <Field id="customer-id-type" label="Tipo de documento">
        <NativeSelect
          id="customer-id-type"
          value={value.idType}
          onChange={(event) => {
            onChange({ ...value, idType: event.target.value as BuyerIdType });
          }}
        >
          {BUYER_ID_TYPES.map((type) => (
            <option key={type} value={type}>
              {BUYER_ID_TYPE_LABELS[type]}
            </option>
          ))}
        </NativeSelect>
      </Field>
      <Field
        id="customer-id-number"
        label="Número"
        hint={
          checkDigit === null || value.idNumber === ''
            ? undefined
            : `Dígito de verificación: ${String(checkDigit)}`
        }
      >
        <Input
          id="customer-id-number"
          inputMode="numeric"
          autoComplete="off"
          value={value.idNumber}
          aria-describedby={checkDigit === null ? undefined : 'customer-id-number-hint'}
          onChange={(event) => {
            onChange({ ...value, idNumber: event.target.value.replace(/[^\d.\-\s]/g, '') });
          }}
        />
      </Field>
      <Field id="customer-name" label="Nombre o razón social" className="sm:col-span-2">
        <Input
          id="customer-name"
          autoComplete="off"
          value={value.name}
          onChange={(event) => {
            onChange({ ...value, name: event.target.value });
          }}
        />
      </Field>
      <Field
        id="customer-email"
        label="Correo (opcional)"
        hint="Si lo escribe, le llega la factura al correo."
        className="sm:col-span-2"
      >
        <Input
          id="customer-email"
          type="email"
          inputMode="email"
          autoComplete="off"
          aria-describedby="customer-email-hint"
          value={value.email}
          onChange={(event) => {
            onChange({ ...value, email: event.target.value });
          }}
        />
      </Field>
      {error === null ? null : (
        <p className="text-sm font-semibold text-danger sm:col-span-2" role="alert">
          {error}
        </p>
      )}
    </fieldset>
  );
}
