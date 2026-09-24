import {
  createProductRequestSchema,
  PRICE_LIMITS,
  TAX_CODE_LABELS,
  TAX_CODES,
  type Category,
  type CreateProductRequest,
  type Product,
  type TaxCode,
  type UpdateProductRequest,
} from '@panesypan/shared';
import { useState, type SubmitEvent } from 'react';
import { Spinner } from '@/components/feedback';
import { PriceInput } from '@/components/PriceInput';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/dialog';
import { fieldAria } from '@/components/ui/field-aria';
import { Field, Input, NativeSelect } from '@/components/ui/form';
import { Alert } from '@/components/ui/surface';
import { CheckboxField } from '@/components/ui/toggles';

type Errors = Partial<Record<'name' | 'categoryId' | 'price', string>>;

interface ProductFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  categories: Category[];
  /** Sin producto = crear. */
  product?: Product;
  defaultCategoryId?: string;
  pending: boolean;
  error: string | null;
  onCreate: (input: CreateProductRequest) => void;
  onUpdate: (input: UpdateProductRequest) => void;
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
  const [name, setName] = useState(product?.name ?? '');
  const [categoryId, setCategoryId] = useState(
    product?.categoryId ?? defaultCategoryId ?? categories[0]?.id ?? '',
  );
  const [price, setPrice] = useState<number | null>(product?.price ?? null);
  const [isFavorite, setIsFavorite] = useState(product?.isFavorite ?? false);
  const [trackStock, setTrackStock] = useState(product?.trackStock ?? false);
  const [tax, setTax] = useState<TaxCode | null>(product?.tax ?? null);
  const [errors, setErrors] = useState<Errors>({});

  const handleSubmit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    const parsed = createProductRequestSchema.safeParse({
      name,
      categoryId,
      price: price ?? Number.NaN,
      isFavorite,
      trackStock,
      tax,
    });
    if (!parsed.success) {
      const next: Errors = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0];
        if (
          (key === 'name' || key === 'categoryId' || key === 'price') &&
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
      onCreate(parsed.data);
      return;
    }
    const changes: UpdateProductRequest = {};
    if (parsed.data.name !== product.name) changes.name = parsed.data.name;
    if (parsed.data.categoryId !== product.categoryId) changes.categoryId = parsed.data.categoryId;
    if (parsed.data.price !== product.price) changes.price = parsed.data.price;
    if (parsed.data.isFavorite !== product.isFavorite) changes.isFavorite = parsed.data.isFavorite;
    if (parsed.data.trackStock !== product.trackStock) changes.trackStock = parsed.data.trackStock;
    if (parsed.data.tax !== product.tax) changes.tax = parsed.data.tax;
    if (Object.keys(changes).length === 0) {
      onOpenChange(false);
      return;
    }
    onUpdate(changes);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={editing ? 'Editar producto' : 'Nuevo producto'}
        description="El precio es el precio final de venta (ya incluye impuestos)."
      >
        <form className="grid gap-4" onSubmit={handleSubmit} noValidate>
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
            id="product-stock"
            label="Controlar inventario"
            description="Descuenta unidades al vender. Sin producción registrada en Inventario no se podrá vender."
            checked={trackStock}
            onCheckedChange={setTrackStock}
          />

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
            <Button type="submit" disabled={pending}>
              {pending ? <Spinner /> : null}
              {editing ? 'Guardar cambios' : 'Crear producto'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
