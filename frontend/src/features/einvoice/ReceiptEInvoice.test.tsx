// @vitest-environment jsdom
import { DEFAULT_BUSINESS_SETTINGS, type Sale, type SaleEInvoice } from '@panesypan/shared';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Receipt } from '../pos/Receipt';

const settings = {
  ...DEFAULT_BUSINESS_SETTINGS,
  einvoiceEnabled: true,
  einvoiceLegend: 'Resolución DIAN N.º 18764000000000, prefijo PAN del 1 al 5000.',
  updatedAt: null,
};

const accepted: SaleEInvoice = {
  status: 'ACCEPTED',
  environment: 'PRODUCTION',
  number: 'PAN42',
  cufe: 'c'.repeat(96),
  qrData: null,
  publicUrl: null,
  validatedAt: '2026-09-24T15:00:00.000Z',
  message: null,
  creditNote: null,
};

const sale = (einvoice: SaleEInvoice | null, customer: Sale['customer'] = null): Sale => ({
  id: 'v1',
  number: 42,
  type: 'COUNTER',
  tableNumber: null,
  status: 'PAID',
  lines: [
    {
      id: 'l1',
      productId: 'p1',
      name: 'Pan de bono',
      unitPrice: 2_000,
      quantity: 2,
      note: '',
      total: 4_000,
      isLunch: false,
    },
  ],
  subtotal: 4_000,
  discount: null,
  total: 4_000,
  payments: [{ method: 'CASH', amount: 4_000, reference: '' }],
  cashReceived: null,
  change: 0,
  shiftId: null,
  openedBy: { id: 'u1', name: 'Laura' },
  paidBy: { id: 'u1', name: 'Laura' },
  openedAt: '2026-09-24T15:00:00.000Z',
  paidAt: '2026-09-24T15:00:00.000Z',
  businessDate: '2026-09-24',
  closure: null,
  customer,
  einvoice,
  updatedAt: '2026-09-24T15:00:00.000Z',
});

describe('tiquete con factura electrónica', () => {
  it('sin facturación electrónica no muestra nada de la DIAN', () => {
    render(<Receipt sale={sale(null)} settings={settings} />);
    expect(screen.queryByRole('region', { name: 'Factura electrónica' })).not.toBeInTheDocument();
  });

  it('validada: número, adquiriente, CUFE, QR y texto legal', () => {
    render(<Receipt sale={sale(accepted)} settings={settings} />);
    const block = screen.getByRole('region', { name: 'Factura electrónica' });
    expect(block).toHaveTextContent('FACTURA ELECTRÓNICA DE VENTA');
    expect(block).toHaveTextContent('N.º PAN42');
    expect(block).toHaveTextContent('Adquiriente: Consumidor final');
    expect(block).toHaveTextContent(`CUFE: ${'c'.repeat(96)}`);
    expect(block).toHaveTextContent('Resolución DIAN N.º 18764000000000');
    expect(
      screen.getByRole('img', { name: 'Código QR para consultar la factura en la DIAN' }),
    ).toBeInTheDocument();
    expect(block).not.toHaveTextContent('SIN VALIDEZ');
  });

  it('a nombre del cliente con su NIT y dígito de verificación', () => {
    render(
      <Receipt
        sale={sale(accepted, {
          idType: 'NIT',
          idNumber: '900123456',
          checkDigit: 8,
          name: 'Cafetería La Esquina',
          email: '',
        })}
        settings={settings}
      />,
    );
    const block = screen.getByRole('region', { name: 'Factura electrónica' });
    expect(block).toHaveTextContent('Adquiriente: Cafetería La Esquina');
    expect(block).toHaveTextContent('NIT 900123456-8');
  });

  it('simulada o de pruebas lo advierte en el papel', () => {
    render(<Receipt sale={sale({ ...accepted, environment: 'SIMULATED' })} settings={settings} />);
    expect(screen.getByText('DOCUMENTO SIMULADO · SIN VALIDEZ TRIBUTARIA')).toBeInTheDocument();
  });

  it('en validación avisa que la factura sigue en proceso', () => {
    render(
      <Receipt
        sale={sale({ ...accepted, status: 'PENDING', number: null, cufe: null })}
        settings={settings}
      />,
    );
    expect(screen.getByText('Factura electrónica en validación ante la DIAN.')).toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });
});
