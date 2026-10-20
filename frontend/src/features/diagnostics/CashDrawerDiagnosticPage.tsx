import { ArrowLeft, Inbox, Printer, RefreshCw, Save, Search } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { Button } from '@/components/ui/button';
import { CheckboxField } from '@/components/ui/toggles';
import { Field, NativeSelect } from '@/components/ui/form';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/surface';
import {
  BAUD_RATES,
  loadPrinterConfig,
  savePrinterConfig,
  type PrinterConfig,
} from '@/lib/printer/config';
import { PAPER_COLUMNS } from '@/lib/printer/escpos';
import {
  getDrawerStatus,
  listTargets,
  openDrawer,
  printerTransport,
  printTest,
  requestTarget,
  type PrinterTarget,
} from '@/lib/printer/printer';

/**
 * Impresora y caja de ESTE equipo: elegir la impresora de tiquetes (app Android o WebUSB en
 * Chrome), el ancho del papel y si el cajón abre solo al cobrar en efectivo. Es pública
 * (/diagnostico-caja) para poder probar el hardware antes de iniciar sesión.
 */

const TRANSPORT_LABELS = {
  native: 'App Android (USB o puerto serie)',
  webusb: 'Chrome con WebUSB',
} as const;

const reason = (error: unknown) => (error instanceof Error ? error.message : String(error));

export function CashDrawerDiagnosticPage() {
  const transport = printerTransport();
  const [draft, setDraft] = useState<PrinterConfig>(loadPrinterConfig);
  const [targets, setTargets] = useState<PrinterTarget[]>([]);
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<string[]>([]);

  const add = (line: string) => {
    setLog((current) => [...current, `${new Date().toLocaleTimeString('es-CO')}  ${line}`]);
  };

  const run = async (label: string, action: () => Promise<string | undefined>) => {
    setBusy(true);
    try {
      const result = await action();
      add(`✅ ${label}${result === undefined ? '' : `: ${result}`}`);
    } catch (error) {
      add(`❌ ${label}: ${reason(error)}`);
    } finally {
      setBusy(false);
    }
  };

  const refresh = () =>
    run('Buscar impresoras', async () => {
      const found = await listTargets();
      setTargets(found);
      return found.length === 0 ? 'no se encontró ninguna' : `${String(found.length)} encontradas`;
    });

  useEffect(() => {
    if (transport === null) return;
    void listTargets()
      .then(setTargets)
      .catch(() => undefined);
  }, [transport]);

  const authorize = () =>
    run('Autorizar impresora', async () => {
      const target = await requestTarget();
      setTargets((current) => [...current.filter((t) => t.id !== target.id), target]);
      setDraft((current) => ({ ...current, target: target.id }));
      return target.label;
    });

  const selected = targets.find((target) => target.id === draft.target);
  const ready = transport !== null && draft.target !== null;

  return (
    <main className="mx-auto grid max-w-xl gap-4 p-4">
      <Link
        to="/configuracion"
        className="flex items-center gap-1 text-sm font-bold text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden="true" /> Ajustes
      </Link>
      <h1 className="font-display text-3xl leading-tight font-bold">Impresora y caja</h1>

      <Card>
        <CardHeader>
          <CardTitle>Impresora de tiquetes</CardTitle>
          <CardDescription>
            Conexión: {transport === null ? 'ninguna disponible' : TRANSPORT_LABELS[transport]}.
            {transport === null
              ? ' Abre esta página en la app del POS o en Google Chrome para imprimir directo.'
              : ' Se guarda solo en este equipo.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <Field
            id="printer-target"
            label="Impresora"
            hint={
              selected === undefined && draft.target !== null
                ? 'La impresora guardada no aparece ahora: revisa el cable y busca de nuevo.'
                : 'Vacío = imprimir con el diálogo del navegador.'
            }
          >
            <NativeSelect
              id="printer-target"
              value={draft.target ?? ''}
              disabled={transport === null}
              onChange={(event) => {
                setDraft({
                  ...draft,
                  target: event.target.value === '' ? null : event.target.value,
                });
              }}
            >
              <option value="">Ninguna (usar el navegador)</option>
              {draft.target !== null && selected === undefined ? (
                <option value={draft.target}>{draft.target} (no conectada)</option>
              ) : null}
              {targets.map((target) => (
                <option key={target.id} value={target.id}>
                  {target.kind === 'serial' ? 'Serie' : 'USB'} · {target.label}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" disabled={transport === null || busy} onClick={refresh}>
              <RefreshCw aria-hidden="true" /> Buscar impresoras
            </Button>
            {transport === 'webusb' ? (
              <Button variant="outline" disabled={busy} onClick={authorize}>
                <Search aria-hidden="true" /> Autorizar otra
              </Button>
            ) : null}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="printer-paper" label="Ancho del papel">
              <NativeSelect
                id="printer-paper"
                value={draft.paperWidth}
                onChange={(event) => {
                  setDraft({ ...draft, paperWidth: event.target.value === '58' ? '58' : '80' });
                }}
              >
                {(['80', '58'] as const).map((width) => (
                  <option key={width} value={width}>
                    {width} mm ({PAPER_COLUMNS[width]} columnas)
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field
              id="printer-baud"
              label="Velocidad (puerto serie)"
              hint="Solo para impresoras por puerto serie."
            >
              <NativeSelect
                id="printer-baud"
                value={String(draft.baud)}
                onChange={(event) => {
                  setDraft({ ...draft, baud: event.target.value === '9600' ? 9600 : 115200 });
                }}
              >
                {BAUD_RATES.map((baud) => (
                  <option key={baud} value={baud}>
                    {baud}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          </div>
          <CheckboxField
            id="printer-auto-open"
            label="Abrir el cajón al cobrar en efectivo"
            description="El cajón va conectado a la impresora."
            checked={draft.autoOpenOnCash}
            onCheckedChange={(checked) => {
              setDraft({ ...draft, autoOpenOnCash: checked });
            }}
          />
          <Button
            size="lg"
            onClick={() => {
              add(
                savePrinterConfig(draft)
                  ? '✅ Configuración guardada en este equipo'
                  : '❌ El navegador no dejó guardar (¿modo incógnito?)',
              );
            }}
          >
            <Save aria-hidden="true" /> Guardar
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Probar</CardTitle>
          <CardDescription>
            Usa la impresora elegida arriba, aunque aún no la guardes.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-2 sm:grid-cols-3">
          <Button
            variant="outline"
            disabled={!ready || busy}
            onClick={() => run('Imprimir prueba', () => printTest(draft).then(() => undefined))}
          >
            <Printer aria-hidden="true" /> Imprimir prueba
          </Button>
          <Button
            variant="outline"
            disabled={!ready || busy}
            onClick={() => run('Abrir cajón', () => openDrawer(draft).then(() => undefined))}
          >
            <Inbox aria-hidden="true" /> Abrir cajón
          </Button>
          <Button
            variant="outline"
            disabled={!ready || busy}
            onClick={() =>
              run('Estado del cajón', async () => {
                const open = await getDrawerStatus(draft);
                return open === null ? 'la impresora no lo informa' : open ? 'abierto' : 'cerrado';
              })
            }
          >
            Leer estado
          </Button>
        </CardContent>
      </Card>

      <pre className="min-h-32 rounded-md bg-muted p-3 text-xs whitespace-pre-wrap">
        {log.length > 0 ? log.join('\n') : `Aquí aparecerán los resultados. ${navigator.userAgent}`}
      </pre>
    </main>
  );
}
