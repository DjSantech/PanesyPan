import {
  EXPORT_KINDS,
  EXPORT_LABELS,
  EXPORT_MAX_DAYS,
  exportQuerySchema,
  toBusinessDate,
  type ExportKind,
} from '@panesypan/shared';
import { useMutation } from '@tanstack/react-query';
import { Download } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Field, Input, NativeSelect } from '@/components/ui/form';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/surface';
import { errorMessage } from '@/lib/api-errors';
import { downloadReport } from './dashboard.api';

const isExportKind = (value: string): value is ExportKind =>
  (EXPORT_KINDS as readonly string[]).includes(value);

/** Primer día del mes en curso (hora de Colombia): el rango que casi siempre se quiere. */
const monthStart = (): string => `${toBusinessDate().slice(0, 8)}01`;

export function ExportCard() {
  const [kind, setKind] = useState<ExportKind>('sales');
  const [from, setFrom] = useState(monthStart);
  const [to, setTo] = useState(() => toBusinessDate());

  const parsed = exportQuerySchema.safeParse({ from, to });
  const rangeError = parsed.success ? null : (parsed.error.issues[0]?.message ?? 'Rango inválido');

  const download = useMutation({
    mutationFn: () => downloadReport(kind, { from, to }),
    onSuccess: () => toast.success('Reporte descargado'),
    onError: (error) => toast.error(errorMessage(error)),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Exportar reportes</CardTitle>
        <CardDescription>
          Archivo CSV que abre Excel. Máximo {EXPORT_MAX_DAYS} días por descarga.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <Field id="export-kind" label="Reporte">
            <NativeSelect
              id="export-kind"
              value={kind}
              onChange={(event) => {
                if (isExportKind(event.target.value)) setKind(event.target.value);
              }}
            >
              {EXPORT_KINDS.map((value) => (
                <option key={value} value={value}>
                  {EXPORT_LABELS[value]}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field id="export-from" label="Desde">
            <Input
              id="export-from"
              type="date"
              value={from}
              max={to}
              onChange={(event) => {
                setFrom(event.target.value);
              }}
            />
          </Field>
          <Field id="export-to" label="Hasta">
            <Input
              id="export-to"
              type="date"
              value={to}
              min={from}
              onChange={(event) => {
                setTo(event.target.value);
              }}
            />
          </Field>
        </div>
        {rangeError === null ? null : (
          <p role="alert" className="text-sm font-semibold text-danger">
            {rangeError}
          </p>
        )}
        <div>
          <Button
            disabled={rangeError !== null || download.isPending}
            onClick={() => {
              download.mutate();
            }}
          >
            <Download aria-hidden="true" />
            {download.isPending ? 'Descargando…' : 'Descargar CSV'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
