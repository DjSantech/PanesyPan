import {
  formatCOP,
  formatLongDateCO,
  toBusinessDate,
  type DailyMenu,
  type UpsertDailyMenuRequest,
} from '@panesypan/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Save, Soup, Trash2 } from 'lucide-react';
import { useState, type SubmitEvent } from 'react';
import { toast } from 'sonner';
import { EmptyState, ErrorState, PageHeader, Spinner } from '@/components/feedback';
import { Button } from '@/components/ui/button';
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
import { Switch } from '@/components/ui/toggles';
import { errorMessage } from '@/lib/api-errors';
import {
  catalogKeys,
  getDailyMenu,
  listCategories,
  listProducts,
  saveDailyMenu,
} from './catalog.api';

interface Offering {
  productId: string;
  name: string;
  price: number;
  enabled: boolean;
  portions: string;
  sold: number;
}

/** Lista editable de textos (acompañantes). */
function TextList({
  label,
  items,
  onChange,
  placeholder,
}: {
  label: string;
  items: string[];
  onChange: (items: string[]) => void;
  placeholder: string;
}) {
  return (
    <fieldset className="grid gap-2">
      <legend className="mb-1.5 text-sm font-bold">{label}</legend>
      {items.map((item, index) => (
        <div key={index} className="flex gap-2">
          <Input
            aria-label={`${label} ${String(index + 1)}`}
            value={item}
            placeholder={placeholder}
            onChange={(event) => {
              onChange(
                items.map((value, position) => (position === index ? event.target.value : value)),
              );
            }}
          />
          <Button
            variant="ghost"
            size="icon"
            aria-label={`Quitar ${item === '' ? 'fila' : item}`}
            onClick={() => {
              onChange(items.filter((_, position) => position !== index));
            }}
          >
            <Trash2 />
          </Button>
        </div>
      ))}
      <Button
        variant="outline"
        size="sm"
        className="justify-self-start"
        onClick={() => {
          onChange([...items, '']);
        }}
      >
        <Plus aria-hidden="true" /> Agregar
      </Button>
    </fieldset>
  );
}

