import {
  formatCOP,
  formatDateTimeCO,
  formatTimeCO,
  toBusinessDate,
  type CashShift,
} from '@panesypan/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Printer, Wallet } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { EmptyState, ErrorState, PageHeader, Spinner } from '@/components/feedback';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/dialog';
import { Field, Input } from '@/components/ui/form';
import { Alert, Badge, Card, Skeleton } from '@/components/ui/surface';
import { errorMessage } from '@/lib/api-errors';
import { cn } from '@/lib/utils';
import { printArea } from '../pos/print-area';
import { useSettings } from '../settings/settings.api';
import {
  cashHistoryKeys,
  confirmShift,
  getShiftDetail,
  listShifts,
  shiftTitle,
} from './cash-history.api';
import { ShiftReport } from './ShiftReport';

const weekAgo = (): string => {
  const date = new Date();
  date.setDate(date.getDate() - 6);
  return toBusinessDate(date);
};

function StatusBadge({ shift }: { shift: CashShift }) {
  if (shift.status === 'OPEN') return <Badge tone="pending">Abierta</Badge>;
  if (shift.confirmedAt !== null) return <Badge tone="success">Confirmada</Badge>;
  return <Badge>Cerrada · por confirmar</Badge>;
}

/** Historial de cajas: cada turno con su resumen, el arqueo y la confirmación del administrador. */
export function CashShiftsPage() {
  const [from, setFrom] = useState(weekAgo);
  const [to, setTo] = useState(() => toBusinessDate());
  const [selected, setSelected] = useState<string | null>(null);
  const validRange = from !== '' && to !== '' && from <= to;
  const shifts = useQuery({
    queryKey: cashHistoryKeys.list({ from, to }),
    queryFn: ({ signal }) => listShifts({ from, to }, signal),
    enabled: validRange,
  });
  const pending = (shifts.data ?? []).filter(
    (shift) => shift.status === 'CLOSED' && shift.confirmedAt === null,
  ).length;

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title="Cajas"
        description="Historial de turnos: base, ventas, movimientos y arqueo. Revisa cada cierre y confírmalo."
      />
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <Field id="shifts-from" label="Desde">
          <Input
            id="shifts-from"
            type="date"
            value={from}
            onChange={(event) => {
              setFrom(event.target.value);
            }}
          />
        </Field>
        <Field id="shifts-to" label="Hasta">
          <Input
            id="shifts-to"
            type="date"
            value={to}
            onChange={(event) => {
              setTo(event.target.value);
            }}
          />
        </Field>
        {pending > 0 ? (
          <p className="ml-auto text-sm font-bold">
            {pending === 1 ? '1 cierre por confirmar' : `${String(pending)} cierres por confirmar`}
          </p>
        ) : null}
      </div>

      {!validRange ? (
        <Alert tone="danger">La fecha inicial no puede ser posterior a la final.</Alert>
      ) : shifts.isPending ? (
        <Skeleton className="h-48" />
      ) : shifts.isError ? (
        <ErrorState
          description={errorMessage(shifts.error)}
          onRetry={() => void shifts.refetch()}
        />
      ) : shifts.data.length === 0 ? (
        <EmptyState icon={Wallet} title="No hay cajas en estas fechas" />
      ) : (
        <Card>
          <ul className="divide-y divide-border">
            {shifts.data.map((shift) => {
              const difference = shift.closing?.difference ?? 0;
              return (
                <li key={shift.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setSelected(shift.id);
                    }}
                    className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-left hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
                  >
                    <span className="font-extrabold">{shiftTitle(shift)}</span>
                    <span className="text-sm text-muted-foreground">
                      {shift.userName} · {formatDateTimeCO(new Date(shift.openedAt))}
                      {shift.closedAt === null
                        ? ''
                        : ` – ${formatTimeCO(new Date(shift.closedAt))}`}
                    </span>
                    <StatusBadge shift={shift} />
                    <span className="ml-auto text-sm tabular-nums">
                      Ventas <strong>{formatCOP(shift.summary.salesTotal)}</strong>
                    </span>
                    {shift.closing === null ? null : (
                      <span
                        className={cn(
                          'text-sm font-bold tabular-nums',
                          difference !== 0 && 'text-danger',
                        )}
                      >
                        {difference === 0
                          ? 'Cuadra'
                          : `${difference > 0 ? 'Sobra' : 'Falta'} ${formatCOP(Math.abs(difference))}`}
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </Card>
      )}
      <ShiftDetailDialog
        shiftId={selected}
        onOpenChange={(open) => {
          if (!open) setSelected(null);
        }}
      />
    </div>
  );
}

function ShiftDetailDialog({
  shiftId,
  onOpenChange,
}: {
  shiftId: string | null;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const settings = useSettings();
  const [note, setNote] = useState('');
  const detail = useQuery({
    queryKey: cashHistoryKeys.detail(shiftId ?? ''),
    queryFn: ({ signal }) => getShiftDetail(shiftId ?? '', signal),
    enabled: shiftId !== null,
  });
  const confirm = useMutation({
    mutationFn: () => confirmShift(shiftId ?? '', note.trim()),
    onSuccess: async () => {
      setNote('');
      await queryClient.invalidateQueries({ queryKey: cashHistoryKeys.all });
      toast.success('Cierre confirmado');
    },
    onError: (error) => {
      toast.error(errorMessage(error));
    },
  });
  const ticketWidth = settings.data?.ticketWidth ?? '80';

  return (
    <Dialog open={shiftId !== null} onOpenChange={onOpenChange}>
      <DialogContent
        title={detail.data === undefined ? 'Caja' : shiftTitle(detail.data.shift)}
        description="Resumen del turno (el mismo que se imprime en la tirilla)."
      >
        {detail.isPending ? (
          <Spinner label="Cargando…" />
        ) : detail.isError ? (
          <Alert tone="danger">{errorMessage(detail.error)}</Alert>
        ) : (
          <>
            <div className="flex justify-center rounded-xl border border-border bg-white p-3">
              <ShiftReport detail={detail.data} ticketWidth={ticketWidth} />
            </div>
            {detail.data.shift.confirmNote === '' ? null : (
              <p className="text-sm">Nota de la revisión: {detail.data.shift.confirmNote}</p>
            )}
            {detail.data.shift.status === 'CLOSED' && detail.data.shift.confirmedAt === null ? (
              <Field id="confirm-note" label="Nota de la revisión (opcional)">
                <Input
                  id="confirm-note"
                  maxLength={300}
                  value={note}
                  onChange={(event) => {
                    setNote(event.target.value);
                  }}
                />
              </Field>
            ) : null}
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => {
                  printArea(
                    <ShiftReport
                      detail={detail.data}
                      ticketWidth={ticketWidth}
                      className="px-[2mm] py-[3mm]"
                    />,
                  );
                }}
              >
                <Printer aria-hidden="true" /> Imprimir
              </Button>
              {detail.data.shift.status === 'CLOSED' && detail.data.shift.confirmedAt === null ? (
                <Button
                  disabled={confirm.isPending}
                  onClick={() => {
                    confirm.mutate();
                  }}
                >
                  {confirm.isPending ? <Spinner /> : <CheckCircle2 aria-hidden="true" />} Confirmar
                  cierre
                </Button>
              ) : null}
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
