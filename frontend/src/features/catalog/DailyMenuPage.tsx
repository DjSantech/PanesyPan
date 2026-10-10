import {
  formatLongDateCO,
  MENU_OPTIONS_MAX,
  PRICE_LIMITS,
  toBusinessDate,
  type DailyMenu,
  type MenuOption,
  type UpsertDailyMenuRequest,
} from '@panesypan/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Save, Soup, Trash2 } from 'lucide-react';
import { useState, type SubmitEvent } from 'react';
import { toast } from 'sonner';
import { ErrorState, PageHeader, Spinner } from '@/components/feedback';
import { PriceInput } from '@/components/PriceInput';
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
import { CheckboxField, Switch } from '@/components/ui/toggles';
import { errorMessage } from '@/lib/api-errors';
import {
  catalogKeys,
  createCategory,
  createProduct,
  getDailyMenu,
  listCategories,
  listProducts,
  saveDailyMenu,
  updateProduct,
} from './catalog.api';

interface Offering {
  productId: string;
  name: string;
  price: number;
  /** Precio con el que se cargó la página: si cambia, se actualiza el producto al guardar. */
  originalPrice: number;
  enabled: boolean;
  portions: string;
  sold: number;
  withChoices: boolean;
}

/** Almuerzo = se elige proteína, principio y sopa; el resto (p. ej. "Caldo") se vende directo. */
const guessWithChoices = (name: string): boolean => !/caldo|sopa/i.test(name);

