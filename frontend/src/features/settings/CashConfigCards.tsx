import {
  CASH_MOVEMENT_LABELS,
  CASH_MOVEMENT_TYPES,
  type CashConcept,
  type CashMovementType,
  type StaffMember,
} from '@panesypan/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, Pencil, Plus, X } from 'lucide-react';
import { useState, type ReactNode, type SubmitEvent } from 'react';
import { toast } from 'sonner';
import { Spinner } from '@/components/feedback';
import { Button } from '@/components/ui/button';
import { Input, NativeSelect } from '@/components/ui/form';
import {
  Alert,
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Skeleton,
} from '@/components/ui/surface';
import { Switch } from '@/components/ui/toggles';
import { errorMessage } from '@/lib/api-errors';
import { cn } from '@/lib/utils';
import {
  cashConfigKeys,
  createCashConcept,
  createStaffMember,
  updateCashConcept,
  updateStaffMember,
  useCashConcepts,
  useStaff,
} from './cash-config.api';

const onError = (error: unknown) => {
  toast.error(errorMessage(error));
};

/** Fila con nombre editable en el sitio y un interruptor de activo. */
function EditableRow({
  name,
  detail,
  isActive,
  busy,
  onRename,
  onToggle,
}: {
  name: string;
  detail: ReactNode;
  isActive: boolean;
  busy: boolean;
  onRename: (name: string) => void;
  onToggle: (isActive: boolean) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(name);
  return (
    <li className={cn('flex items-center gap-2 py-2', !isActive && 'opacity-60')}>
      <div className="min-w-0 flex-1">
        {editing ? (
          <form
            className="flex gap-1.5"
            onSubmit={(event) => {
              event.preventDefault();
              onRename(value);
              setEditing(false);
            }}
          >
            <Input
              aria-label="Nuevo nombre"
              value={value}
              autoFocus
              className="h-10"
              onChange={(event) => {
                setValue(event.target.value);
              }}
            />
            <Button type="submit" size="icon" className="size-10" aria-label="Guardar nombre">
              <Check />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="size-10"
              aria-label="Cancelar"
              onClick={() => {
                setValue(name);
                setEditing(false);
              }}
            >
              <X />
            </Button>
          </form>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-bold">{name}</span>
            {detail}
          </div>
        )}
      </div>
      {editing ? null : (
        <Button
          variant="ghost"
          size="icon"
          aria-label={`Renombrar ${name}`}
          disabled={busy}
          onClick={() => {
            setEditing(true);
          }}
        >
          <Pencil />
        </Button>
      )}
      <Switch
        checked={isActive}
        onCheckedChange={onToggle}
        label={`${name} activo`}
        disabled={busy}
      />
    </li>
  );
}

// ── Tipos de movimiento ────────────────────────────────────────────

/** Tipos de egreso, retiro e ingreso que la cajera elige en la caja (Nómina, Arriendo…). */
export function CashConceptsCard() {
  const queryClient = useQueryClient();
  const concepts = useCashConcepts(true);
  const [name, setName] = useState('');
  const [type, setType] = useState<CashMovementType>('EXPENSE');
  const [requiresStaff, setRequiresStaff] = useState(false);

  const refresh = () => queryClient.invalidateQueries({ queryKey: cashConfigKeys.all });
  const create = useMutation({
    mutationFn: createCashConcept,
    onSuccess: async (concept) => {
      setName('');
      setRequiresStaff(false);
      await refresh();
      toast.success(`Tipo "${concept.name}" creado`);
    },
    onError,
  });
  const update = useMutation({
    mutationFn: ({ id, ...input }: { id: string; name?: string; isActive?: boolean }) =>
      updateCashConcept(id, input),
    onSuccess: refresh,
    onError,
  });

  const handleCreate = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (name.trim().length < 2) {
      toast.error('El nombre debe tener al menos 2 caracteres');
      return;
    }
    create.mutate({ name, type, requiresStaff: type === 'EXPENSE' && requiresStaff });
  };

  const byType = (value: CashMovementType): CashConcept[] =>
    (concepts.data ?? []).filter((concept) => concept.type === value);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Tipos de movimiento de caja</CardTitle>
        <CardDescription>
          Lo que la cajera elige al registrar un egreso, retiro o ingreso. Así se sabe en qué se va
          la plata (reporte de gastos por tipo).
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <form
          className="grid gap-2 rounded-2xl bg-muted p-3 sm:grid-cols-[1fr_auto_auto]"
          onSubmit={handleCreate}
        >
          <Input
            aria-label="Nombre del nuevo tipo"
            placeholder="Nuevo tipo (ej.: Mantenimiento)"
            value={name}
            onChange={(event) => {
              setName(event.target.value);
            }}
          />
          <NativeSelect
            aria-label="Clase del nuevo tipo"
            value={type}
            onChange={(event) => {
              setType(event.target.value as CashMovementType);
            }}
          >
            {CASH_MOVEMENT_TYPES.map((value) => (
              <option key={value} value={value}>
                {CASH_MOVEMENT_LABELS[value]}
              </option>
            ))}
          </NativeSelect>
          <Button type="submit" disabled={create.isPending}>
            {create.isPending ? <Spinner /> : <Plus aria-hidden="true" />} Agregar
          </Button>
          {type === 'EXPENSE' ? (
            <label className="flex items-center gap-2 text-sm sm:col-span-3">
              <input
                type="checkbox"
                className="size-4"
                checked={requiresStaff}
                onChange={(event) => {
                  setRequiresStaff(event.target.checked);
                }}
              />
              Es un pago a una persona del personal (pide elegir a quién)
            </label>
          ) : null}
        </form>

        {concepts.isPending ? (
          <Skeleton className="h-40" />
        ) : concepts.isError ? (
          <Alert tone="danger">{errorMessage(concepts.error)}</Alert>
        ) : (
          <div className="grid gap-4 md:grid-cols-3">
            {CASH_MOVEMENT_TYPES.map((value) => (
              <section key={value} aria-label={`Tipos de ${CASH_MOVEMENT_LABELS[value]}`}>
                <h3 className="text-sm font-extrabold">{CASH_MOVEMENT_LABELS[value]}s</h3>
                <ul className="divide-y divide-border">
                  {byType(value).map((concept) => (
                    <EditableRow
                      key={`${concept.id}-${concept.name}`}
                      name={concept.name}
                      isActive={concept.isActive}
                      busy={update.isPending}
                      detail={concept.requiresStaff ? <Badge tone="accent">Nómina</Badge> : null}
                      onRename={(next) => {
                        update.mutate({ id: concept.id, name: next });
                      }}
                      onToggle={(isActive) => {
                        update.mutate({ id: concept.id, isActive });
                      }}
                    />
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── Personal ───────────────────────────────────────────────────────

/** Personas a las que se les paga nómina desde la caja (no necesitan usuario del sistema). */
export function StaffCard() {
  const queryClient = useQueryClient();
  const staff = useStaff(true);
  const [name, setName] = useState('');
  const [position, setPosition] = useState('');

  const refresh = () => queryClient.invalidateQueries({ queryKey: cashConfigKeys.all });
  const create = useMutation({
    mutationFn: createStaffMember,
    onSuccess: async (member) => {
      setName('');
      setPosition('');
      await refresh();
      toast.success(`${member.name} agregado al personal`);
    },
    onError,
  });
  const update = useMutation({
    mutationFn: ({ id, ...input }: { id: string; name?: string; isActive?: boolean }) =>
      updateStaffMember(id, input),
    onSuccess: refresh,
    onError,
  });

  const handleCreate = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (name.trim().length < 2) {
      toast.error('El nombre debe tener al menos 2 caracteres');
      return;
    }
    create.mutate({ name, position });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Personal</CardTitle>
        <CardDescription>
          Panaderos, auxiliares y demás personas a las que se les paga desde la caja. Al registrar
          una nómina se elige la persona y el reporte suma lo pagado a cada una.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <form
          className="grid gap-2 rounded-2xl bg-muted p-3 sm:grid-cols-[1fr_1fr_auto]"
          onSubmit={handleCreate}
        >
          <Input
            aria-label="Nombre de la persona"
            placeholder="Nombre"
            value={name}
            onChange={(event) => {
              setName(event.target.value);
            }}
          />
          <Input
            aria-label="Cargo"
            placeholder="Cargo (opcional)"
            value={position}
            onChange={(event) => {
              setPosition(event.target.value);
            }}
          />
          <Button type="submit" disabled={create.isPending}>
            {create.isPending ? <Spinner /> : <Plus aria-hidden="true" />} Agregar
          </Button>
        </form>
        {staff.isPending ? (
          <Skeleton className="h-24" />
        ) : staff.isError ? (
          <Alert tone="danger">{errorMessage(staff.error)}</Alert>
        ) : staff.data.length === 0 ? (
          <p className="text-sm text-muted-foreground">Todavía no hay personal registrado.</p>
        ) : (
          <ul className="divide-y divide-border">
            {staff.data.map((member: StaffMember) => (
              <EditableRow
                key={`${member.id}-${member.name}`}
                name={member.name}
                isActive={member.isActive}
                busy={update.isPending}
                detail={
                  member.position === '' ? null : (
                    <span className="text-sm text-muted-foreground">{member.position}</span>
                  )
                }
                onRename={(next) => {
                  update.mutate({ id: member.id, name: next });
                }}
                onToggle={(isActive) => {
                  update.mutate({ id: member.id, isActive });
                }}
              />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
