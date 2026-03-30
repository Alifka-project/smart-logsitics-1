import type { Delivery } from '../types';
import type { DeliveryOrder, DeliveryStatus } from '../types/delivery';

const UNCONFIRMED_HOURS = 48;

function parseOptDate(v: unknown): Date | undefined {
  if (v == null || v === '') return undefined;
  const d = v instanceof Date ? v : new Date(String(v));
  return Number.isNaN(d.getTime()) ? undefined : d;
}

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function isSameDay(a: Date, b: Date): boolean {
  return startOfDay(a).getTime() === startOfDay(b).getTime();
}

export function isTomorrowDate(date: Date): boolean {
  const t = new Date();
  t.setDate(t.getDate() + 1);
  return isSameDay(date, t);
}

export function isTodayDate(date: Date): boolean {
  return isSameDay(date, new Date());
}

/** True if delivery day is strictly after tomorrow (calendar). */
function isFutureBeyondTomorrow(date: Date): boolean {
  const t = new Date();
  const dayAfter = new Date(t);
  dayAfter.setDate(dayAfter.getDate() + 2);
  return startOfDay(date).getTime() >= startOfDay(dayAfter).getTime();
}

function priorityFromDelivery(d: Delivery): 'normal' | 'high' | 'urgent' | undefined {
  const n = d.priority;
  if (n === 1) return 'urgent';
  if (n === 2) return 'high';
  if (typeof n === 'number') return 'normal';
  return undefined;
}

function deriveWorkflowStatus(d: Delivery, smsSentAt: Date | undefined): DeliveryStatus {
  const s = (d.status || '').toLowerCase();
  const rec = d as Record<string, unknown>;

  if (s === 'cancelled') return 'cancelled';
  if (s === 'rescheduled') return 'rescheduled';
  if (s === 'returned' || s === 'failed' || (s && s.includes('fail'))) return 'failed';

  if (
    [
      'delivered',
      'delivered-with-installation',
      'delivered-without-installation',
      'finished',
      'completed',
      'pod-completed',
    ].includes(s)
  ) {
    return 'delivered';
  }

  // Only use the raw status to determine out_for_delivery — a driver being
  // assigned (assignedDriverId set) does NOT mean the delivery is dispatched.
  if (['out-for-delivery', 'in-transit', 'in-progress'].includes(s)) return 'out_for_delivery';

  if (s === 'confirmed' || s === 'scheduled-confirmed') {
    const target =
      parseOptDate(d.metadata?.scheduledDate) ??
      parseOptDate((d.metadata as Record<string, unknown> | null)?.scheduled_date) ??
      (d.estimatedTime instanceof Date ? d.estimatedTime : parseOptDate(d.estimatedTime));

    if (target && isFutureBeyondTomorrow(target)) return 'scheduled';
    return 'confirmed';
  }

  if (s === 'scheduled') {
    const now = new Date();
    if (smsSentAt) {
      const hours = (now.getTime() - smsSentAt.getTime()) / (1000 * 60 * 60);
      if (hours >= UNCONFIRMED_HOURS) return 'unconfirmed';
    }
    return 'sms_sent';
  }

  return 'uploaded';
}

