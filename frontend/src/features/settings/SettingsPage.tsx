import {
  SETTINGS_LIMITS,
  TICKET_WIDTHS,
  updateBusinessSettingsRequestSchema,
  type BusinessSettings,
  type Sale,
  type TicketWidth,
  type UpdateBusinessSettingsRequest,
} from '@panesypan/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Save } from 'lucide-react';
import { useState, type SubmitEvent } from 'react';
import { toast } from 'sonner';
import { ErrorState, PageHeader, Spinner } from '@/components/feedback';
import { Button } from '@/components/ui/button';
import { PriceInput } from '@/components/PriceInput';
import { fieldAria } from '@/components/ui/field-aria';
import { Field, Input } from '@/components/ui/form';
import {
  Alert,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Skeleton,
} from '@/components/ui/surface';
import { errorMessage } from '@/lib/api-errors';
import { cn } from '@/lib/utils';
import { EInvoiceSettingsCard } from '../einvoice/EInvoiceSettingsCard';
import { Receipt } from '../pos/Receipt';
import { SETTINGS_QUERY_KEY, updateSettings, useSettings } from './settings.api';

type TextField = 'legalName' | 'taxId' | 'address' | 'phone' | 'ticketFooter';
type Errors = Partial<
  Record<TextField | 'tableCount' | 'maxCashierDiscountPercent' | 'maxCashierExpense', string>
>;

const TEXT_FIELDS: { key: TextField; label: string; placeholder: string; hint?: string }[] = [
  {
    key: 'legalName',
    label: 'Razón social',
    placeholder: 'Ej.: Panes y Pan S.A.S.',
    hint: 'Vacío = solo el nombre comercial.',
  },
  { key: 'taxId', label: 'NIT', placeholder: 'Ej.: 900.123.456-7' },
  { key: 'address', label: 'Dirección', placeholder: 'Ej.: Cra. 16 # 20-30, Dosquebradas' },
  { key: 'phone', label: 'Teléfono', placeholder: 'Ej.: 310 000 0000' },
  {
    key: 'ticketFooter',
    label: 'Mensaje al pie del tiquete',
    placeholder: '¡Gracias por su compra!',
  },
];

/** Venta de ejemplo para la vista previa del tiquete. */
const SAMPLE_SALE: Sale = {
  id: 'ejemplo',
  number: 123,
  type: 'TABLE',
  tableNumber: 3,
  status: 'PAID',
  lines: [
    {
      id: 'l1',
      productId: 'p1',
      name: 'Pan de bono',
      unitPrice: 2_000,
      quantity: 3,
      note: '',
      total: 6_000,
      isLunch: false,
      lunch: null,
    },
    {
      id: 'l2',
      productId: 'p2',
      name: 'Almuerzo',
      unitPrice: 14_000,
      quantity: 1,
      note: 'Pollo asado · Fríjoles · Sancocho · Sin bebida',
      total: 14_000,
      isLunch: true,
      lunch: { protein: 'Pollo asado', principle: 'Fríjoles', soup: 'Sancocho', drink: null },
    },
  ],
  subtotal: 20_000,
  discount: null,
  total: 20_000,
  payments: [{ method: 'CASH', amount: 20_000, reference: '' }],
  cashReceived: 50_000,
  change: 30_000,
  shiftId: null,
  openedBy: { id: 'u1', name: 'Cajera' },
  paidBy: { id: 'u1', name: 'Cajera' },
  openedAt: new Date().toISOString(),
  paidAt: new Date().toISOString(),
  businessDate: null,
  closure: null,
  customer: null,
  einvoice: null,
  webOrderNumber: null,
  updatedAt: new Date().toISOString(),
};

/** Así se ve la factura electrónica validada en el tiquete de ejemplo. */
function sampleEInvoice(settings: BusinessSettings): Sale['einvoice'] {
  if (!settings.einvoiceEnabled) return null;
  return {
    status: 'ACCEPTED',
    environment: settings.einvoiceProvider === 'SIMULATED' ? 'SIMULATED' : 'PRODUCTION',
    number: 'PAN123',
    cufe: 'ejemplo0f3a9c1d7b2e4f6a8c0d2e4f6a8b0c2d4e6f8a0b2c4d6e8f0a2b4c6d8e0f2a4b6c8d0e2f4a6b8c0d2e4f6a8b',
    qrData: null,
    publicUrl: null,
    validatedAt: new Date().toISOString(),
    message: null,
    creditNote: null,
  };
}

