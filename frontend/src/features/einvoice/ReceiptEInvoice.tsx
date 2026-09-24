import {
  BUYER_ID_TYPE_LABELS,
  dianQrUrl,
  formatDateTimeCO,
  type Sale,
  type SaleEInvoice,
} from '@panesypan/shared';
import { QrCode } from './QrCode';

const ENVIRONMENT_WARNINGS = {
  SIMULATED: 'DOCUMENTO SIMULADO · SIN VALIDEZ TRIBUTARIA',
  SANDBOX: 'AMBIENTE DE PRUEBAS · SIN VALIDEZ TRIBUTARIA',
  PRODUCTION: null,
} as const;

function Customer({ sale }: { sale: Sale }) {
  const { customer } = sale;
  if (customer === null) return <p>Adquiriente: Consumidor final</p>;
  const id =
    customer.checkDigit === null
      ? customer.idNumber
      : `${customer.idNumber}-${String(customer.checkDigit)}`;
  return (
    <>
      <p>Adquiriente: {customer.name}</p>
      <p>
        {BUYER_ID_TYPE_LABELS[customer.idType]} {id}
      </p>
    </>
  );
}

/**
 * Representación impresa de la factura electrónica dentro del tiquete: número, CUFE, QR de
 * consulta en la DIAN y el texto legal (resolución de numeración y proveedor) de Ajustes.
 */
export function ReceiptEInvoice({
  sale,
  einvoice,
  legend,
  qrSizeMm,
}: {
  sale: Sale;
  einvoice: SaleEInvoice;
  legend: string;
  qrSizeMm: number;
}) {
  const warning = ENVIRONMENT_WARNINGS[einvoice.environment];
  const accepted = einvoice.status === 'ACCEPTED' && einvoice.cufe !== null;

  return (
    <section aria-label="Factura electrónica" className="grid gap-0.5 text-center">
      {warning === null ? null : <p className="font-extrabold">{warning}</p>}
      {accepted ? (
        <>
          <p className="font-extrabold">FACTURA ELECTRÓNICA DE VENTA</p>
          <p className="font-extrabold">N.º {einvoice.number}</p>
          <div className="text-left">
            <Customer sale={sale} />
            {einvoice.validatedAt === null ? null : (
              <p>Validada: {formatDateTimeCO(new Date(einvoice.validatedAt))}</p>
            )}
          </div>
          <p className="mt-1 text-left text-[0.85em] break-all">CUFE: {einvoice.cufe}</p>
          <div className="mt-1 flex justify-center">
            <QrCode
              value={einvoice.qrData ?? dianQrUrl(einvoice.cufe ?? '')}
              label="Código QR para consultar la factura en la DIAN"
              className="block"
              // En milímetros: así el lector del celular lo capta en papel térmico.
              style={{ width: `${String(qrSizeMm)}mm`, height: `${String(qrSizeMm)}mm` }}
            />
          </div>
        </>
      ) : einvoice.status === 'CANCELED' ? null : (
        <>
          <p className="font-bold">Factura electrónica en validación ante la DIAN.</p>
          <p>Pídala con el número de la venta si la necesita.</p>
        </>
      )}
      {einvoice.creditNote?.status === 'ACCEPTED' ? (
        <p className="mt-1 font-bold">Anulada con nota crédito N.º {einvoice.creditNote.number}</p>
      ) : null}
      {accepted && legend !== '' ? (
        <p className="mt-1 text-[0.85em] whitespace-pre-line">{legend}</p>
      ) : null}
    </section>
  );
}
