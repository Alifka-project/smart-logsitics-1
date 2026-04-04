import type { Delivery } from '../types';
import type { DeliveryOrder, DeliveryStatus } from '../types/delivery';

const UNCONFIRMED_HOURS = 24;
const DUBAI_OFFSET_MS = 4 * 60 * 60 * 1000; // UTC+4

function parseOptDate(v: unknown): Date | undefined {
  if (v == null || v === '') return undefined;
  const d = v instanceof Date ? v : new Date(String(v));
  return Number.isNaN(d.getTime()) ? undefined : d;
}

/**
 * Extract [year, month (0-indexed), day] components in Dubai timezone (UTC+4).
 * Works correctly regardless of whether the Date was stored in UTC or with a
 * +04:00 offset — both produce the correct Dubai calendar date.
 */
function dubaiYMD(utcMs: number): [number, number, number] {
  const d = new Date(utcMs + DUBAI_OFFSET_MS);
  return [d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()];
}

/**
 * Integer calendar-day difference between a target date and Dubai today.
 * Positive = future, 0 = today, negative = past.
 * Compares Dubai calendar dates only (ignores time-of-day and timezone offsets).
 */
function calDiffFromTodayDubai(target: Date): number {
  const [ty, tm, td] = dubaiYMD(Date.now());
  const [vy, vm, vd] = dubaiYMD(target.getTime());
  return Math.round((Date.UTC(vy, vm, vd) - Date.UTC(ty, tm, td)) / 86400000);
}

/** True if the date falls on tomorrow in Dubai timezone. */
export function isTomorrowDate(date: Date): boolean {
  return calDiffFromTodayDubai(date) === 1;
}

/** True if the date falls on today in Dubai timezone. */
export function isTodayDate(date: Date): boolean {
  return calDiffFromTodayDubai(date) === 0;
}

/**
 * Classify a confirmedDeliveryDate relative to Dubai "today" into a shipment tier.
 * - 'tomorrow'  : Day+1 (confirmed for next day)
 * - 'next'      : Day+2+ but day-before the confirmed date is a no-delivery day
 *                 (Friday=5 / Saturday=6 / Sunday=0). Covers skip-Sunday and
 *                 skip-weekend scenarios common in UAE operations.
 * - 'future'    : Day+2+ on a normal working day
 */
export function classifyConfirmedDate(date: Date): 'tomorrow' | 'next' | 'future' {
  const diffDays = calDiffFromTodayDubai(date);

  if (diffDays <= 1) return 'tomorrow';

  // If the day immediately before the confirmed date is a no-delivery day, the
  // delivery was pushed past it → label as "Next Shipment".
  const [vy, vm, vd] = dubaiYMD(date.getTime());
  const dayBeforeUtc = Date.UTC(vy, vm, vd) - 86400000;
  const dow = new Date(dayBeforeUtc).getUTCDay(); // 0=Sun, 5=Fri, 6=Sat
  if (dow === 0 || dow === 5 || dow === 6) return 'next';

  return 'future';
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

  if (s === 'cancelled') return 'cancelled';
  if (s === 'rescheduled') return 'rescheduled';
  if (s === 'order-delay') return 'order_delay';
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

  // Helper: is the date's Dubai calendar day strictly before today? (overdue)
  const isOverdue = (date: Date): boolean => calDiffFromTodayDubai(date) < 0;

  // Out-for-delivery: auto-delay if the confirmed delivery date has passed
  if (['out-for-delivery', 'in-transit', 'in-progress'].includes(s)) {
    const confirmedDate =
      parseOptDate(d.confirmedDeliveryDate) ?? parseOptDate(d.customerConfirmedAt);
    if (confirmedDate && isOverdue(confirmedDate)) return 'order_delay';
    return 'out_for_delivery';
  }

  if (s === 'confirmed' || s === 'scheduled-confirmed') {
    // Prefer the customer-confirmed delivery date for classification
    const confirmedDate =
      parseOptDate(d.confirmedDeliveryDate) ??
      parseOptDate(d.customerConfirmedAt);

    if (confirmedDate) {
      // Auto-delay: confirmed date has passed without delivery
      if (isOverdue(confirmedDate)) return 'order_delay';
      const tier = classifyConfirmedDate(confirmedDate);
      if (tier === 'tomorrow') return 'tomorrow_shipment';
      if (tier === 'next') return 'next_shipment';
      return 'future_shipment';
    }

    // Fallback: use metadata scheduledDate (admin-set)
    const target =
      parseOptDate(d.metadata?.scheduledDate) ??
      parseOptDate((d.metadata as Record<string, unknown> | null)?.scheduled_date) ??
      (d.estimatedTime instanceof Date ? d.estimatedTime : parseOptDate(d.estimatedTime));

    if (target) {
      if (isOverdue(target)) return 'order_delay';
      const tier = classifyConfirmedDate(target);
      if (tier === 'tomorrow') return 'tomorrow_shipment';
      if (tier === 'next') return 'next_shipment';
      if (tier === 'future') return 'future_shipment';
    }
    return 'confirmed'; // no date info — generic confirmed
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

  const confirmedDeliveryDate =
    parseOptDate(delivery.confirmedDeliveryDate) ??
    parseOptDate(delivery.customerConfirmedAt);

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
    smsSentAt: smsSentAt,
    confirmedAt,
    scheduledDate: scheduledDate ?? (['scheduled', 'next_shipment', 'future_shipment'].includes(status) ? parseOptDate(delivery.estimatedTime) : undefined),
    confirmedDeliveryDate,
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
    case 'tomorrow_shipment':
    case 'next_shipment':
    case 'future_shipment':
      return { apiStatus: 'scheduled-confirmed', updateData: { metadata: meta as Delivery['metadata'] } };
    case 'scheduled':
      return { apiStatus: 'scheduled-confirmed', updateData: { metadata: meta as Delivery['metadata'] } };
    case 'order_delay':
      return { apiStatus: 'order-delay', updateData: { metadata: meta as Delivery['metadata'] } };
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