function SettingsForm({ settings }: { settings: BusinessSettings }) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState(settings);
  const [tables, setTables] = useState(String(settings.tableCount));
  const [maxDiscount, setMaxDiscount] = useState(String(settings.maxCashierDiscountPercent));
  const [maxExpense, setMaxExpense] = useState<number | null>(settings.maxCashierExpense);
  const [errors, setErrors] = useState<Errors>({});

  const save = useMutation({
    mutationFn: updateSettings,
    onSuccess: (saved) => {
      queryClient.setQueryData(SETTINGS_QUERY_KEY, saved);
      toast.success('Configuración guardada');
    },
  });

  const handleSubmit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    const candidate = {
      ...Object.fromEntries(TEXT_FIELDS.map(({ key }) => [key, draft[key]])),
      ticketWidth: draft.ticketWidth,
      tableCount: tables.trim() === '' ? Number.NaN : Number(tables),
      maxCashierDiscountPercent: maxDiscount.trim() === '' ? Number.NaN : Number(maxDiscount),
      maxCashierExpense: maxExpense ?? Number.NaN,
    };
    const parsed = updateBusinessSettingsRequestSchema.safeParse(candidate);
    if (!parsed.success) {
      const next: Errors = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0] as keyof Errors | undefined;
        if (key !== undefined && next[key] === undefined) next[key] = issue.message;
      }
      setErrors(next);
      return;
    }
    setErrors({});
    const changes = Object.fromEntries(
      Object.entries(parsed.data).filter(
        ([key, value]) => value !== settings[key as keyof UpdateBusinessSettingsRequest],
      ),
    ) as UpdateBusinessSettingsRequest;
    if (Object.keys(changes).length === 0) {
      toast.info('No hay cambios para guardar');
      return;
    }
    save.mutate(changes);
  };

  const preview: BusinessSettings = { ...draft };

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <form className="grid content-start gap-5" onSubmit={handleSubmit} noValidate>
        <Card>
          <CardHeader>
            <CardTitle>Datos del tiquete</CardTitle>
            <CardDescription>
              Aparecen en el encabezado y el pie del tiquete impreso.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            {TEXT_FIELDS.map((field) => (
              <Field
                key={field.key}
                id={`settings-${field.key}`}
                label={field.label}
                error={errors[field.key]}
                hint={field.hint}
                className={
                  field.key === 'ticketFooter' || field.key === 'address'
                    ? 'sm:col-span-2'
                    : undefined
                }
              >
                <Input
                  {...fieldAria(
                    `settings-${field.key}`,
                    errors[field.key],
                    field.hint !== undefined,
                  )}
                  placeholder={field.placeholder}
                  value={draft[field.key]}
                  onChange={(event) => {
                    setDraft({ ...draft, [field.key]: event.target.value });
                  }}
                />
              </Field>
            ))}
            <fieldset className="grid gap-1.5 sm:col-span-2">
              <legend className="mb-1.5 text-sm font-bold">Ancho del papel de la impresora</legend>
              <div
                className="inline-flex w-fit rounded-xl bg-muted p-1"
                role="radiogroup"
                aria-label="Ancho del papel"
              >
                {TICKET_WIDTHS.map((width: TicketWidth) => (
                  <button
                    key={width}
                    type="button"
                    role="radio"
                    aria-checked={draft.ticketWidth === width}
                    onClick={() => {
                      setDraft({ ...draft, ticketWidth: width });
                    }}
                    className={cn(
                      'h-10 rounded-lg px-5 text-sm font-bold focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none',
                      draft.ticketWidth === width ? 'bg-card shadow-xs' : 'text-muted-foreground',
                    )}
                  >
                    {width} mm
                  </button>
                ))}
              </div>
            </fieldset>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Punto de venta</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <Field
              id="settings-tables"
              label="Número de mesas"
              error={errors.tableCount}
              hint={`De 0 a ${String(SETTINGS_LIMITS.maxTables)}.`}
            >
              <Input
                {...fieldAria('settings-tables', errors.tableCount, true)}
                inputMode="numeric"
                value={tables}
                onChange={(event) => {
                  setTables(event.target.value.replace(/\D/g, '').slice(0, 2));
                }}
              />
            </Field>
            <Field
              id="settings-discount"
              label="Descuento máximo sin autorización (%)"
              error={errors.maxCashierDiscountPercent}
              hint="Por encima, la cajera necesita el PIN de un administrador."
            >
              <Input
                {...fieldAria('settings-discount', errors.maxCashierDiscountPercent, true)}
                inputMode="numeric"
                value={maxDiscount}
                onChange={(event) => {
                  setMaxDiscount(event.target.value.replace(/\D/g, '').slice(0, 3));
                }}
              />
            </Field>
            <Field
              id="settings-expense"
              label="Egreso máximo sin autorización"
              error={errors.maxCashierExpense}
              hint="Por encima, la cajera necesita el PIN de un administrador. Los retiros siempre lo piden."
            >
              <PriceInput
                {...fieldAria('settings-expense', errors.maxCashierExpense, true)}
                value={maxExpense}
                onValueChange={setMaxExpense}
              />
            </Field>
          </CardContent>
        </Card>

        {save.isError ? <Alert tone="danger">{errorMessage(save.error)}</Alert> : null}
        <Button type="submit" size="lg" className="justify-self-start" disabled={save.isPending}>
          {save.isPending ? <Spinner /> : <Save aria-hidden="true" />} Guardar configuración
        </Button>
      </form>

      <aside className="grid content-start gap-2" aria-label="Vista previa del tiquete">
        <p className="text-sm font-bold text-muted-foreground">Vista previa del tiquete</p>
        <div className="overflow-x-auto rounded-2xl border border-border bg-white p-4 shadow-xs">
          <Receipt
            sale={{ ...SAMPLE_SALE, einvoice: sampleEInvoice(preview) }}
            settings={preview}
            className="mx-auto"
          />
        </div>
      </aside>
    </div>
  );
}

export function SettingsPage() {
  const settings = useSettings();
  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title="Ajustes"
        description="Datos del negocio, tiquete y reglas del punto de venta."
      />
      {settings.isPending ? (
        <Skeleton className="h-96" />
      ) : settings.isError ? (
        <ErrorState
          description={errorMessage(settings.error)}
          onRetry={() => void settings.refetch()}
        />
      ) : (
        <div className="grid gap-5">
          <SettingsForm key={settings.data.updatedAt ?? 'nuevo'} settings={settings.data} />
          <EInvoiceSettingsCard
            key={`einvoice-${settings.data.updatedAt ?? 'nuevo'}`}
            settings={settings.data}
          />
        </div>
      )}
    </div>
  );
}
