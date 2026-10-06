import {
  CASH_MOVEMENT_LABELS,
  formatCOP,
  PAYMENT_METHOD_LABELS,
  type BusinessSettings,
  type CashShiftDetail,
} from '@panesypan/shared';
import type { Logger } from 'pino';
import type { Env } from '../../config/env';
import { sendEmail, type EmailCredentials, type EmailMessage } from '../../lib/email';

let credentials: EmailCredentials | null = null;

/** Configura el correo de alertas al arrancar (sin las variables ALERT_EMAIL_* no se envía nada). */
export function configureCloseAlerts(env: Env): void {
  const { RESEND_API_KEY, ALERT_EMAIL_FROM, ALERT_EMAIL_TO } = env;
  credentials =
    RESEND_API_KEY !== undefined && ALERT_EMAIL_FROM !== undefined && ALERT_EMAIL_TO !== undefined
      ? {
          apiKey: RESEND_API_KEY,
          from: ALERT_EMAIL_FROM,
          to: ALERT_EMAIL_TO.split(',')
            .map((address) => address.trim())
            .filter(Boolean),
        }
      : null;
}

export const closeAlertsConfigured = (): boolean => credentials !== null;

/** Según Ajustes, si este cierre merece correo: siempre, o solo con faltante sobre el tope. */
export function shouldAlert(
  settings: Pick<BusinessSettings, 'closeAlert' | 'closeAlertThreshold'>,
  difference: number,
): boolean {
  if (settings.closeAlert === 'OFF') return false;
  if (settings.closeAlert === 'ALWAYS') return true;
  return -difference > settings.closeAlertThreshold;
}

/** Correo con el resumen del cierre (texto plano: se lee bien en el celular). */
export function closeAlertMessage(
  detail: CashShiftDetail,
  settings: Pick<BusinessSettings, 'closeAlertThreshold'>,
): EmailMessage {
  const { shift, byConcept } = detail;
  const closing = shift.closing;
  const difference = closing?.difference ?? 0;
  const title = shift.number === null ? 'Caja' : `Caja N.º ${String(shift.number)}`;
  const flag =
    -difference > settings.closeAlertThreshold
      ? `FALTANTE de ${formatCOP(-difference)}`
      : difference === 0
        ? 'cuadra exacto'
        : difference > 0
          ? `sobrante de ${formatCOP(difference)}`
          : `faltante de ${formatCOP(-difference)}`;
  const lines = [
    `${title} de ${shift.userName} (${shift.businessDate}): ${flag}.`,
    '',
    `Base inicial: ${formatCOP(shift.openingAmount)}`,
    `Ventas: ${String(shift.summary.salesCount)} por ${formatCOP(shift.summary.salesTotal)}`,
    ...shift.summary.byMethod.map(
      (entry) => `  ${PAYMENT_METHOD_LABELS[entry.method]}: ${formatCOP(entry.amount)}`,
    ),
    ...byConcept.map(
      (entry) => `${CASH_MOVEMENT_LABELS[entry.type]} · ${entry.name}: ${formatCOP(entry.amount)}`,
    ),
    '',
    `Efectivo esperado: ${formatCOP(closing?.expectedCash ?? shift.summary.expectedCash)}`,
    `Efectivo contado: ${closing === null ? '—' : formatCOP(closing.countedCash)}`,
  ];
  if (closing?.leftForNext !== null && closing?.leftForNext !== undefined) {
    lines.push(`Quedó de base: ${formatCOP(closing.leftForNext)}`);
  }
  if (closing !== null && closing.note !== '') lines.push(`Nota de la cajera: ${closing.note}`);
  lines.push('', 'Revisa y confirma el cierre en sistema.panesypan.com → Cajas.');
  return { subject: `Panes & Pan · ${title} cerrada: ${flag}`, text: lines.join('\n') };
}

/**
 * Envía el aviso del cierre al dueño sin hacer esperar a la cajera: si el correo falla, se
 * anota en el registro y el cierre queda igual.
 */
export function notifyShiftClosed(
  detail: CashShiftDetail,
  settings: BusinessSettings,
  logger?: Logger,
): void {
  const difference = detail.shift.closing?.difference ?? 0;
  if (credentials === null || !shouldAlert(settings, difference)) return;
  sendEmail(credentials, closeAlertMessage(detail, settings)).catch((error: unknown) => {
    logger?.warn({ err: error }, 'No se pudo enviar el aviso de cierre de caja');
  });
}
