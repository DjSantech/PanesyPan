import {
  createProductRequestSchema,
  formatCOP,
  formatPriceTiers,
  marginPercent,
  PRICE_LIMITS,
  PRICE_TIERS_MAX,
  priceTiersProblem,
  PRODUCT_CODE_MAX,
  PRODUCT_DESCRIPTION_MAX,
  SUBCATEGORY_MAX,
  TAX_CODE_LABELS,
  TAX_CODES,
  type Category,
  type CreateProductRequest,
  type Product,
  type TaxCode,
  type UpdateProductRequest,
} from '@panesypan/shared';
import { useQuery } from '@tanstack/react-query';
import { ImagePlus, Plus, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type SubmitEvent } from 'react';
import { Spinner } from '@/components/feedback';
import { PriceInput } from '@/components/PriceInput';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/dialog';
import { fieldAria } from '@/components/ui/field-aria';
import { Field, Input, NativeSelect, Textarea } from '@/components/ui/form';
import { Alert } from '@/components/ui/surface';
import { CheckboxField } from '@/components/ui/toggles';
import { resizeImage } from '@/lib/image-resize';
import { inventoryKeys, listInventory } from '../inventory/inventory.api';
import { useSuppliers } from '../purchases/purchases.api';
import { catalogKeys, listProducts, productImageUrl } from './catalog.api';

type Errors = Partial<
  Record<
    | 'name'
    | 'categoryId'
    | 'price'
    | 'cost'
    | 'priceTiers'
    | 'description'
    | 'code'
    | 'initialStock',
    string
  >
>;

/** Escala en edición (vacía mientras se escribe). */
interface TierDraft {
  minQuantity: number | null;
  unitPrice: number | null;
}

/** Qué hacer con la imagen al guardar. */
export type ImageChange = { kind: 'keep' } | { kind: 'set'; image: Blob } | { kind: 'remove' };

interface ProductFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  categories: Category[];
  /** Sin producto = crear. */
  product?: Product;
  defaultCategoryId?: string;
  pending: boolean;
  error: string | null;
  onCreate: (input: CreateProductRequest, image: ImageChange) => void;
  onUpdate: (input: UpdateProductRequest, image: ImageChange) => void;
}

/** Vista previa de la imagen elegida (y libera la memoria al cambiarla). */
function useObjectUrl(blob: Blob | null): string | null {
  const url = useMemo(() => (blob === null ? null : URL.createObjectURL(blob)), [blob]);
  useEffect(
    () => () => {
      if (url !== null) URL.revokeObjectURL(url);
    },
    [url],
  );
  return url;
}

