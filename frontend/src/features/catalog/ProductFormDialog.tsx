import {
  createProductRequestSchema,
  PRICE_LIMITS,
  PRODUCT_DESCRIPTION_MAX,
  TAX_CODE_LABELS,
  TAX_CODES,
  type Category,
  type CreateProductRequest,
  type Product,
  type TaxCode,
  type UpdateProductRequest,
} from '@panesypan/shared';
import { ImagePlus, Trash2 } from 'lucide-react';
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
import { productImageUrl } from './catalog.api';

type Errors = Partial<
  Record<'name' | 'categoryId' | 'price' | 'description' | 'initialStock', string>
>;

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
  const [description, setDescription] = useState(product?.description ?? '');
  const [isFavorite, setIsFavorite] = useState(product?.isFavorite ?? false);
  const [trackStock, setTrackStock] = useState(product?.trackStock ?? false);
  const [initialStock, setInitialStock] = useState('');
  const [isVisibleOnline, setIsVisibleOnline] = useState(product?.isVisibleOnline ?? true);
  const [tax, setTax] = useState<TaxCode | null>(product?.tax ?? null);
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
    const stockText = initialStock.trim();
    const parsed = createProductRequestSchema.safeParse({
      name,
      categoryId,
      price: price ?? Number.NaN,
      description,
      isFavorite,
      trackStock,
      isVisibleOnline,
      tax,
      initialStock: !editing && trackStock && stockText !== '' ? Number(stockText) : null,
    });
    if (!parsed.success) {
      const next: Errors = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0];
        if (
          (key === 'name' ||
            key === 'categoryId' ||
            key === 'price' ||
            key === 'description' ||
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
    if (data.price !== product.price) changes.price = data.price;
    if (data.description !== product.description) changes.description = data.description;
    if (data.isFavorite !== product.isFavorite) changes.isFavorite = data.isFavorite;
    if (data.trackStock !== product.trackStock) changes.trackStock = data.trackStock;
    if (data.isVisibleOnline !== product.isVisibleOnline) {
      changes.isVisibleOnline = data.isVisibleOnline;
    }
    if (data.tax !== product.tax) changes.tax = data.tax;
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
          </div>

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
          {!editing && trackStock ? (
            <Field
              id="product-initial-stock"
              label="Unidades disponibles ahora"
              error={errors.initialStock}
              hint="Con cuántas unidades arranca. Después se suman en Inventario → Producción."
            >
              <Input
                {...fieldAria('product-initial-stock', errors.initialStock, true)}
                inputMode="numeric"
                placeholder="0"
                value={initialStock}
                onChange={(event) => {
                  setInitialStock(event.target.value.replace(/\D/g, '').slice(0, 5));
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
