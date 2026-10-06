import { DEFAULT_BUSINESS_SETTINGS, formatCOP, type CashShiftDetail } from '@panesypan/shared';
import { describe, expect, it, vi } from 'vitest';
import { sendEmail } from '../../lib/email';
import { closeAlertMessage, shouldAlert } from './close-alert';

const detail = (difference: number): CashShiftDetail => ({
  shift: {
    id: 'a'.repeat(24),
    number: 12,
    status: 'CLOSED',
    userId: 'b'.repeat(24),
    userName: 'Laura Gómez',
    businessDate: '2026-10-06',
    openingAmount: 100_000,
    openingNote: '',
    openedAt: '2026-10-06T11:00:00.000Z',
    closedAt: '2026-10-06T21:00:00.000Z',
    summary: {
      salesCount: 3,
      salesTotal: 9_000,
      discountsTotal: 0,
      voidedCount: 0,
      byMethod: [{ method: 'CASH', amount: 9_000, count: 3 }],
      expensesTotal: 0,
      withdrawalsTotal: 0,
      incomesTotal: 0,
      returnsTotal: 0,
      cashRefundsTotal: 0,
      expectedCash: 109_000,
    },
    closing: {
      countedCash: 109_000 + difference,
      expectedCash: 109_000,
      difference,
      counts: [],
      note: difference === 0 ? '' : 'Faltó cambio',
      leftForNext: 50_000,
    },
    confirmedAt: null,
    confirmedBy: null,
    confirmNote: '',
  },
  movements: [],
  byConcept: [],
});

describe('aviso de cierre de caja', () => {
  it('avisa según el modo de Ajustes', () => {
    const settings = { closeAlert: 'SHORTAGE' as const, closeAlertThreshold: 10_000 };
    expect(shouldAlert(settings, -5_000)).toBe(false);
    expect(shouldAlert(settings, -15_000)).toBe(true);
    expect(shouldAlert(settings, 20_000)).toBe(false);
    expect(shouldAlert({ ...settings, closeAlert: 'ALWAYS' }, 0)).toBe(true);
    expect(shouldAlert({ ...settings, closeAlert: 'OFF' }, -99_000)).toBe(false);
  });

  it('el correo resalta el faltante sobre el tope', () => {
    const message = closeAlertMessage(detail(-15_000), DEFAULT_BUSINESS_SETTINGS);
    expect(message.subject).toBe(
      `Panes & Pan · Caja N.º 12 cerrada: FALTANTE de ${formatCOP(15_000)}`,
    );
    expect(message.text).toContain(`Quedó de base: ${formatCOP(50_000)}`);
    expect(message.text).toContain('Nota de la cajera: Faltó cambio');
  });

  it('envía por la API de Resend', async () => {
    const fetchImpl = vi.fn(() => Promise.resolve(new Response('{}', { status: 200 })));
    await sendEmail(
      { apiKey: 're_x', from: 'alertas@panesypan.com', to: ['dueno@correo.com'] },
      { subject: 'Hola', text: 'Prueba' },
      fetchImpl,
    );
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://api.resend.com/emails',
      expect.objectContaining({ method: 'POST' }),
    );
  });
});