export function ProductFormDialog({
  open,
  onOpenChange,
  categories,
  product,
  defaultCategoryId,
  pending,
  error,
  onCreate,
  onUpdate,
}: ProductFormDialogProps) {
  const editing = product !== undefined;
  const fileInput = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(product?.name ?? '');
  const [categoryId, setCategoryId] = useState(
    product?.categoryId ?? defaultCategoryId ?? categories[0]?.id ?? '',
  );
  const [price, setPrice] = useState<number | null>(product?.price ?? null);
  const [cost, setCost] = useState<number | null>(product?.cost ?? null);
  const [tiers, setTiers] = useState<TierDraft[]>(product?.priceTiers ?? []);
  const [subcategory, setSubcategory] = useState(product?.subcategory ?? '');
  const allProducts = useQuery({
    queryKey: catalogKeys.products({ status: 'all' }),
    queryFn: ({ signal }) => listProducts({ status: 'all' }, signal),
    enabled: open,
  });
  const margin = price === null ? null : marginPercent(price, cost);
  const [description, setDescription] = useState(product?.description ?? '');
  const [code, setCode] = useState(product?.code ?? '');
  const [isFavorite, setIsFavorite] = useState(product?.isFavorite ?? false);
  const kindOf = (id: string) => categories.find((category) => category.id === id)?.kind;
  // Nuevo: todo controla inventario menos los almuerzos (porciones del menú del día).
  const [trackStock, setTrackStock] = useState(
    product?.trackStock ?? kindOf(categoryId) !== 'LUNCH',
  );
  /** null = sin tocar (al editar se muestran las unidades actuales). */
  const [stockText, setStockText] = useState<string | null>(null);

  const inventory = useQuery({
    queryKey: inventoryKeys.stock(false),
    queryFn: ({ signal }) => listInventory(false, signal),
    enabled: product?.trackStock === true,
  });
  const currentStock = editing
    ? (inventory.data?.items.find((item) => item.productId === product.id)?.quantity ??
      (product.trackStock ? undefined : 0))
    : undefined;
  const stockValue = stockText ?? (currentStock === undefined ? '' : String(currentStock));
  const [isVisibleOnline, setIsVisibleOnline] = useState(product?.isVisibleOnline ?? true);
  const [tax, setTax] = useState<TaxCode | null>(product?.tax ?? null);
  const [supplierId, setSupplierId] = useState(product?.supplierId ?? '');
  const suppliers = useSuppliers(open);
  const [imageChange, setImageChange] = useState<ImageChange>({ kind: 'keep' });
  const [imageBusy, setImageBusy] = useState(false);
  const [imageError, setImageError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Errors>({});

  const newImageUrl = useObjectUrl(imageChange.kind === 'set' ? imageChange.image : null);
  const previewUrl =
    imageChange.kind === 'set'
      ? newImageUrl
      : imageChange.kind === 'remove'
        ? null
        : productImageUrl(product?.imagePath ?? null);

  const selectedCategory = categories.find((category) => category.id === categoryId);
  const knownSubcategories = [
    ...new Set(
      (allProducts.data ?? [])
        .filter((item) => item.categoryId === categoryId && item.subcategory !== '')
        .map((item) => item.subcategory),
    ),
  ].sort((a, b) => a.localeCompare(b, 'es'));
  const isLunch = selectedCategory?.kind === 'LUNCH';

  const pickImage = async (file: File | undefined) => {
    if (file === undefined) return;
    setImageError(null);
    setImageBusy(true);
    try {
      setImageChange({ kind: 'set', image: await resizeImage(file) });
    } catch (failure) {
      setImageError(failure instanceof Error ? failure.message : 'No se pudo leer la imagen.');
    } finally {
      setImageBusy(false);
      if (fileInput.current !== null) fileInput.current.value = '';
    }
  };

  const handleSubmit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    const stockInput = stockValue.trim();
    const filledTiers = isLunch
      ? []
      : tiers.filter((tier) => tier.minQuantity !== null || tier.unitPrice !== null);
    const tiersProblem = filledTiers.some(
      (tier) => tier.minQuantity === null || tier.unitPrice === null,
    )
      ? 'Completa la cantidad y el precio de cada escala'
      : price === null
        ? null
        : priceTiersProblem(
            price,
            filledTiers.map((tier) => ({
              minQuantity: tier.minQuantity ?? 0,
              unitPrice: tier.unitPrice ?? 0,
            })),
          );
    const parsed = createProductRequestSchema.safeParse({
      name,
      categoryId,
      subcategory,
      price: price ?? Number.NaN,
      cost,
      priceTiers: filledTiers,
      description,
      code: code.trim() === '' ? null : code,
      isFavorite,
      trackStock,
      isVisibleOnline,
      tax,
      supplierId: supplierId === '' ? null : supplierId,
      initialStock: !editing && trackStock && stockInput !== '' ? Number(stockInput) : null,
    });
    if (!parsed.success || tiersProblem !== null) {
      const next: Errors = {};
      if (tiersProblem !== null) next.priceTiers = tiersProblem;
      for (const issue of parsed.success ? [] : parsed.error.issues) {
        const key = issue.path[0];
        if (
          (key === 'name' ||
            key === 'categoryId' ||
            key === 'price' ||
            key === 'cost' ||
            key === 'priceTiers' ||
            key === 'description' ||
            key === 'code' ||
            key === 'initialStock') &&
          next[key] === undefined
        ) {
          next[key] = key === 'price' && price === null ? 'Escribe el precio' : issue.message;
        }
      }
      setErrors(next);
      return;
    }
    setErrors({});
    if (!editing) {
      onCreate(parsed.data, imageChange);
      return;
    }
    const data = parsed.data;
    const changes: UpdateProductRequest = {};
    if (data.name !== product.name) changes.name = data.name;
    if (data.categoryId !== product.categoryId) changes.categoryId = data.categoryId;
    if (data.subcategory !== product.subcategory) changes.subcategory = data.subcategory;
    if (data.price !== product.price) changes.price = data.price;
    if (data.cost !== product.cost) changes.cost = data.cost;
    if (formatPriceTiers(data.priceTiers) !== formatPriceTiers(product.priceTiers)) {
      changes.priceTiers = data.priceTiers;
    }
    if (data.description !== product.description) changes.description = data.description;
    if (data.code !== product.code) changes.code = data.code;
    if (data.isFavorite !== product.isFavorite) changes.isFavorite = data.isFavorite;
    if (data.trackStock !== product.trackStock) changes.trackStock = data.trackStock;
    if (data.isVisibleOnline !== product.isVisibleOnline) {
      changes.isVisibleOnline = data.isVisibleOnline;
    }
    if (data.tax !== product.tax) changes.tax = data.tax;
    if (data.supplierId !== product.supplierId) changes.supplierId = data.supplierId;
    if (trackStock && stockInput !== '' && Number(stockInput) !== currentStock) {
      changes.stock = Number(stockInput);
    }
    if (Object.keys(changes).length === 0 && imageChange.kind === 'keep') {
      onOpenChange(false);
      return;
    }
    onUpdate(changes, imageChange);
  };

  const busy = pending || imageBusy;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={editing ? 'Editar producto' : 'Nuevo producto'}
        description="El precio es el precio final de venta (ya incluye impuestos)."
        className="sm:max-w-xl"
      >
        <form className="grid gap-4" onSubmit={handleSubmit} noValidate>
          <div className="flex flex-wrap items-center gap-4">
            <div className="grid size-28 shrink-0 place-items-center overflow-hidden rounded-2xl border border-border bg-muted">
              {imageBusy ? (
                <Spinner label="Preparando la imagen…" />
              ) : previewUrl === null ? (
                <ImagePlus className="size-8 text-muted-foreground" aria-hidden="true" />
              ) : (
                <img
                  src={previewUrl}
                  alt={`Imagen de ${name === '' ? 'el producto' : name}`}
                  className="size-full object-cover"
                />
              )}
            </div>
            <div className="grid gap-2">
              <p className="text-sm font-bold">Foto del producto</p>
              <p className="text-sm text-muted-foreground">
                La ven las meseras al vender y los clientes en la web.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() => fileInput.current?.click()}
                >
                  <ImagePlus aria-hidden="true" />{' '}
                  {previewUrl === null ? 'Elegir foto' : 'Cambiar foto'}
                </Button>
                {previewUrl === null ? null : (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-danger"
                    disabled={busy}
                    onClick={() => {
                      setImageChange(
                        editing && product.imagePath !== null
                          ? { kind: 'remove' }
                          : { kind: 'keep' },
                      );
                    }}
                  >
                    <Trash2 aria-hidden="true" /> Quitar
                  </Button>
                )}
              </div>
              <input
                ref={fileInput}
                type="file"
                accept="image/*"
                className="sr-only"
                tabIndex={-1}
                aria-label="Archivo de la foto del producto"
                onChange={(event) => void pickImage(event.target.files?.[0])}
              />
            </div>
          </div>
          {imageError === null ? null : <Alert tone="danger">{imageError}</Alert>}

          <Field id="product-name" label="Nombre" error={errors.name}>
            <Input
              {...fieldAria('product-name', errors.name)}
              autoComplete="off"
              value={name}
              onChange={(event) => {
                setName(event.target.value);
              }}
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="product-category" label="Categoría" error={errors.categoryId}>
              <NativeSelect
                {...fieldAria('product-category', errors.categoryId)}
                value={categoryId}
                onChange={(event) => {
                  setCategoryId(event.target.value);
                  if (!editing) setTrackStock(kindOf(event.target.value) !== 'LUNCH');
                }}
              >
                {categories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field
              id="product-price"
              label="Precio"
              error={errors.price}
              hint={`Mínimo $ ${String(PRICE_LIMITS.min)}`}
            >
              <PriceInput
                {...fieldAria('product-price', errors.price, true)}
                value={price}
                onValueChange={setPrice}
              />
            </Field>
            <Field
              id="product-cost"
              label="Costo (opcional)"
              error={errors.cost}
              hint={
                margin === null
                  ? 'Lo que le cuesta a la panadería. Solo lo ve el administrador.'
                  : `Margen: ${String(margin)} % del precio de venta.`
              }
            >
              <PriceInput
                {...fieldAria('product-cost', errors.cost, true)}
                value={cost}
                onValueChange={setCost}
              />
            </Field>
          </div>

          {isLunch ? null : (
            <fieldset className="grid gap-2" aria-describedby="product-tiers-hint">
              <legend className="text-sm font-bold">Precios por cantidad (opcional)</legend>
              <p id="product-tiers-hint" className="text-sm text-muted-foreground">
                Desde cierta cantidad, cada unidad vale menos. Ej.: desde 12 unidades, $ 700 c/u.
              </p>
              {tiers.map((tier, index) => (
                <div key={index} className="flex flex-wrap items-end gap-2">
                  <Field id={`product-tier-qty-${String(index)}`} label="Desde (unidades)">
                    <Input
                      id={`product-tier-qty-${String(index)}`}
                      inputMode="numeric"
                      className="w-28"
                      value={tier.minQuantity === null ? '' : String(tier.minQuantity)}
                      onChange={(event) => {
                        const digits = event.target.value.replace(/[^0-9]/g, '');
                        setTiers(
                          tiers.map((item, at) =>
                            at === index
                              ? { ...item, minQuantity: digits === '' ? null : Number(digits) }
                              : item,
                          ),
                        );
                      }}
                    />
                  </Field>
                  <Field id={`product-tier-price-${String(index)}`} label="Precio c/u">
                    <PriceInput
                      id={`product-tier-price-${String(index)}`}
                      value={tier.unitPrice}
                      onValueChange={(value) => {
                        setTiers(
                          tiers.map((item, at) =>
                            at === index ? { ...item, unitPrice: value } : item,
                          ),
                        );
                      }}
                    />
                  </Field>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-danger"
                    aria-label={`Quitar el precio por cantidad ${String(index + 1)}`}
                    onClick={() => {
                      setTiers(tiers.filter((_, at) => at !== index));
                    }}
                  >
                    <Trash2 aria-hidden="true" />
                  </Button>
                </div>
              ))}
              {errors.priceTiers === undefined ? null : (
                <p className="text-sm font-semibold text-danger" role="alert">
                  {errors.priceTiers}
                </p>
              )}
              {tiers.length < PRICE_TIERS_MAX ? (
                <div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      const last = tiers.at(-1)?.minQuantity ?? null;
                      setTiers([
                        ...tiers,
                        { minQuantity: last === null ? 12 : last * 2, unitPrice: null },
                      ]);
                    }}
                  >
                    <Plus aria-hidden="true" /> Agregar precio por cantidad
                  </Button>
                </div>
              ) : null}
              {price === null || tiers.length === 0 ? null : (
                <p className="text-sm text-muted-foreground">
                  Precio normal: {formatCOP(price)} c/u.
                </p>
              )}
            </fieldset>
          )}

          <Field
            id="product-code"
            label="Código (opcional)"
            error={errors.code}
            hint="El de barras o el que usabas antes. Con el lector, la caja lo encuentra al escanearlo."
          >
            <Input
              {...fieldAria('product-code', errors.code, true)}
              inputMode="text"
              maxLength={PRODUCT_CODE_MAX}
              placeholder="Ej.: 7702004016614"
              value={code}
              onChange={(event) => {
                setCode(event.target.value);
              }}
            />
          </Field>

          <Field
            id="product-description"
            label="Descripción (opcional)"
            error={errors.description}
            hint={`Qué lleva, tamaño, sabor… ${String(description.length)}/${String(PRODUCT_DESCRIPTION_MAX)}`}
          >
            <Textarea
              {...fieldAria('product-description', errors.description, true)}
              maxLength={PRODUCT_DESCRIPTION_MAX}
              placeholder="Ej.: Pan de bono horneado con queso costeño, sale caliente a las 6 a. m."
              value={description}
              onChange={(event) => {
                setDescription(event.target.value);
              }}
            />
          </Field>

          <Field
            id="product-subcategory"
            label="Subcategoría (opcional)"
            hint="Para ordenar los reportes (ej.: Bebidas › Gaseosas). En el punto de venta se siguen viendo solo las categorías."
          >
            <Input
              {...fieldAria('product-subcategory', null, true)}
              list="product-subcategories"
              maxLength={SUBCATEGORY_MAX}
              autoComplete="off"
              value={subcategory}
              onChange={(event) => {
                setSubcategory(event.target.value);
              }}
            />
            <datalist id="product-subcategories">
              {knownSubcategories.map((name) => (
                <option key={name} value={name} />
              ))}
            </datalist>
          </Field>

          <Field
            id="product-supplier"
            label="Proveedor principal (opcional)"
            hint="Para el pedido sugerido: cuando llegue al stock mínimo aparece en la lista de este proveedor."
          >
            <NativeSelect
              {...fieldAria('product-supplier', null, true)}
              value={supplierId}
              onChange={(event) => {
                setSupplierId(event.target.value);
              }}
            >
              <option value="">Sin proveedor (lo hace la panadería)</option>
              {(suppliers.data ?? []).map((supplier) => (
                <option key={supplier.id} value={supplier.id}>
                  {supplier.name}
                </option>
              ))}
            </NativeSelect>
          </Field>

          <Field
            id="product-tax"
            label="Impuesto (factura electrónica)"
            hint="Lo define el contador. Sin elegir, se usa el impuesto general de Ajustes."
          >
            <NativeSelect
              {...fieldAria('product-tax', null, true)}
              value={tax ?? ''}
              onChange={(event) => {
                setTax(event.target.value === '' ? null : (event.target.value as TaxCode));
              }}
            >
              <option value="">Usar el impuesto general</option>
              {TAX_CODES.map((code) => (
                <option key={code} value={code}>
                  {TAX_CODE_LABELS[code]}
                </option>
              ))}
            </NativeSelect>
          </Field>

          <CheckboxField
            id="product-favorite"
            label="Favorito"
            description="Aparece en los accesos rápidos del punto de venta."
            checked={isFavorite}
            onCheckedChange={setIsFavorite}
          />
          <CheckboxField
            id="product-online"
            label="Mostrar en la web"
            description="Sale en la página pública de la panadería (con su foto y descripción)."
            checked={isVisibleOnline}
            onCheckedChange={setIsVisibleOnline}
          />
          <CheckboxField
            id="product-stock"
            label="Controlar inventario"
            description={
              isLunch
                ? 'Los almuerzos no lo necesitan: sus porciones se controlan en el Menú del día.'
                : 'Descuenta unidades al vender. Sin unidades en Inventario no se podrá vender.'
            }
            checked={trackStock}
            onCheckedChange={setTrackStock}
          />
          {trackStock ? (
            <Field
              id="product-initial-stock"
              label="Unidades disponibles ahora"
              error={errors.initialStock}
              hint={
                editing
                  ? 'Si cambias el número queda como un ajuste en Inventario (con tu nombre y la hora).'
                  : 'Con cuántas unidades arranca. Después se suman en Inventario → Producción.'
              }
            >
              <Input
                {...fieldAria('product-initial-stock', errors.initialStock, true)}
                inputMode="numeric"
                placeholder={editing && currentStock === undefined ? 'Cargando…' : '0'}
                value={stockValue}
                onChange={(event) => {
                  setStockText(event.target.value.replace(/\D/g, '').slice(0, 5));
                }}
              />
            </Field>
          ) : null}

          {error === null ? null : <Alert tone="danger">{error}</Alert>}

          <DialogFooter className="mt-1">
            <Button
              variant="outline"
              onClick={() => {
                onOpenChange(false);
              }}
              disabled={pending}
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={busy}>
              {pending ? <Spinner /> : null}
              {editing ? 'Guardar cambios' : 'Crear producto'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
