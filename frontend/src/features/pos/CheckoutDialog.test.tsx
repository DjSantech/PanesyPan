// @vitest-environment jsdom
import { formatCOP, type Sale } from '@panesypan/shared';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api-errors';
import { CheckoutDialog, type CheckoutPayload } from './CheckoutDialog';

const paidSale = { id: 'venta' } as Sale;
/** getByText compara contra el texto normalizado (espacios comunes); formatCOP usa espacio duro. */
const copText = (amount: number): string => formatCOP(amount).replace(/\s/g, ' ');

function renderCheckout(overrides: Partial<Parameters<typeof CheckoutDialog>[0]> = {}) {
  const submit = vi.fn<(payload: CheckoutPayload) => Promise<Sale>>(() =>
    Promise.resolve(paidSale),
  );
  const onPaid = vi.fn();
  const onStale = vi.fn();
  render(
    <CheckoutDialog
      open
      onOpenChange={vi.fn()}
      title="Cobrar pedido"
      subtotal={12_500}
      maxDiscountPercent={10}
      canApprove={false}
      submit={submit}
      onPaid={onPaid}
      onStale={onStale}
      {...overrides}
    />,
  );
  return { submit, onPaid, onStale, user: userEvent.setup() };
}

describe('CheckoutDialog', () => {
  it('calcula el cambio con los billetes sugeridos y cobra en efectivo', async () => {
    const { submit, onPaid, user } = renderCheckout();
    await user.click(screen.getByRole('button', { name: formatCOP(20_000) }));

    expect(screen.getByText(copText(7_500))).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: `Cobrar ${formatCOP(12_500)}` }));

    await waitFor(() => {
      expect(onPaid).toHaveBeenCalledWith(paidSale);
    });
    const payload = submit.mock.calls[0]?.[0];
    expect(payload).toMatchObject({
      expectedTotal: 12_500,
      discount: null,
      payments: [{ method: 'CASH', amount: 12_500, reference: '' }],
      cashReceived: 20_000,
    });
    expect(payload?.clientRequestId).toMatch(/^[\da-f-]{36}$/);
    expect(payload).not.toHaveProperty('approverPin');
  });

  it('en pago combinado no deja cobrar hasta que los pagos cuadran', async () => {
    const { submit, user } = renderCheckout();
    await user.click(screen.getByRole('button', { name: /Pago combinado/ }));
    await user.type(screen.getByLabelText('Nequi'), '10000');
    expect(screen.getByText(`Falta ${copText(2_500)}`)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: `Cobrar ${formatCOP(12_500)}` })).toBeDisabled();

    await user.type(screen.getByLabelText('Efectivo'), '2500');
    await user.click(screen.getByRole('button', { name: `Cobrar ${formatCOP(12_500)}` }));
    await waitFor(() => {
      expect(submit).toHaveBeenCalledTimes(1);
    });
    expect(submit.mock.calls[0]?.[0].payments).toEqual([
      { method: 'CASH', amount: 2_500, reference: '' },
      { method: 'NEQUI', amount: 10_000, reference: '' },
    ]);
  });

  it('un descuento por encima del tope pide el PIN antes de cobrar', async () => {
    const { submit, user } = renderCheckout();
    await user.click(screen.getByRole('button', { name: /Descuento/ }));
    await user.type(screen.getByLabelText('Porcentaje'), '20');
    await user.type(screen.getByLabelText('Motivo'), 'Cliente frecuente');
    expect(screen.getByText(/pedirá el PIN de un administrador/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: `Cobrar ${formatCOP(10_000)}` }));
    expect(
      screen.getByRole('dialog', { name: 'Autorización del administrador' }),
    ).toBeInTheDocument();
    expect(submit).not.toHaveBeenCalled();

    for (const digit of '731940') {
      await user.click(screen.getByRole('button', { name: `Dígito ${digit}` }));
    }
    await waitFor(() => {
      expect(submit).toHaveBeenCalledTimes(1);
    });
    expect(submit.mock.calls[0]?.[0]).toMatchObject({
      expectedTotal: 10_000,
      discount: { mode: 'PERCENT', value: 20, reason: 'Cliente frecuente' },
      approverPin: '731940',
    });
  });

  it('sin facturación electrónica no ofrece facturar a nombre del cliente', () => {
    renderCheckout();
    expect(screen.queryByRole('button', { name: /Factura a nombre/ })).not.toBeInTheDocument();
  });

  it('factura a nombre del cliente con sus datos validados', async () => {
    const { submit, user } = renderCheckout({ einvoiceEnabled: true });
    await user.click(screen.getByRole('button', { name: /Factura a nombre del cliente/ }));
    await user.selectOptions(screen.getByLabelText('Tipo de documento'), 'NIT');
    await user.type(screen.getByLabelText('Número'), '900.123.456');
    expect(screen.getByText('Dígito de verificación: 8')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: `Cobrar ${formatCOP(12_500)}` }));
    expect(screen.getByRole('alert')).toHaveTextContent('Escribe el nombre o la razón social');
    expect(submit).not.toHaveBeenCalled();

    await user.type(screen.getByLabelText('Nombre o razón social'), 'Cafetería La Esquina');
    await user.type(screen.getByLabelText('Correo (opcional)'), 'Compras@LaEsquina.co');
    await user.click(screen.getByRole('button', { name: `Cobrar ${formatCOP(12_500)}` }));
    await waitFor(() => {
      expect(submit).toHaveBeenCalledTimes(1);
    });
    expect(submit.mock.calls[0]?.[0].customer).toEqual({
      idType: 'NIT',
      idNumber: '900123456',
      checkDigit: null,
      name: 'Cafetería La Esquina',
      email: 'compras@laesquina.co',
    });
  });

  it('si el pedido cambió avisa para revisarlo en vez de reintentar', async () => {
    const submit = vi.fn(() =>
      Promise.reject(
        new ApiError(409, 'TOTAL_MISMATCH', `El total cambió: ahora es ${formatCOP(13_000)}`),
      ),
    );
    const { onStale, user } = renderCheckout({ submit });
    await user.click(screen.getByRole('button', { name: `Cobrar ${formatCOP(12_500)}` }));
    await waitFor(() => {
      expect(onStale).toHaveBeenCalledWith(`El total cambió: ahora es ${formatCOP(13_000)}`);
    });
  });
});