function MenuForm({
  date,
  menu,
  lunchProducts,
}: {
  date: string;
  menu: DailyMenu;
  lunchProducts: { id: string; name: string; price: number }[];
}) {
  const queryClient = useQueryClient();
  const [soup, setSoup] = useState(menu.soup);
  const [principle, setPrinciple] = useState(menu.principle);
  const [proteins, setProteins] = useState(menu.proteins);
  const [sides, setSides] = useState(menu.sides);
  const [juice, setJuice] = useState(menu.juice);
  const [notes, setNotes] = useState(menu.notes);
  const [isPublished, setIsPublished] = useState(menu.isPublished);
  const [offerings, setOfferings] = useState<Offering[]>(() =>
    lunchProducts.map((product) => {
      const current = menu.offerings.find((offering) => offering.productId === product.id);
      return {
        productId: product.id,
        name: product.name,
        price: product.price,
        enabled: current !== undefined,
        portions:
          current?.portions === null || current === undefined ? '' : String(current.portions),
        sold: current?.sold ?? 0,
      };
    }),
  );

  const save = useMutation({
    mutationFn: (input: UpsertDailyMenuRequest) => saveDailyMenu(date, input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: catalogKeys.dailyMenu(date) });
      toast.success('Menú del día guardado');
    },
  });

  const handleSubmit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    save.mutate({
      soup,
      principle,
      proteins: proteins.filter((protein) => protein.name.trim() !== ''),
      sides: sides.filter((side) => side.trim() !== ''),
      juice,
      notes,
      isPublished,
      offerings: offerings
        .filter((offering) => offering.enabled)
        .map((offering) => ({
          productId: offering.productId,
          portions: offering.portions.trim() === '' ? null : Number(offering.portions),
        })),
    });
  };

  return (
    <form className="grid gap-5" onSubmit={handleSubmit} noValidate>
      <Card>
        <CardHeader>
          <CardTitle>Qué hay hoy</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field id="menu-soup" label="Sopa">
            <Input
              id="menu-soup"
              placeholder="Ej.: Sancocho"
              value={soup}
              onChange={(event) => {
                setSoup(event.target.value);
              }}
            />
          </Field>
          <Field id="menu-principle" label="Principio">
            <Input
              id="menu-principle"
              placeholder="Ej.: Fríjoles"
              value={principle}
              onChange={(event) => {
                setPrinciple(event.target.value);
              }}
            />
          </Field>
          <Field id="menu-juice" label="Jugo">
            <Input
              id="menu-juice"
              placeholder="Ej.: Mora"
              value={juice}
              onChange={(event) => {
                setJuice(event.target.value);
              }}
            />
          </Field>
          <Field id="menu-notes" label="Notas (opcional)">
            <Input
              id="menu-notes"
              placeholder="Ej.: Postre de natas"
              value={notes}
              onChange={(event) => {
                setNotes(event.target.value);
              }}
            />
          </Field>

          <fieldset className="grid gap-2 sm:col-span-2">
            <legend className="mb-1.5 text-sm font-bold">
              Proteínas (la cajera elige cuál sirve)
            </legend>
            {proteins.map((protein, index) => (
              <div key={index} className="flex items-center gap-2">
                <Input
                  aria-label={`Proteína ${String(index + 1)}`}
                  placeholder="Ej.: Pollo asado"
                  value={protein.name}
                  onChange={(event) => {
                    setProteins(
                      proteins.map((item, position) =>
                        position === index ? { ...item, name: event.target.value } : item,
                      ),
                    );
                  }}
                />
                <Switch
                  checked={protein.isAvailable}
                  label={`${protein.name === '' ? 'Proteína' : protein.name} disponible`}
                  onCheckedChange={(isAvailable) => {
                    setProteins(
                      proteins.map((item, position) =>
                        position === index ? { ...item, isAvailable } : item,
                      ),
                    );
                  }}
                />
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Quitar proteína"
                  onClick={() => {
                    setProteins(proteins.filter((_, position) => position !== index));
                  }}
                >
                  <Trash2 />
                </Button>
              </div>
            ))}
            <Button
              variant="outline"
              size="sm"
              className="justify-self-start"
              onClick={() => {
                setProteins([...proteins, { name: '', isAvailable: true }]);
              }}
            >
              <Plus aria-hidden="true" /> Agregar proteína
            </Button>
          </fieldset>

          <div className="sm:col-span-2">
            <TextList
              label="Acompañantes"
              items={sides}
              onChange={setSides}
              placeholder="Ej.: Arroz, maduro, ensalada"
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Almuerzos a la venta</CardTitle>
          <CardDescription>
            Marca los que se venden hoy y cuántas porciones hay. Vacío = sin límite.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-2">
          {offerings.map((offering, index) => (
            <div
              key={offering.productId}
              className="flex flex-wrap items-center gap-3 rounded-xl border border-border px-3.5 py-3"
            >
              <Switch
                checked={offering.enabled}
                label={`Vender ${offering.name} hoy`}
                onCheckedChange={(enabled) => {
                  setOfferings(
                    offerings.map((item, position) =>
                      position === index ? { ...item, enabled } : item,
                    ),
                  );
                }}
              />
              <div className="min-w-0 flex-1">
                <p className="font-extrabold">{offering.name}</p>
                <p className="text-sm text-muted-foreground">
                  {formatCOP(offering.price)}
                  {offering.sold > 0 ? ` · vendidos hoy: ${String(offering.sold)}` : ''}
                </p>
              </div>
              <Input
                aria-label={`Porciones de ${offering.name}`}
                className="w-28"
                inputMode="numeric"
                placeholder="Porciones"
                disabled={!offering.enabled}
                value={offering.portions}
                onChange={(event) => {
                  const portions = event.target.value.replace(/\D/g, '').slice(0, 4);
                  setOfferings(
                    offerings.map((item, position) =>
                      position === index ? { ...item, portions } : item,
                    ),
                  );
                }}
              />
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="flex flex-wrap items-center gap-4">
          <Switch checked={isPublished} onCheckedChange={setIsPublished} label="Publicar menú" />
          <div className="min-w-0 flex-1">
            <p className="font-extrabold">{isPublished ? 'Publicado' : 'Borrador'}</p>
            <p className="text-sm text-muted-foreground">
              Publicado: la cajera lo ve en el punto de venta (y en la web, más adelante).
            </p>
          </div>
          <Button type="submit" size="lg" disabled={save.isPending}>
            {save.isPending ? <Spinner /> : <Save aria-hidden="true" />} Guardar menú
          </Button>
        </CardContent>
      </Card>

      {save.isError ? <Alert tone="danger">{errorMessage(save.error)}</Alert> : null}
    </form>
  );
}

export function DailyMenuPage() {
  const [date, setDate] = useState(() => toBusinessDate());

  const menu = useQuery({
    queryKey: catalogKeys.dailyMenu(date),
    queryFn: ({ signal }) => getDailyMenu(date, signal),
  });
  const categories = useQuery({
    queryKey: catalogKeys.categories(false),
    queryFn: ({ signal }) => listCategories(false, signal),
  });
  const lunchCategoryIds = (categories.data ?? [])
    .filter((category) => category.kind === 'LUNCH')
    .map((category) => category.id);
  const products = useQuery({
    queryKey: catalogKeys.products({ status: 'active' }),
    queryFn: ({ signal }) => listProducts({ status: 'active' }, signal),
  });
  const lunchProducts = (products.data ?? []).filter((product) =>
    lunchCategoryIds.includes(product.categoryId),
  );

  const loading = menu.isPending || categories.isPending || products.isPending;
  const failed = menu.isError || categories.isError || products.isError;

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Menú del día"
        description={formatLongDateCO(new Date(`${date}T12:00:00-05:00`))}
        actions={
          <Field id="menu-date" label="Fecha" className="w-44">
            <Input
              id="menu-date"
              type="date"
              value={date}
              onChange={(event) => {
                if (event.target.value !== '') setDate(event.target.value);
              }}
            />
          </Field>
        }
      />

      {loading ? (
        <div className="grid gap-4" aria-busy="true" aria-label="Cargando menú">
          <Skeleton className="h-64" />
          <Skeleton className="h-40" />
        </div>
      ) : failed ? (
        <ErrorState
          description={errorMessage(menu.error ?? categories.error ?? products.error)}
          onRetry={() => {
            void menu.refetch();
            void categories.refetch();
            void products.refetch();
          }}
        />
      ) : lunchProducts.length === 0 ? (
        <EmptyState
          icon={Soup}
          title="No hay productos de almuerzo"
          description='Crea en el Catálogo productos como "Almuerzo corriente" o "Ejecutivo" dentro de la categoría Almuerzos.'
        />
      ) : (
        <MenuForm
          key={`${date}-${menu.data.updatedAt ?? 'nuevo'}`}
          date={date}
          menu={menu.data}
          lunchProducts={lunchProducts}
        />
      )}
    </div>
  );
}
