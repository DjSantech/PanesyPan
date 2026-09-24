import { CATEGORY_KIND_LABELS, type Category, type CategoryKind } from '@panesypan/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, Check, Pencil, Plus, X } from 'lucide-react';
import { useState, type SubmitEvent } from 'react';
import { toast } from 'sonner';
import { Spinner } from '@/components/feedback';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Input, NativeSelect } from '@/components/ui/form';
import { Alert, Badge } from '@/components/ui/surface';
import { Switch } from '@/components/ui/toggles';
import { errorMessage } from '@/lib/api-errors';
import { cn } from '@/lib/utils';
import { catalogKeys, createCategory, reorderCategories, updateCategory } from './catalog.api';

interface CategoriesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  categories: Category[];
}

function CategoryRow({
  category,
  first,
  last,
  busy,
  onMove,
  onRename,
  onToggle,
}: {
  category: Category;
  first: boolean;
  last: boolean;
  busy: boolean;
  onMove: (direction: -1 | 1) => void;
  onRename: (name: string) => void;
  onToggle: (isActive: boolean) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(category.name);

  return (
    <li className={cn('flex items-center gap-2 py-2.5', !category.isActive && 'opacity-60')}>
      <div className="flex flex-col">
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2"
          disabled={first || busy}
          onClick={() => {
            onMove(-1);
          }}
          aria-label={`Subir ${category.name}`}
        >
          <ArrowUp />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2"
          disabled={last || busy}
          onClick={() => {
            onMove(1);
          }}
          aria-label={`Bajar ${category.name}`}
        >
          <ArrowDown />
        </Button>
      </div>
      <div className="min-w-0 flex-1">
        {editing ? (
          <form
            className="flex gap-1.5"
            onSubmit={(event) => {
              event.preventDefault();
              onRename(name);
              setEditing(false);
            }}
          >
            <Input
              aria-label="Nuevo nombre"
              value={name}
              autoFocus
              onChange={(event) => {
                setName(event.target.value);
              }}
              className="h-10"
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
                setName(category.name);
                setEditing(false);
              }}
            >
              <X />
            </Button>
          </form>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-extrabold">{category.name}</span>
            {category.kind === 'LUNCH' ? <Badge tone="accent">Menú del día</Badge> : null}
            <span className="text-sm text-muted-foreground">{category.productCount} productos</span>
          </div>
        )}
      </div>
      {editing ? null : (
        <Button
          variant="ghost"
          size="icon"
          aria-label={`Renombrar ${category.name}`}
          onClick={() => {
            setEditing(true);
          }}
          disabled={busy}
        >
          <Pencil />
        </Button>
      )}
      <Switch
        checked={category.isActive}
        onCheckedChange={onToggle}
        label={`${category.name} activa`}
        disabled={busy}
      />
    </li>
  );
}

/** Crear, renombrar, ordenar y desactivar categorías. */
export function CategoriesDialog({ open, onOpenChange, categories }: CategoriesDialogProps) {
  const queryClient = useQueryClient();
  const [newName, setNewName] = useState('');
  const [newKind, setNewKind] = useState<CategoryKind>('STANDARD');

  const refresh = () => queryClient.invalidateQueries({ queryKey: catalogKeys.all });
  const onError = (error: unknown) => {
    toast.error(errorMessage(error));
  };

  const create = useMutation({
    mutationFn: createCategory,
    onSuccess: async (category) => {
      setNewName('');
      setNewKind('STANDARD');
      await refresh();
      toast.success(`Categoría "${category.name}" creada`);
    },
    onError,
  });
  const update = useMutation({
    mutationFn: ({ id, ...input }: { id: string; name?: string; isActive?: boolean }) =>
      updateCategory(id, input),
    onSuccess: refresh,
    onError,
  });
  const reorder = useMutation({ mutationFn: reorderCategories, onSuccess: refresh, onError });

  const busy = update.isPending || reorder.isPending;

  const move = (index: number, direction: -1 | 1) => {
    const ids = categories.map((category) => category.id);
    const target = index + direction;
    const current = ids[index];
    const other = ids[target];
    if (current === undefined || other === undefined) return;
    ids[index] = other;
    ids[target] = current;
    reorder.mutate(ids);
  };

  const handleCreate = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (newName.trim().length < 2) {
      toast.error('El nombre debe tener al menos 2 caracteres');
      return;
    }
    create.mutate({ name: newName, kind: newKind });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="Categorías"
        description="El orden es el mismo en que aparecen en el punto de venta."
        className="sm:max-w-lg"
      >
        <form
          className="mb-4 grid gap-2 rounded-2xl bg-muted p-3 sm:grid-cols-[1fr_auto_auto]"
          onSubmit={handleCreate}
        >
          <Input
            aria-label="Nombre de la nueva categoría"
            placeholder="Nueva categoría"
            value={newName}
            onChange={(event) => {
              setNewName(event.target.value);
            }}
          />
          <NativeSelect
            aria-label="Tipo de categoría"
            value={newKind}
            onChange={(event) => {
              setNewKind(event.target.value as CategoryKind);
            }}
          >
            {Object.entries(CATEGORY_KIND_LABELS).map(([kind, label]) => (
              <option key={kind} value={kind}>
                {label}
              </option>
            ))}
          </NativeSelect>
          <Button type="submit" disabled={create.isPending}>
            {create.isPending ? <Spinner /> : <Plus aria-hidden="true" />} Agregar
          </Button>
        </form>

        {categories.length === 0 ? (
          <Alert>Todavía no hay categorías.</Alert>
        ) : (
          <ul className="divide-y divide-border">
            {categories.map((category, index) => (
              <CategoryRow
                key={`${category.id}-${category.name}`}
                category={category}
                first={index === 0}
                last={index === categories.length - 1}
                busy={busy}
                onMove={(direction) => {
                  move(index, direction);
                }}
                onRename={(name) => {
                  update.mutate({ id: category.id, name });
                }}
                onToggle={(isActive) => {
                  update.mutate({ id: category.id, isActive });
                }}
              />
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}
