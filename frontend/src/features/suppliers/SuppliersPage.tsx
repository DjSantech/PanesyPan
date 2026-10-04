import {
  createSupplierRequestSchema,
  SUPPLIER_DOCUMENT_LABELS,
  SUPPLIER_DOCUMENT_TYPES,
  type ListSuppliersQuery,
  type Supplier,
  type SupplierDocumentType,
} from '@panesypan/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Archive, ArchiveRestore, Pencil, Phone, Search, Truck } from 'lucide-react';
import { useState, type SubmitEvent } from 'react';
import { toast } from 'sonner';
import { EmptyState, ErrorState, PageHeader, Spinner } from '@/components/feedback';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/dialog';
import { fieldAria } from '@/components/ui/field-aria';
import { Field, Input, NativeSelect } from '@/components/ui/form';
import { Alert, Badge, Card, Skeleton } from '@/components/ui/surface';
import { errorMessage } from '@/lib/api-errors';
import { useDebouncedValue } from '@/lib/use-debounced-value';
import { createSupplier, listSuppliers, suppliersKeys, updateSupplier } from './suppliers.api';

type StatusFilter = ListSuppliersQuery['status'];

const STATUS_FILTERS: { value: StatusFilter; label: string }[] = [
  { value: 'active', label: 'Activos' },
  { value: 'archived', label: 'Archivados' },
  { value: 'all', label: 'Todos' },
];

type Errors = Partial<Record<'name' | 'email', string>>;