export function deliveryToManageOrder(delivery: Delivery): DeliveryOrder {
  const rec = delivery as Record<string, unknown>;
  const smsSentAt = parseOptDate(rec.smsSentAt as string | Date | undefined);
  const uploadedAt =
    parseOptDate(delivery.createdAt) ??
    parseOptDate(delivery.created_at) ??
    parseOptDate(delivery.created) ??
    new Date();

  const status = deriveWorkflowStatus(delivery, smsSentAt);

  const meta = delivery.metadata ?? {};
  const scheduledDate =
    parseOptDate(meta.scheduledDate) ?? parseOptDate((meta as Record<string, unknown>).scheduled_date);

  const orderNumber =
    (delivery.poNumber && String(delivery.poNumber)) ||
    (meta.originalDeliveryNumber != null && String(meta.originalDeliveryNumber)) ||
    delivery.id?.slice(0, 8) ||
    '—';

  const area =
    (meta.originalCity != null && String(meta.originalCity)) ||
    (typeof delivery.address === 'string' ? delivery.address.split(',').pop()?.trim() || '—' : '—');

  const deliveredAt = parseOptDate(delivery.deliveredAt) ?? parseOptDate(delivery.podCompletedAt);

  const emailRaw = rec.email ?? rec.Email;
  const customerEmail =
    typeof emailRaw === 'string' && emailRaw.trim() ? emailRaw.trim() : undefined;

  const skuRaw =
    meta.originalPONumber ??
    (meta as Record<string, unknown>).productSKU ??
    (meta as Record<string, unknown>).sku;
  const productSKU = skuRaw != null && String(skuRaw).trim() ? String(skuRaw).trim() : undefined;

  const origRow = (
    (meta.originalRow ?? meta._originalRow ?? rec._originalRow) as Record<string, unknown> | undefined
  ) ?? {};
  const modelRaw = origRow['MODEL ID'] ?? origRow['Model ID'] ?? origRow['model_id'] ?? origRow['ModelID'] ?? origRow['Model'] ?? origRow['model'];
  const model = modelRaw != null && String(modelRaw).trim() ? String(modelRaw).trim() : undefined;
  const descRaw = origRow['Description'] ?? origRow['description'] ?? origRow['Product Description'] ?? origRow['product_description'];
  const productDescription = descRaw != null && String(descRaw).trim() ? String(descRaw).trim() : undefined;

  const confirmedAt =
    parseOptDate((meta as Record<string, unknown>).confirmedAt) ??
    parseOptDate((meta as Record<string, unknown>).confirmed_at);

  const deliveryNumber =
    (meta.originalDeliveryNumber != null && String(meta.originalDeliveryNumber).trim()) ||
    (delivery._originalDeliveryNumber != null && String(delivery._originalDeliveryNumber).trim()) ||
    null;

  return {
    id: delivery.id,
    orderNumber,
    deliveryNumber,
    customerName: delivery.customer?.trim() || '—',
    customerPhone: delivery.phone != null ? String(delivery.phone).trim() : '—',
    customerEmail,
    area,
    address: delivery.address?.trim() || '—',
    product: delivery.items?.trim() || '—',
    productSKU,
    model,
    productDescription,
    status,
    uploadedAt,
    smssentAt: smsSentAt,
    confirmedAt,
    scheduledDate: scheduledDate ?? (status === 'scheduled' ? parseOptDate(delivery.estimatedTime) : undefined),
    deliveryDate: deliveredAt,
    driverId: delivery.assignedDriverId ?? undefined,
    driverName: (rec.driverName as string) || delivery.driverName || undefined,
    priority: priorityFromDelivery(delivery),
    notes: delivery.deliveryNotes ?? delivery.conditionNotes ?? undefined,
    failureReason: status === 'failed' ? (delivery.conditionNotes ?? undefined) : undefined,
  };
}

export function workflowToApiPatch(
  delivery: Delivery,
  workflow: DeliveryStatus,
  scheduledDate?: Date,
): { apiStatus: string; updateData: Partial<Delivery> } {
  const meta = { ...(delivery.metadata ?? {}) } as Record<string, unknown>;
  if (scheduledDate) {
    meta.scheduledDate = scheduledDate.toISOString();
  }

  switch (workflow) {
    case 'uploaded':
      return { apiStatus: 'pending', updateData: { metadata: meta as Delivery['metadata'] } };
    case 'sms_sent':
    case 'unconfirmed':
      return { apiStatus: 'scheduled', updateData: { metadata: meta as Delivery['metadata'] } };
    case 'confirmed':
      return { apiStatus: 'confirmed', updateData: { metadata: meta as Delivery['metadata'] } };
    case 'scheduled':
      return { apiStatus: 'scheduled-confirmed', updateData: { metadata: meta as Delivery['metadata'] } };
    case 'out_for_delivery':
      return { apiStatus: 'out-for-delivery', updateData: { metadata: meta as Delivery['metadata'] } };
    case 'delivered':
      return { apiStatus: 'delivered', updateData: { metadata: meta as Delivery['metadata'] } };
    case 'failed':
      return { apiStatus: 'returned', updateData: { metadata: meta as Delivery['metadata'] } };
    case 'rescheduled':
      return { apiStatus: 'rescheduled', updateData: { metadata: meta as Delivery['metadata'] } };
    case 'cancelled':
      return { apiStatus: 'cancelled', updateData: { metadata: meta as Delivery['metadata'] } };
    default:
      return { apiStatus: delivery.status || 'pending', updateData: { metadata: meta as Delivery['metadata'] } };
  }
}

/** After reschedule: tomorrow → confirmed API; else future → scheduled-confirmed. */
export function rescheduleDateToWorkflow(newDate: Date): DeliveryStatus {
  if (isTomorrowDate(newDate) || isTodayDate(newDate)) return 'confirmed';
  return 'scheduled';
}
