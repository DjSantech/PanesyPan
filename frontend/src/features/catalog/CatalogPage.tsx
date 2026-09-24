import {
  formatCOP,
  type Category,
  type CreateProductRequest,
  type Product,
  type UpdateProductRequest,
} from '@panesypan/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Archive,
  ArchiveRestore,
  Croissant,
  EllipsisVertical,
  FolderCog,
  Pencil,
  Plus,
  Search,
  Star,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { EmptyState, ErrorState, PageHeader } from '@/components/feedback';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/form';
import { Badge, Card, Skeleton } from '@/components/ui/surface';
import { Switch } from '@/components/ui/toggles';
import { errorMessage } from '@/lib/api-errors';
import { useDebouncedValue } from '@/lib/use-debounced-value';
import { cn } from '@/lib/utils';
import { useCan } from '../auth/use-session';
import {
  catalogKeys,
  createProduct,
  deleteProductImage,
  listCategories,
  listProducts,
  setProductAvailability,
  updateProduct,
  uploadProductImage,
} from './catalog.api';
import { CategoriesDialog } from './CategoriesDialog';
import { ProductFormDialog, type ImageChange } from './ProductFormDialog';
import { ProductThumb } from './ProductThumb';

type StatusFilter = 'active' | 'archived';

function ProductRow({
  product,
  canManage,
  onEdit,
  onToggleArchived,
  onToggleAvailable,
}: {
  product: Product;
  canManage: boolean;
  onEdit: () => void;
  onToggleArchived: () => void;
  onToggleAvailable: (isAvailable: boolean) => void;
}) {
  return (
    <li className="flex items-center gap-3 px-4 py-3">
      <ProductThumb imagePath={product.imagePath} name={product.name} className="size-14" />
      <div className="grid min-w-0 flex-1 gap-0.5">
        <p className="flex flex-wrap items-center gap-2">
          <span className={cn('font-extrabold', !product.isAvailable && 'text-muted-foreground')}>
            {product.name}
          </span>
          {product.isFavorite ? (
            <Star className="size-4 fill-accent text-accent" aria-label="Favorito" />
          ) : null}
          {product.isAvailable ? null : <Badge tone="danger">Agotado</Badge>}
          {product.isActive ? null : <Badge>Archivado</Badge>}
          {product.isVisibleOnline ? null : <Badge>No sale en la web</Badge>}
        </p>
        {product.description === '' ? null : (
          <p className="line-clamp-1 text-sm text-muted-foreground">{product.description}</p>
        )}
        <p className="text-lg font-extrabold text-primary">{formatCOP(product.price)}</p>
      </div>
      {product.isActive ? (
        <div className="flex flex-col items-center gap-1">
          <Switch
            checked={product.isAvailable}
            onCheckedChange={onToggleAvailable}
            label={`${product.name} disponible`}
          />
          <span className="text-xs font-bold text-muted-foreground">
            {product.isAvailable ? 'Disponible' : 'Agotado'}
          </span>
        </div>
      ) : null}
      {canManage ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" aria-label={`Acciones para ${product.name}`}>
              <EllipsisVertical />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem onSelect={onEdit}>
              <Pencil aria-hidden="true" /> Editar
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={onToggleArchived}>
              {product.isActive ? (
                <Archive aria-hidden="true" />
              ) : (
                <ArchiveRestore aria-hidden="true" />
              )}
              {product.isActive ? 'Archivar' : 'Restaurar'}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </li>
  );
}

export function CatalogPage() {
  const canManage = useCan('catalog:manage');
  const queryClient = useQueryClient();
  const [categoryId, setCategoryId] = useState<string | undefined>(undefined);
  const [status, setStatus] = useState<StatusFilter>('active');
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search);

  const [form, setForm] = useState<{ open: boolean; product?: Product }>({ open: false });
  const [formError, setFormError] = useState<string | null>(null);
  const [categoriesOpen, setCategoriesOpen] = useState(false);

  const categories = useQuery({
    queryKey: catalogKeys.categories(canManage),
    queryFn: ({ signal }) => listCategories(canManage, signal),
  });
  const productQuery = {
    status,
    search: debouncedSearch,
    ...(categoryId === undefined ? {} : { categoryId }),
  };
  const products = useQuery({
    queryKey: catalogKeys.products(productQuery),
    queryFn: ({ signal }) => listProducts(productQuery, signal),
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: catalogKeys.all });

  const saveProduct = useMutation({
    mutationFn: async (
      input: (
        | { create: CreateProductRequest }
        | { id: string; update: UpdateProductRequest; current: Product }
      ) & { image: ImageChange },
    ) => {
      let product =
        'create' in input
          ? await createProduct(input.create)
          : Object.keys(input.update).length > 0
            ? await updateProduct(input.id, input.update)
            : input.current;
      // La foto va aparte (necesita el producto creado); si falla, el producto ya quedó guardado.
      if (input.image.kind === 'set')
        product = await uploadProductImage(product.id, input.image.image);
      if (input.image.kind === 'remove') product = await deleteProductImage(product.id);
      return product;
    },
    onSuccess: async (product) => {
      setForm({ open: false });
      await refresh();
      toast.success(`"${product.name}" guardado`);
    },
    onError: (error) => {
      setFormError(errorMessage(error));
    },
  });

  const archive = useMutation({
    mutationFn: (product: Product) => updateProduct(product.id, { isActive: !product.isActive }),
    onSuccess: async (product) => {
      await refresh();
      toast.success(
        product.isActive ? `"${product.name}" restaurado` : `"${product.name}" archivado`,
      );
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const availability = useMutation({
    mutationFn: ({ id, isAvailable }: { id: string; isAvailable: boolean }) =>
      setProductAvailability(id, isAvailable),
    onSuccess: async (product) => {
      await refresh();
      toast.success(
        product.isAvailable
          ? `"${product.name}" disponible`
          : `"${product.name}" marcado como agotado`,
      );
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const activeCategories = useMemo(
    () => (categories.data ?? []).filter((category) => category.isActive),
    [categories.data],
  );
  const categoryName = useMemo(
    () =>
      new Map((categories.data ?? []).map((category: Category) => [category.id, category.name])),
    [categories.data],
  );

  // Agrupa los productos por categoría, en el orden de las categorías.
  const groups = useMemo(() => {
    const byCategory = new Map<string, Product[]>();
    for (const product of products.data ?? []) {
      const list = byCategory.get(product.categoryId) ?? [];
      list.push(product);
      byCategory.set(product.categoryId, list);
    }
    const ordered = (categories.data ?? [])
      .filter((category) => byCategory.has(category.id))
      .map((category) => ({
        id: category.id,
        name: category.name,
        items: byCategory.get(category.id) ?? [],
      }));
    return ordered;
  }, [products.data, categories.data]);

  const openForm = (product?: Product) => {
    setFormError(null);
    setForm(product === undefined ? { open: true } : { open: true, product });
  };

  return (
    <div>
      <PageHeader
        title="Catálogo"
        description={
          canManage
            ? 'Productos, precios y categorías. Los precios ya incluyen impuestos.'
            : 'Consulta los productos y marca los que se agoten.'
        }
        actions={
          canManage ? (
            <>
              <Button
                variant="outline"
                onClick={() => {
                  setCategoriesOpen(true);
                }}
              >
                <FolderCog aria-hidden="true" /> Categorías
              </Button>
              <Button
                onClick={() => {
                  openForm();
                }}
                disabled={activeCategories.length === 0}
              >
                <Plus aria-hidden="true" /> Nuevo producto
              </Button>
            </>
          ) : undefined
        }
      />

      <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative sm:w-72">
          <Search
            className="pointer-events-none absolute top-1/2 left-3.5 size-5 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            type="search"
            aria-label="Buscar producto"
            placeholder="Buscar producto…"
            className="pl-11"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
            }}
          />
        </div>
        {canManage ? (
          <div
            role="radiogroup"
            aria-label="Estado"
            className="inline-flex rounded-xl bg-muted p-1 sm:ml-auto"
          >
            {(['active', 'archived'] as const).map((value) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={status === value}
                onClick={() => {
                  setStatus(value);
                }}
                className={cn(
                  'h-9 rounded-lg px-4 text-sm font-bold focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none',
                  status === value ? 'bg-card shadow-xs' : 'text-muted-foreground',
                )}
              >
                {value === 'active' ? 'Activos' : 'Archivados'}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      <div
        className="mb-4 flex gap-2 overflow-x-auto pb-1"
        role="radiogroup"
        aria-label="Filtrar por categoría"
      >
        {[{ id: undefined, name: 'Todas' }, ...activeCategories].map((category) => (
          <button
            key={category.id ?? 'todas'}
            type="button"
            role="radio"
            aria-checked={categoryId === category.id}
            onClick={() => {
              setCategoryId(category.id);
            }}
            className={cn(
              'h-10 shrink-0 rounded-full border px-4 text-sm font-bold whitespace-nowrap focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none',
              categoryId === category.id
                ? 'border-primary bg-primary text-primary-foreground'
                : 'border-border bg-card text-muted-foreground hover:text-foreground',
            )}
          >
            {category.name}
          </button>
        ))}
      </div>

      {products.isPending || categories.isPending ? (
        <Card aria-busy="true" aria-label="Cargando productos">
          {Array.from({ length: 5 }, (_, index) => (
            <div
              key={index}
              className="flex items-center gap-3 border-b border-border px-4 py-4 last:border-0"
            >
              <div className="grid flex-1 gap-2">
                <Skeleton className="h-4 w-48" />
                <Skeleton className="h-5 w-24" />
              </div>
              <Skeleton className="h-7 w-12 rounded-full" />
            </div>
          ))}
        </Card>
      ) : products.isError || categories.isError ? (
        <ErrorState
          description={errorMessage(products.error ?? categories.error)}
          onRetry={() => {
            void refresh();
          }}
        />
      ) : groups.length === 0 ? (
        <EmptyState
          icon={Croissant}
          title={search === '' ? 'No hay productos aquí' : 'No se encontraron productos'}
          description={
            canManage && search === ''
              ? 'Crea uno con "Nuevo producto".'
              : 'Prueba con otra búsqueda.'
          }
        />
      ) : (
        <div className="grid gap-5">
          {groups.map((group) => (
            <section key={group.id} aria-labelledby={`cat-${group.id}`}>
              <h2
                id={`cat-${group.id}`}
                className="mb-2 flex items-center gap-2 text-sm font-extrabold tracking-wide text-muted-foreground uppercase"
              >
                {group.name}
                <span className="font-bold normal-case">· {group.items.length}</span>
              </h2>
              <Card>
                <ul className="divide-y divide-border">
                  {group.items.map((product) => (
                    <ProductRow
                      key={product.id}
                      product={product}
                      canManage={canManage}
                      onEdit={() => {
                        openForm(product);
                      }}
                      onToggleArchived={() => {
                        archive.mutate(product);
                      }}
                      onToggleAvailable={(isAvailable) => {
                        availability.mutate({ id: product.id, isAvailable });
                      }}
                    />
                  ))}
                </ul>
              </Card>
            </section>
          ))}
        </div>
      )}

      {form.open ? (
        <ProductFormDialog
          key={form.product?.id ?? 'nuevo'}
          open
          onOpenChange={(open) => {
            if (!open) setForm({ open: false });
          }}
          categories={activeCategories.length > 0 ? activeCategories : (categories.data ?? [])}
          {...(form.product === undefined ? {} : { product: form.product })}
          {...(categoryId === undefined ? {} : { defaultCategoryId: categoryId })}
          pending={saveProduct.isPending}
          error={formError}
          onCreate={(input, image) => {
            setFormError(null);
            saveProduct.mutate({ create: input, image });
          }}
          onUpdate={(input, image) => {
            if (form.product === undefined) return;
            setFormError(null);
            saveProduct.mutate({
              id: form.product.id,
              update: input,
              current: form.product,
              image,
            });
          }}
        />
      ) : null}

      {canManage ? (
        <CategoriesDialog
          open={categoriesOpen}
          onOpenChange={setCategoriesOpen}
          categories={categories.data ?? []}
        />
      ) : null}

      <p className="sr-only" aria-live="polite">
        {categoryId === undefined ? '' : `Mostrando ${categoryName.get(categoryId) ?? ''}`}
      </p>
    </div>
  );
}
