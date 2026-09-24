import { EINVOICE_STATUS_LABELS, type EInvoiceStatus } from '@panesypan/shared';
import { Badge } from '@/components/ui/surface';

const TONES = {
  PENDING: 'pending',
  SENDING: 'pending',
  ACCEPTED: 'success',
  REJECTED: 'danger',
  FAILED: 'danger',
  CANCELED: 'neutral',
} as const satisfies Record<EInvoiceStatus, string>;

/** Estado de una factura o nota crédito electrónica. */
export function EInvoiceBadge({ status, prefix }: { status: EInvoiceStatus; prefix?: string }) {
  const label = EINVOICE_STATUS_LABELS[status];
  return <Badge tone={TONES[status]}>{prefix === undefined ? label : `${prefix}: ${label}`}</Badge>;
}