function SupplierFormDialog({
  open,
  onOpenChange,
  supplier,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  supplier?: Supplier;
}) {
  const queryClient = useQueryClient();
  const editing = supplier !== undefined;
  const [name, setName] = useState(supplier?.name ?? '');
  const [documentType, setDocumentType] = useState<SupplierDocumentType>(
    supplier?.documentType ?? '',
  );
  const [documentNumber, setDocumentNumber] = useState(supplier?.documentNumber ?? '');
  const [phone, setPhone] = useState(supplier?.phone ?? '');
  const [email, setEmail] = useState(supplier?.email ?? '');
  const [city, setCity] = useState(supplier?.city ?? '');
  const [address, setAddress] = useState(supplier?.address ?? '');
  const [errors, setErrors] = useState<Errors>({});

  const save = useMutation({
    mutationFn: (input: ReturnType<typeof createSupplierRequestSchema.parse>) =>
      editing ? updateSupplier(supplier.id, input) : createSupplier(input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: suppliersKeys.all });
      toast.success(editing ? 'Cambios guardados' : 'Proveedor creado');
      onOpenChange(false);
    },
  });

  const handleSubmit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    const parsed = createSupplierRequestSchema.safeParse({
      name,
      documentType,
      documentNumber,
      phone,
      email,
      city,
      address,
    });
    if (!parsed.success) {
      const next: Errors = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0];
        if ((key === 'name' || key === 'email') && next[key] === undefined) {
          next[key] = issue.message;
        }
      }
      setErrors(next);
      return;
    }
    setErrors({});
    save.mutate(parsed.data);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={editing ? 'Editar proveedor' : 'Nuevo proveedor'}
        description="Con estos datos se elige a quién se le paga desde la caja."
      >
        <form className="grid gap-4" onSubmit={handleSubmit} noValidate>
          <Field id="supplier-name" label="Nombre" error={errors.name}>
            <Input
              {...fieldAria('supplier-name', errors.name, true)}
              autoFocus
              maxLength={80}
              placeholder="Ej.: Alpina"
              value={name}
              onChange={(event) => {
                setName(event.target.value);
              }}
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="supplier-doc-type" label="Documento (opcional)">
              <NativeSelect
                {...fieldAria('supplier-doc-type', null, true)}
                value={documentType}
                onChange={(event) => {
                  setDocumentType(event.target.value as SupplierDocumentType);
                }}
              >
                {SUPPLIER_DOCUMENT_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {SUPPLIER_DOCUMENT_LABELS[type]}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field id="supplier-doc-number" label="Número">
              <Input
                {...fieldAria('supplier-doc-number', null, true)}
                inputMode="numeric"
                maxLength={30}
                value={documentNumber}
                onChange={(event) => {
                  setDocumentNumber(event.target.value);
                }}
              />
            </Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="supplier-phone" label="Teléfono (opcional)">
              <Input
                {...fieldAria('supplier-phone', null, true)}
                inputMode="tel"
                maxLength={30}
                value={phone}
                onChange={(event) => {
                  setPhone(event.target.value);
                }}
              />
            </Field>
            <Field id="supplier-city" label="Ciudad (opcional)">
              <Input
                {...fieldAria('supplier-city', null, true)}
                maxLength={60}
                value={city}
                onChange={(event) => {
                  setCity(event.target.value);
                }}
              />
            </Field>
          </div>
          <Field id="supplier-email" label="Correo (opcional)" error={errors.email}>
            <Input
              {...fieldAria('supplier-email', errors.email, true)}
              type="email"
              maxLength={80}
              value={email}
              onChange={(event) => {
                setEmail(event.target.value);
              }}
            />
          </Field>
          <Field id="supplier-address" label="Dirección (opcional)">
            <Input
              {...fieldAria('supplier-address', null, true)}
              maxLength={120}
              value={address}
              onChange={(event) => {
                setAddress(event.target.value);
              }}
            />
          </Field>
          {save.isError ? <Alert tone="danger">{errorMessage(save.error)}</Alert> : null}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                onOpenChange(false);
              }}
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={save.isPending}>
              {save.isPending ? <Spinner /> : null} {editing ? 'Guardar' : 'Crear proveedor'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function SupplierRow({
  supplier,
  onEdit,
  onToggle,
  busy,
}: {
  supplier: Supplier;
  onEdit: () => void;
  onToggle: () => void;
  busy: boolean;
}) {
  const document =
    supplier.documentNumber === ''
      ? null
      : `${SUPPLIER_DOCUMENT_LABELS[supplier.documentType]} ${supplier.documentNumber}`.trim();
  const details = [document, supplier.city === '' ? null : supplier.city].filter(Boolean);
  return (
    <li className="flex items-center gap-3 px-4 py-3">
      <span
        className="grid size-11 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground"
        aria-hidden="true"
      >
        <Truck className="size-5" />
      </span>
      <div className="grid min-w-0 flex-1 gap-0.5">
        <p className="flex flex-wrap items-center gap-2 font-extrabold">
          {supplier.name}
          {supplier.isActive ? null : <Badge>Archivado</Badge>}
        </p>
        {details.length > 0 ? (
          <p className="truncate text-sm text-muted-foreground">{details.join(' · ')}</p>
        ) : null}
        {supplier.phone === '' ? null : (
          <p className="flex items-center gap-1 text-sm text-muted-foreground">
            <Phone className="size-3.5" aria-hidden="true" /> {supplier.phone}
          </p>
        )}
      </div>
      <Button variant="ghost" size="icon" aria-label={`Editar ${supplier.name}`} onClick={onEdit}>
        <Pencil />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        disabled={busy}
        aria-label={`${supplier.isActive ? 'Archivar' : 'Activar'} ${supplier.name}`}
        onClick={onToggle}
      >
        {supplier.isActive ? <Archive /> : <ArchiveRestore />}
      </Button>
    </li>
  );
}

export function SuppliersPage() {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<StatusFilter>('active');
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search);
  const [form, setForm] = useState<{ open: boolean; supplier?: Supplier }>({ open: false });

  const query = { status, search: debouncedSearch };
  const suppliers = useQuery({
    queryKey: suppliersKeys.list(query),
    queryFn: ({ signal }) => listSuppliers(query, signal),
  });

  const toggle = useMutation({
    mutationFn: (supplier: Supplier) =>
      updateSupplier(supplier.id, { isActive: !supplier.isActive }),
    onSuccess: async (supplier) => {
      await queryClient.invalidateQueries({ queryKey: suppliersKeys.all });
      toast.success(supplier.isActive ? `${supplier.name} activado` : `${supplier.name} archivado`);
    },
    onError: (error) => {
      toast.error(errorMessage(error));
    },
  });

  const openForm = (supplier?: Supplier) => {
    setForm(supplier === undefined ? { open: true } : { open: true, supplier });
  };

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Proveedores"
        description="A quiénes les pagas con la caja. La cajera los elige al registrar un egreso."
        actions={
          <Button
            onClick={() => {
              openForm();
            }}
          >
            <Truck aria-hidden="true" /> Nuevo proveedor
          </Button>
        }
      />

      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <div
          role="radiogroup"
          aria-label="Filtrar por estado"
          className="inline-flex rounded-xl bg-muted p-1"
        >
          {STATUS_FILTERS.map((filter) => (
            <button
              key={filter.value}
              type="button"
              role="radio"
              aria-checked={status === filter.value}
              onClick={() => {
                setStatus(filter.value);
              }}
              className={
                status === filter.value
                  ? 'h-10 rounded-lg bg-card px-4 text-sm font-bold shadow-xs'
                  : 'h-10 rounded-lg px-4 text-sm font-bold text-muted-foreground'
              }
            >
              {filter.label}
            </button>
          ))}
        </div>
        <div className="relative flex-1">
          <Search
            className="pointer-events-none absolute top-1/2 left-3.5 size-5 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            type="search"
            aria-label="Buscar proveedor"
            placeholder="Buscar proveedor…"
            className="pl-11"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
            }}
          />
        </div>
      </div>

      {suppliers.isPending ? (
        <Skeleton className="h-64" />
      ) : suppliers.isError ? (
        <ErrorState
          description={errorMessage(suppliers.error)}
          onRetry={() => {
            void suppliers.refetch();
          }}
        />
      ) : suppliers.data.length === 0 ? (
        <EmptyState
          icon={Truck}
          title={search === '' ? 'No hay proveedores aquí' : 'No se encontraron proveedores'}
          description={search === '' ? 'Crea el primero con "Nuevo proveedor".' : undefined}
        />
      ) : (
        <Card>
          <ul className="divide-y divide-border">
            {suppliers.data.map((supplier) => (
              <SupplierRow
                key={supplier.id}
                supplier={supplier}
                busy={toggle.isPending}
                onEdit={() => {
                  openForm(supplier);
                }}
                onToggle={() => {
                  toggle.mutate(supplier);
                }}
              />
            ))}
          </ul>
        </Card>
      )}

      {form.open ? (
        <SupplierFormDialog
          open
          supplier={form.supplier}
          onOpenChange={(open) => {
            if (!open) setForm({ open: false });
          }}
        />
      ) : null}
    </div>
  );
}
