import {
  EINVOICE_ENVIRONMENT_LABELS,
  EINVOICE_PROVIDER_LABELS,
  EINVOICE_PROVIDERS,
  TAX_CODE_LABELS,
  TAX_CODES,
  updateBusinessSettingsRequestSchema,
  type BusinessSettings,
  type EInvoiceProvider,
  type TaxCode,
  type UpdateBusinessSettingsRequest,
} from '@panesypan/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { FileText, Save } from 'lucide-react';
import { useState, type SubmitEvent } from 'react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { Spinner } from '@/components/feedback';
import { Button } from '@/components/ui/button';
import { fieldAria } from '@/components/ui/field-aria';
import { Field, Input, NativeSelect, Textarea } from '@/components/ui/form';
import {
  Alert,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/surface';
import { CheckboxField, Switch } from '@/components/ui/toggles';
import { errorMessage } from '@/lib/api-errors';
import { SETTINGS_QUERY_KEY, updateSettings } from '../settings/settings.api';
import { einvoiceKeys, useEInvoiceStatus } from './einvoice.api';

type EInvoiceField =
  | 'einvoiceEnabled'
  | 'einvoiceProvider'
  | 'einvoiceNumberingRangeId'
  | 'einvoiceCreditNoteRangeId'
  | 'einvoiceSendEmail'
  | 'einvoiceLegend'
  | 'defaultTax';

const FIELDS: readonly EInvoiceField[] = [
  'einvoiceEnabled',
  'einvoiceProvider',
  'einvoiceNumberingRangeId',
  'einvoiceCreditNoteRangeId',
  'einvoiceSendEmail',
  'einvoiceLegend',
  'defaultTax',
];

const LEGEND_EXAMPLE =
  'Resolución DIAN N.º 18764000000000 del 2026-01-15, prefijo PAN del 1 al 5000, vigencia 24 meses. Software: Factus, proveedor tecnológico autorizado.';

const toRangeText = (value: number | null): string => (value === null ? '' : String(value));
const fromRangeText = (text: string): number | null =>
  text.trim() === '' ? null : Number(text.trim());

/** Configuración de la facturación electrónica (sección de Ajustes, solo administrador). */
export function EInvoiceSettingsCard({ settings }: { settings: BusinessSettings }) {
  const queryClient = useQueryClient();
  const status = useEInvoiceStatus();
  const [enabled, setEnabled] = useState(settings.einvoiceEnabled);
  const [provider, setProvider] = useState<EInvoiceProvider>(settings.einvoiceProvider);
  const [defaultTax, setDefaultTax] = useState<TaxCode | null>(settings.defaultTax);
  const [invoiceRange, setInvoiceRange] = useState(toRangeText(settings.einvoiceNumberingRangeId));
  const [noteRange, setNoteRange] = useState(toRangeText(settings.einvoiceCreditNoteRangeId));
  const [sendEmail, setSendEmail] = useState(settings.einvoiceSendEmail);
  const [legend, setLegend] = useState(settings.einvoiceLegend);
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: updateSettings,
    onSuccess: (saved) => {
      queryClient.setQueryData(SETTINGS_QUERY_KEY, saved);
      void queryClient.invalidateQueries({ queryKey: einvoiceKeys.all });
      toast.success('Facturación electrónica guardada');
    },
  });

  const available = status.data?.availableProviders ?? ['SIMULATED'];
  const isReal = provider !== 'SIMULATED';

  const handleSubmit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    const candidate = {
      einvoiceEnabled: enabled,
      einvoiceProvider: provider,
      einvoiceNumberingRangeId: fromRangeText(invoiceRange),
      einvoiceCreditNoteRangeId: fromRangeText(noteRange),
      einvoiceSendEmail: sendEmail,
      einvoiceLegend: legend,
      defaultTax,
    };
    const parsed = updateBusinessSettingsRequestSchema.safeParse(candidate);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Revisa los datos');
      return;
    }
    setError(null);
    const changes = Object.fromEntries(
      FIELDS.flatMap((field) =>
        parsed.data[field] === undefined || parsed.data[field] === settings[field]
          ? []
          : [[field, parsed.data[field]]],
      ),
    ) as UpdateBusinessSettingsRequest;
    if (Object.keys(changes).length === 0) {
      toast.info('No hay cambios para guardar');
      return;
    }
    save.mutate(changes);
  };

  const attention = (status.data?.counts.REJECTED ?? 0) + (status.data?.counts.FAILED ?? 0);

  return (
    <form onSubmit={handleSubmit} noValidate>
      <Card>
        <CardHeader>
          <CardTitle>Facturación electrónica</CardTitle>
          <CardDescription>
            Cada venta cobrada genera su factura electrónica ante la DIAN, a nombre de
            &quot;Consumidor final&quot; o del cliente que la pida. Al anular una venta facturada se
            emite la nota crédito.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="flex items-center justify-between gap-3 rounded-xl border border-border px-3.5 py-3 sm:col-span-2">
            <span className="grid gap-0.5">
              <span className="text-sm font-bold">Facturar electrónicamente cada venta</span>
              {status.data === undefined ? null : (
                <span className="text-sm text-muted-foreground">
                  Ambiente: {EINVOICE_ENVIRONMENT_LABELS[status.data.environment]}
                </span>
              )}
            </span>
            <Switch
              checked={enabled}
              onCheckedChange={setEnabled}
              label="Facturar electrónicamente cada venta"
            />
          </div>

          <Field
            id="einvoice-provider"
            label="Proveedor tecnológico"
            hint={
              available.includes('FACTUS')
                ? undefined
                : 'Factus aparece cuando el servidor tiene sus credenciales (ver README).'
            }
          >
            <NativeSelect
              {...fieldAria('einvoice-provider', null, !available.includes('FACTUS'))}
              value={provider}
              onChange={(event) => {
                setProvider(event.target.value as EInvoiceProvider);
              }}
            >
              {EINVOICE_PROVIDERS.map((item) => (
                <option key={item} value={item} disabled={!available.includes(item)}>
                  {EINVOICE_PROVIDER_LABELS[item]}
                </option>
              ))}
            </NativeSelect>
          </Field>

          <Field
            id="einvoice-tax"
            label="Impuesto general de los productos"
            hint="Lo define el contador. Cada producto puede tener el suyo en el catálogo."
          >
            <NativeSelect
              {...fieldAria('einvoice-tax', null, true)}
              value={defaultTax ?? ''}
              onChange={(event) => {
                setDefaultTax(event.target.value === '' ? null : (event.target.value as TaxCode));
              }}
            >
              <option value="">Sin definir</option>
              {TAX_CODES.map((code) => (
                <option key={code} value={code}>
                  {TAX_CODE_LABELS[code]}
                </option>
              ))}
            </NativeSelect>
          </Field>

          {isReal ? (
            <>
              <Field
                id="einvoice-range"
                label="Rango de numeración de facturas"
                hint="El número de rango que muestra el proveedor para la resolución de la DIAN."
              >
                <Input
                  {...fieldAria('einvoice-range', null, true)}
                  inputMode="numeric"
                  value={invoiceRange}
                  onChange={(event) => {
                    setInvoiceRange(event.target.value.replace(/\D/g, '').slice(0, 9));
                  }}
                />
              </Field>
              <Field
                id="einvoice-note-range"
                label="Rango de numeración de notas crédito"
                hint="Se usa al anular una venta ya facturada."
              >
                <Input
                  {...fieldAria('einvoice-note-range', null, true)}
                  inputMode="numeric"
                  value={noteRange}
                  onChange={(event) => {
                    setNoteRange(event.target.value.replace(/\D/g, '').slice(0, 9));
                  }}
                />
              </Field>
            </>
          ) : (
            <Alert tone="pending" className="sm:col-span-2">
              El proveedor simulado sirve para conocer el flujo: sus facturas NO tienen validez ante
              la DIAN y el tiquete lo dice.
            </Alert>
          )}

          <Field
            id="einvoice-legend"
            label="Texto legal de la factura impresa"
            hint={`Resolución de numeración y proveedor. Ejemplo: ${LEGEND_EXAMPLE}`}
            className="sm:col-span-2"
          >
            <Textarea
              {...fieldAria('einvoice-legend', null, true)}
              maxLength={400}
              value={legend}
              onChange={(event) => {
                setLegend(event.target.value);
              }}
            />
          </Field>

          <div className="sm:col-span-2">
            <CheckboxField
              id="einvoice-email"
              label="Enviar la factura al correo del cliente"
              description="Solo cuando el cliente da su correo al pedir la factura a su nombre."
              checked={sendEmail}
              onCheckedChange={setSendEmail}
            />
          </div>

          {attention > 0 ? (
            <Alert tone="danger" className="sm:col-span-2">
              <FileText aria-hidden="true" />
              <span>
                Hay {String(attention)}{' '}
                {attention === 1 ? 'documento que necesita' : 'documentos que necesitan'} revisión.{' '}
                <Link to="/facturacion" className="font-bold underline">
                  Ver facturación
                </Link>
              </span>
            </Alert>
          ) : null}

          {error === null && !save.isError ? null : (
            <Alert tone="danger" className="sm:col-span-2">
              {error ?? errorMessage(save.error)}
            </Alert>
          )}
          <Button
            type="submit"
            size="lg"
            className="justify-self-start sm:col-span-2"
            disabled={save.isPending}
          >
            {save.isPending ? <Spinner /> : <Save aria-hidden="true" />} Guardar facturación
          </Button>
        </CardContent>
      </Card>
    </form>
  );
}
