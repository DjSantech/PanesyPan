import {
  DEFAULT_BUSINESS_SETTINGS,
  type BusinessSettings,
  type UpdateBusinessSettingsRequest,
} from '@panesypan/shared';
import { trusted, Types } from 'mongoose';
import { AppError } from '../../lib/errors';
import { recordAudit } from '../audit/audit.service';
import { closeAlertsConfigured } from '../cash/close-alert';
import { isProviderAvailable } from '../einvoice/einvoice.config';
import { SaleModel } from '../sales/sale.model';
import { toAuditActor } from '../users/users.mapper';
import type { ActorContext } from '../users/users.service';
import { BUSINESS_SETTINGS_ID, SettingsModel, type SettingsDocument } from './settings.model';

type EditableField = keyof UpdateBusinessSettingsRequest;

const EDITABLE_FIELDS: readonly EditableField[] = [
  'legalName',
  'taxId',
  'address',
  'phone',
  'ticketFooter',
  'ticketWidth',
  'tableCount',
  'maxCashierDiscountPercent',
  'maxCashierExpense',
  'einvoiceEnabled',
  'einvoiceProvider',
  'einvoiceNumberingRangeId',
  'einvoiceCreditNoteRangeId',
  'einvoiceSendEmail',
  'einvoiceLegend',
  'defaultTax',
  'closeAlert',
  'closeAlertThreshold',
];

function toSettingsDto(settings: SettingsDocument | null): BusinessSettings {
  if (settings === null) {
    return {
      ...DEFAULT_BUSINESS_SETTINGS,
      closeAlertEmailReady: closeAlertsConfigured(),
      updatedAt: null,
    };
  }
  return {
    legalName: settings.legalName,
    taxId: settings.taxId,
    address: settings.address,
    phone: settings.phone,
    ticketFooter: settings.ticketFooter,
    ticketWidth: settings.ticketWidth,
    tableCount: settings.tableCount,
    maxCashierDiscountPercent: settings.maxCashierDiscountPercent,
    maxCashierExpense: settings.maxCashierExpense,
    einvoiceEnabled: settings.einvoiceEnabled,
    einvoiceProvider: settings.einvoiceProvider,
    einvoiceNumberingRangeId: settings.einvoiceNumberingRangeId ?? null,
    einvoiceCreditNoteRangeId: settings.einvoiceCreditNoteRangeId ?? null,
    einvoiceSendEmail: settings.einvoiceSendEmail,
    einvoiceLegend: settings.einvoiceLegend,
    defaultTax: settings.defaultTax ?? null,
    closeAlert: settings.closeAlert,
    closeAlertThreshold: settings.closeAlertThreshold,
    closeAlertEmailReady: closeAlertsConfigured(),
    updatedAt: settings.updatedAt.toISOString(),
  };
}

/**
 * La facturación electrónica solo se activa con lo mínimo para que las facturas salgan bien:
 * impuesto general definido y, con un proveedor real, sus credenciales y rangos de numeración.
 */
function assertEInvoiceReady(settings: Omit<BusinessSettings, 'updatedAt'>): void {
  if (!settings.einvoiceEnabled) return;
  const invalid = (message: string): AppError => new AppError(400, 'VALIDATION_ERROR', message);
  if (settings.defaultTax === null) {
    throw invalid('Elige el impuesto general antes de activar la facturación electrónica.');
  }
  if (settings.einvoiceProvider === 'SIMULATED') return;
  if (!isProviderAvailable(settings.einvoiceProvider)) {
    throw invalid(
      'Factus no está configurado en el servidor: faltan las variables FACTUS_* (ver README).',
    );
  }
  if (settings.einvoiceNumberingRangeId === null || settings.einvoiceCreditNoteRangeId === null) {
    throw invalid('Escribe los rangos de numeración de facturas y de notas crédito del proveedor.');
  }
}

export async function getSettings(): Promise<BusinessSettings> {
  return toSettingsDto(await SettingsModel.findById(BUSINESS_SETTINGS_ID));
}

export async function updateSettings(
  input: UpdateBusinessSettingsRequest,
  ctx: ActorContext,
): Promise<BusinessSettings> {
  const current = await getSettings();
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  for (const field of EDITABLE_FIELDS) {
    const value = input[field];
    if (value !== undefined && value !== current[field]) {
      changes[field] = { from: current[field], to: value };
    }
  }
  if (Object.keys(changes).length === 0) return current;

  // No se pueden quitar mesas que tienen una cuenta abierta.
  if (input.tableCount !== undefined && input.tableCount < current.tableCount) {
    const busy = await SaleModel.findOne({
      status: 'OPEN',
      type: 'TABLE',
      tableNumber: trusted({ $gt: input.tableCount }),
    });
    if (busy !== null) {
      throw new AppError(
        409,
        'CONFLICT',
        `La mesa ${String(busy.tableNumber)} tiene una cuenta abierta: cóbrala o cancélala primero`,
      );
    }
  }

  // Se guardan todos los campos: la primera vez el documento nace con los valores por defecto.
  // (`null` es un valor válido: quitar el impuesto general o el rango de numeración.)
  const next = Object.fromEntries(
    EDITABLE_FIELDS.map((field) => [
      field,
      input[field] === undefined ? current[field] : input[field],
    ]),
  ) as Omit<BusinessSettings, 'updatedAt'>;
  assertEInvoiceReady(next);
  const settings = await SettingsModel.findOneAndUpdate(
    { _id: BUSINESS_SETTINGS_ID },
    { $set: { ...next, updatedBy: new Types.ObjectId(ctx.actor.id) } },
    { upsert: true, returnDocument: 'after' },
  );

  await recordAudit(
    {
      action: 'SETTINGS_UPDATED',
      actor: toAuditActor(ctx.actor),
      entity: { type: 'SETTINGS', id: BUSINESS_SETTINGS_ID, label: 'Configuración del negocio' },
      metadata: { changes },
      meta: ctx.meta,
    },
    ctx.logger,
  );
  return toSettingsDto(settings);
}
