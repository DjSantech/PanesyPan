import {
  BULK_PRICE_ROUNDING,
  bulkPriceResultSchema,
  formatCOP,
  importProductsResultSchema,
  type BulkPriceRequest,
  type BulkPriceResult,
  type Category,
  type ImportProductsRequest,
  type ImportProductsResult,
  type ProductImportRow,
} from '@panesypan/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { FileUp } from 'lucide-react';
import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { Spinner } from '@/components/feedback';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/dialog';
import { Field, Input, NativeSelect } from '@/components/ui/form';
import { Alert } from '@/components/ui/surface';
import { apiJson } from '@/lib/api-client';
import { errorMessage } from '@/lib/api-errors';
import { catalogKeys } from './catalog.api';
import { productRowsFromCsv } from './csv-import';

const importProducts = (input: ImportProductsRequest) =>
  apiJson('/api/v1/products/import', importProductsResultSchema, { method: 'POST', body: input });

const bulkPrice = (input: BulkPriceRequest) =>
  apiJson('/api/v1/products/bulk-price', bulkPriceResultSchema, { method: 'POST', body: input });

interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

// ── Carga masiva ───────────────────────────────────────────────────

export function ImportProductsDialog({ open, onOpenChange }: DialogProps) {
  const queryClient = useQueryClient();
  const fileInput = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [rows, setRows] = useState<ProductImportRow[]>([]);
  const [createMissing, setCreateMissing] = useState(false);
  const [preview, setPreview] = useState<ImportProductsResult | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const run = useMutation({
    mutationFn: (dryRun: boolean) => importProducts({ rows, createMissing, dryRun }),
    onSuccess: async (result) => {
      if (result.dryRun) {
        setPreview(result);
        return;
      }
      await queryClient.invalidateQueries({ queryKey: catalogKeys.all });
      toast.success(
        `Listo: ${String(result.updated)} actualizados y ${String(result.created)} creados`,
      );
      onOpenChange(false);
    },
    onError: (error) => {
      setFailure(errorMessage(error));
    },
  });

  const pick = async (file: File | undefined) => {
    if (file === undefined) return;
    setFailure(null);
    setPreview(null);
    const parsed = productRowsFromCsv(await file.text());
    setFileName(file.name);
    setRows(parsed.rows);
    if (parsed.missingName) setFailure('El archivo necesita una columna "Nombre".');
    else if (parsed.rows.length === 0) setFailure('El archivo no tiene productos.');
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="Cargar productos desde un archivo"
        description="CSV de Excel con las columnas Nombre, Categoría, Subcategoría, Precio, Costo y Stock mínimo (sirve el exporte de este sistema y el de TryTiendas). Los productos se buscan por nombre."
        className="sm:max-w-xl"
      >
        <div className="grid gap-4">
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="outline" onClick={() => fileInput.current?.click()}>
              <FileUp aria-hidden="true" /> Elegir archivo CSV
            </Button>
            <span className="text-sm text-muted-foreground">
              {fileName === null ? 'Ningún archivo' : `${fileName} · ${String(rows.length)} filas`}
            </span>
            <input
              ref={fileInput}
              type="file"
              accept=".csv,text/csv"
              className="sr-only"
              tabIndex={-1}
              aria-label="Archivo CSV de productos"
              onChange={(event) => void pick(event.target.files?.[0])}
            />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="size-4"
              checked={createMissing}
              onChange={(event) => {
                setCreateMissing(event.target.checked);
                setPreview(null);
              }}
            />
            Crear los productos que no existen (en su categoría, si trae precio)
          </label>

          {preview === null ? null : (
            <div className="grid gap-2 rounded-xl bg-muted p-3 text-sm">
              <p className="font-bold">
                Se actualizan {preview.updated} · se crean {preview.created} · sin cambios{' '}
                {preview.unchanged} · se omiten {preview.skipped.length}
              </p>
              {preview.changes.length === 0 ? null : (
                <ul className="max-h-40 overflow-y-auto">
                  {preview.changes.map((change) => (
                    <li key={change.name}>
                      <strong>{change.name}</strong>: {change.detail}
                    </li>
                  ))}
                </ul>
              )}
              {preview.skipped.length === 0 ? null : (
                <ul className="max-h-32 overflow-y-auto text-muted-foreground">
                  {preview.skipped.map((skip) => (
                    <li key={`${String(skip.row)}-${skip.name}`}>
                      Fila {skip.row} ({skip.name}): {skip.reason}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          {failure === null ? null : <Alert tone="danger">{failure}</Alert>}
          <DialogFooter className="mt-0">
            <Button
              variant="outline"
              disabled={rows.length === 0 || run.isPending}
              onClick={() => {
                setFailure(null);
                run.mutate(true);
              }}
            >
              {run.isPending && run.variables ? <Spinner /> : null} Ver qué cambia
            </Button>
            <Button
              disabled={
                preview === null || preview.updated + preview.created === 0 || run.isPending
              }
              onClick={() => {
                run.mutate(false);
              }}
            >
              {run.isPending && !run.variables ? <Spinner /> : null} Aplicar cambios
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Cambio de precios por porcentaje ───────────────────────────────

export function BulkPriceDialog({
  open,
  onOpenChange,
  categories,
}: DialogProps & { categories: Category[] }) {
  const queryClient = useQueryClient();
  const [categoryId, setCategoryId] = useState(categories[0]?.id ?? '');
  const [percent, setPercent] = useState('');
  const [roundTo, setRoundTo] = useState<(typeof BULK_PRICE_ROUNDING)[number]>(100);
  const [preview, setPreview] = useState<BulkPriceResult | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const value = Number(percent);
  const valid = percent.trim() !== '' && Number.isInteger(value) && value !== 0;

  const run = useMutation({
    mutationFn: (dryRun: boolean) => bulkPrice({ categoryId, percent: value, roundTo, dryRun }),
    onSuccess: async (result) => {
      if (result.dryRun) {
        setPreview(result);
        return;
      }
      await queryClient.invalidateQueries({ queryKey: catalogKeys.all });
      toast.success(`Precios actualizados: ${String(result.items.length)} productos`);
      onOpenChange(false);
    },
    onError: (error) => {
      setFailure(errorMessage(error));
    },
  });
  const reset = () => {
    setPreview(null);
    setFailure(null);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="Cambiar precios por porcentaje"
        description="Sube o baja todos los precios de una categoría. Revisa la lista antes de aplicar; queda en la auditoría."
      >
        <div className="grid gap-4">
          <Field id="bulk-category" label="Categoría">
            <NativeSelect
              id="bulk-category"
              value={categoryId}
              onChange={(event) => {
                setCategoryId(event.target.value);
                reset();
              }}
            >
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="bulk-percent" label="Porcentaje" hint="Ej.: 10 sube 10 %, -5 baja 5 %">
              <Input
                id="bulk-percent"
                inputMode="numeric"
                value={percent}
                onChange={(event) => {
                  setPercent(event.target.value.replace(/[^\d-]/g, '').slice(0, 4));
                  reset();
                }}
              />
            </Field>
            <Field id="bulk-round" label="Redondear a">
              <NativeSelect
                id="bulk-round"
                value={String(roundTo)}
                onChange={(event) => {
                  setRoundTo(Number(event.target.value) as (typeof BULK_PRICE_ROUNDING)[number]);
                  reset();
                }}
              >
                {BULK_PRICE_ROUNDING.map((option) => (
                  <option key={option} value={option}>
                    {formatCOP(option)}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          </div>
          {preview === null ? null : preview.items.length === 0 ? (
            <Alert>Con ese porcentaje y redondeo ningún precio cambia.</Alert>
          ) : (
            <ul className="max-h-56 overflow-y-auto rounded-xl bg-muted p-3 text-sm">
              {preview.items.map((item) => (
                <li key={item.productId} className="flex justify-between gap-3">
                  <span className="font-bold">{item.name}</span>
                  <span className="tabular-nums">
                    {formatCOP(item.from)} → {formatCOP(item.to)}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {failure === null ? null : <Alert tone="danger">{failure}</Alert>}
          <DialogFooter className="mt-0">
            <Button
              variant="outline"
              disabled={!valid || categoryId === '' || run.isPending}
              onClick={() => {
                run.mutate(true);
              }}
            >
              Ver precios nuevos
            </Button>
            <Button
              disabled={preview === null || preview.items.length === 0 || run.isPending}
              onClick={() => {
                run.mutate(false);
              }}
            >
              {run.isPending ? <Spinner /> : null} Aplicar
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}