/** Lista editable de opciones del menú (sopas, principios o proteínas) con "disponible". */
function OptionList({
  title,
  singular,
  placeholder,
  options,
  onChange,
}: {
  title: string;
  singular: string;
  placeholder: string;
  options: MenuOption[];
  onChange: (options: MenuOption[]) => void;
}) {
  const update = (index: number, change: Partial<MenuOption>) => {
    onChange(options.map((item, position) => (position === index ? { ...item, ...change } : item)));
  };
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>
          Apaga el interruptor cuando se acabe: deja de salir en Vender.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-2">
        {options.length === 0 ? (
          <p className="text-sm text-muted-foreground">Todavía no hay {title.toLowerCase()}.</p>
        ) : null}
        {options.map((option, index) => (
          <div key={index} className="flex items-center gap-2">
            <Input
              aria-label={`${singular} ${String(index + 1)}`}
              placeholder={placeholder}
              value={option.name}
              onChange={(event) => {
                update(index, { name: event.target.value });
              }}
            />
            <Switch
              checked={option.isAvailable}
              label={`${option.name === '' ? singular : option.name} disponible`}
              onCheckedChange={(isAvailable) => {
                update(index, { isAvailable });
              }}
            />
            <Button
              variant="ghost"
              size="icon"
              aria-label={`Quitar ${option.name === '' ? singular.toLowerCase() : option.name}`}
              onClick={() => {
                onChange(options.filter((_, position) => position !== index));
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
          disabled={options.length >= MENU_OPTIONS_MAX}
          onClick={() => {
            onChange([...options, { name: '', isAvailable: true }]);
          }}
        >
          <Plus aria-hidden="true" /> Agregar {singular.toLowerCase()}
        </Button>
      </CardContent>
    </Card>
  );
}

/** Resumen de lo que hay hoy, como se lo dice la cajera al cliente. */
function TodaySummary({
  soups,
  principles,
  proteins,
  drinks,
  isPublished,
}: {
  soups: MenuOption[];
  principles: MenuOption[];
  proteins: MenuOption[];
  drinks: MenuOption[];
  isPublished: boolean;
}) {
  const groups = [
    { label: 'Sopas', options: soups },
    { label: 'Principios', options: principles },
    { label: 'Proteínas', options: proteins },
    { label: 'Bebidas', options: drinks },
  ];
  return (
    <Card>
      <CardHeader>
        <CardTitle>Hoy hay</CardTitle>
        <CardDescription>
          El almuerzo trae una proteína, un principio y sopa (si el cliente la quiere).
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {groups.map((group) => {
          const named = group.options.filter((option) => option.name.trim() !== '');
          return (
            <div key={group.label}>
              <p className="text-sm font-bold text-muted-foreground">{group.label}</p>
              {named.length === 0 ? (
                <p className="text-sm text-muted-foreground">Sin definir</p>
              ) : (
                <ul className="mt-1 grid gap-0.5">
                  {named.map((option) => (
                    <li
                      key={option.name}
                      className={
                        option.isAvailable ? 'font-extrabold' : 'text-muted-foreground line-through'
                      }
                    >
                      {option.name}
                      {option.isAvailable ? null : <span className="sr-only"> (agotado)</span>}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
        {isPublished ? null : (
          <Alert tone="pending" className="sm:col-span-2 lg:col-span-4">
            Este menú es un borrador: en Vender no aparecen los almuerzos hasta que lo publiques.
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}

const cleanOptions = (options: MenuOption[]): MenuOption[] =>
  options
    .map((option) => ({ ...option, name: option.name.trim() }))
    .filter((option) => option.name !== '');

/**
 * Cuando todavía no hay categoría ni productos de almuerzo, los crea aquí mismo (con el precio
 * que ponga el administrador) para no mandarlo al Catálogo a hacerlo a mano.
 */
function QuickLunchSetup() {
  const queryClient = useQueryClient();
  const [price, setPrice] = useState<number | null>(null);
  const [withBroth, setWithBroth] = useState(true);
  const [brothPrice, setBrothPrice] = useState<number | null>(null);

  const setup = useMutation({
    mutationFn: async () => {
      if (price === null || (withBroth && brothPrice === null)) {
        throw new Error('Escribe el precio del almuerzo (y del caldo, si lo vendes aparte).');
      }
      const categories = await listCategories(false);
      const category =
        categories.find((item) => item.kind === 'LUNCH') ??
        (await createCategory({ name: 'Almuerzos', kind: 'LUNCH' }));
      await createProduct({ name: 'Almuerzo', categoryId: category.id, price });
      if (withBroth && brothPrice !== null) {
        await createProduct({ name: 'Caldo', categoryId: category.id, price: brothPrice });
      }
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: catalogKeys.categories(false) });
      await queryClient.invalidateQueries({ queryKey: catalogKeys.products({ status: 'active' }) });
      toast.success('Listo: ya puedes armar el menú del día');
    },
  });

  return (
    <Card>
      <CardHeader>
        <Soup className="size-8 text-muted-foreground" aria-hidden="true" />
        <CardTitle>Primero, crea el almuerzo</CardTitle>
        <CardDescription>
          Todavía no existe el producto "Almuerzo". Ponle un precio y lo creamos aquí mismo, listo
          para armar el menú de hoy. Después puedes editarlo desde el Catálogo si quieres.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <Field id="quick-lunch-price" label="Precio del almuerzo">
          <PriceInput
            id="quick-lunch-price"
            placeholder="Ej.: 14.000"
            value={price}
            onValueChange={setPrice}
          />
        </Field>
        <CheckboxField
          id="quick-lunch-broth"
          label="También vendo el caldo aparte"
          description="Aparte del que ya viene incluido en el almuerzo."
          checked={withBroth}
          onCheckedChange={setWithBroth}
        />
        {withBroth ? (
          <Field id="quick-lunch-broth-price" label="Precio del caldo">
            <PriceInput
              id="quick-lunch-broth-price"
              placeholder="Ej.: 6.000"
              value={brothPrice}
              onValueChange={setBrothPrice}
            />
          </Field>
        ) : null}
        {setup.isError ? <Alert tone="danger">{errorMessage(setup.error)}</Alert> : null}
        <Button
          className="justify-self-start"
          disabled={setup.isPending}
          onClick={() => {
            setup.mutate();
          }}
        >
          {setup.isPending ? <Spinner /> : <Plus aria-hidden="true" />} Crear y continuar
        </Button>
      </CardContent>
    </Card>
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
  const [soups, setSoups] = useState(menu.soups);
  const [principles, setPrinciples] = useState(menu.principles);
  const [proteins, setProteins] = useState(menu.proteins);
  const [drinks, setDrinks] = useState(menu.drinks);
  const [notes, setNotes] = useState(menu.notes);
  const [isPublished, setIsPublished] = useState(menu.isPublished);
  const [offerings, setOfferings] = useState<Offering[]>(() =>
    lunchProducts.map((product) => {
      const current = menu.offerings.find((offering) => offering.productId === product.id);
      return {
        productId: product.id,
        name: product.name,
        price: product.price,
        originalPrice: product.price,
        enabled: current !== undefined,
        portions:
          current?.portions === null || current === undefined ? '' : String(current.portions),
        sold: current?.sold ?? 0,
        withChoices: current?.withChoices ?? guessWithChoices(product.name),
      };
    }),
  );

  const save = useMutation({
    mutationFn: async ({
      menu: input,
      prices,
    }: {
      menu: UpsertDailyMenuRequest;
      prices: { id: string; price: number }[];
    }) => {
      // Primero los precios que se cambiaron (almuerzo, caldo…) y luego el menú.
      for (const { id, price } of prices) await updateProduct(id, { price });
      return saveDailyMenu(date, input);
    },
    onSuccess: async (_menu, { prices }) => {
      await queryClient.invalidateQueries({ queryKey: catalogKeys.dailyMenu(date) });
      if (prices.length > 0) {
        await queryClient.invalidateQueries({ queryKey: catalogKeys.all });
      }
      toast.success(prices.length > 0 ? 'Menú y precios guardados' : 'Menú del día guardado');
    },
  });

  const updateOffering = (index: number, change: Partial<Offering>) => {
    setOfferings(
      offerings.map((item, position) => (position === index ? { ...item, ...change } : item)),
    );
  };

  const handleSubmit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    const invalid = offerings.find((offering) => offering.price < PRICE_LIMITS.min);
    if (invalid !== undefined) {
      toast.error(`El precio de ${invalid.name} debe ser de mínimo $ ${String(PRICE_LIMITS.min)}`);
      return;
    }
    save.mutate({
      prices: offerings
        .filter((offering) => offering.price !== offering.originalPrice)
        .map((offering) => ({ id: offering.productId, price: offering.price })),
      menu: {
        soups: cleanOptions(soups),
        principles: cleanOptions(principles),
        proteins: cleanOptions(proteins),
        drinks: cleanOptions(drinks),
        notes,
        isPublished,
        offerings: offerings
          .filter((offering) => offering.enabled)
          .map((offering) => ({
            productId: offering.productId,
            portions: offering.portions.trim() === '' ? null : Number(offering.portions),
            withChoices: offering.withChoices,
          })),
      },
    });
  };

  return (
    <form className="grid gap-5" onSubmit={handleSubmit} noValidate>
      <TodaySummary
        soups={soups}
        principles={principles}
        proteins={proteins}
        drinks={drinks}
        isPublished={menu.isPublished}
      />

      <OptionList
        title="Sopas"
        singular="Sopa"
        placeholder="Ej.: Sancocho"
        options={soups}
        onChange={setSoups}
      />
      <OptionList
        title="Principios"
        singular="Principio"
        placeholder="Ej.: Fríjoles"
        options={principles}
        onChange={setPrinciples}
      />
      <OptionList
        title="Proteínas"
        singular="Proteína"
        placeholder="Ej.: Pollo asado"
        options={proteins}
        onChange={setProteins}
      />
      <OptionList
        title="Bebidas"
        singular="Bebida"
        placeholder="Ej.: Jugo de mora"
        options={drinks}
        onChange={setDrinks}
      />

      <Card>
        <CardHeader>
          <CardTitle>Notas (opcional)</CardTitle>
        </CardHeader>
        <CardContent>
          <Field id="menu-notes" label="Notas">
            <Input
              id="menu-notes"
              placeholder="Ej.: Postre de natas"
              value={notes}
              onChange={(event) => {
                setNotes(event.target.value);
              }}
            />
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Qué se vende hoy</CardTitle>
          <CardDescription>
            Marca lo que se vende y cuántas porciones hay (vacío = sin límite). Aquí también puedes
            cambiar el precio del almuerzo y del caldo: se actualiza al guardar el menú.
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
                  updateOffering(index, { enabled });
                }}
              />
              <div className="min-w-0 flex-1">
                <p className="font-extrabold">{offering.name}</p>
                {offering.sold > 0 ? (
                  <p className="text-sm text-muted-foreground">
                    Vendidos hoy: {String(offering.sold)}
                  </p>
                ) : null}
              </div>
              <PriceInput
                aria-label={`Precio de ${offering.name}`}
                className="w-32"
                value={offering.price}
                onValueChange={(price) => {
                  updateOffering(index, { price: price ?? 0 });
                }}
              />
              <div className="flex items-center gap-2 text-sm font-bold">
                <Switch
                  checked={offering.withChoices}
                  disabled={!offering.enabled}
                  label={`${offering.name} pide proteína, principio y sopa`}
                  onCheckedChange={(withChoices) => {
                    updateOffering(index, { withChoices });
                  }}
                />
                <span aria-hidden="true">
                  {offering.withChoices ? 'Almuerzo (elige)' : 'Venta directa'}
                </span>
              </div>
              <Input
                aria-label={`Porciones de ${offering.name}`}
                className="w-28"
                inputMode="numeric"
                placeholder="Porciones"
                disabled={!offering.enabled}
                value={offering.portions}
                onChange={(event) => {
                  updateOffering(index, {
                    portions: event.target.value.replace(/\D/g, '').slice(0, 4),
                  });
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
        <QuickLunchSetup />
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
