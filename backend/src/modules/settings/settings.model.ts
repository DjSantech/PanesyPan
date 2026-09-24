import { TICKET_WIDTHS, type TicketWidth } from '@panesypan/shared';
import { model, Schema, type HydratedDocument, type Types } from 'mongoose';

/** Documento único con la configuración del negocio (su _id siempre es "business"). */
export const BUSINESS_SETTINGS_ID = 'business';

export interface SettingsAttrs {
  _id: string;
  legalName: string;
  taxId: string;
  address: string;
  phone: string;
  ticketFooter: string;
  ticketWidth: TicketWidth;
  tableCount: number;
  maxCashierDiscountPercent: number;
  maxCashierExpense: number;
  updatedBy: Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}

const settingsSchema = new Schema<SettingsAttrs>(
  {
    _id: { type: String, required: true },
    legalName: { type: String, default: '' },
    taxId: { type: String, default: '' },
    address: { type: String, default: '' },
    phone: { type: String, default: '' },
    ticketFooter: { type: String, default: '' },
    ticketWidth: { type: String, enum: TICKET_WIDTHS, default: '80' },
    tableCount: { type: Number, min: 0, default: 8 },
    maxCashierDiscountPercent: { type: Number, min: 0, max: 100, default: 10 },
    maxCashierExpense: { type: Number, min: 0, default: 50_000 },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true, strict: 'throw' },
);

export const SettingsModel = model<SettingsAttrs>('Settings', settingsSchema);
export type SettingsDocument = HydratedDocument<SettingsAttrs>;
