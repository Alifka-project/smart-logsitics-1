import type { Delivery } from '../types';
import type { DeliveryOrder, DeliveryStatus } from '../types/delivery';
import { getOrderType } from './deliveryDisplayFields';

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
 * Returns how many calendar days from today the NEXT delivery day is.
 * UAE rule: Sunday = no deliveries.
 *   - Today is Saturday → tomorrow is Sunday (no delivery) → next delivery day = Monday (+2)
 *   - All other days → next delivery day = tomorrow (+1)
 */
export function nextDeliveryDayOffset(): number {
  // 0=Sun, 1=Mon, …, 6=Sat in Dubai local time (UTC+4 approx)
  const dubaiDay = new Date(Date.now() + 4 * 60 * 60 * 1000).getUTCDay();
  return dubaiDay === 6 ? 2 : 1; // Saturday → skip Sunday → Monday is +2
}

/**
 * Classify a confirmedDeliveryDate relative to Dubai "today" into a shipment tier.
 * - 'next'   : Exactly tomorrow → Next Shipment
 * - 'future' : 2+ days out → Future Schedule
 */
export function classifyConfirmedDate(date: Date): 'next' | 'future' {
  const diffDays = calDiffFromTodayDubai(date);
  if (diffDays === 1) return 'next'; // Tomorrow only → Next Shipment
  return 'future';                   // 2+ days out → Future Schedule
}

function priorityFromDelivery(d: Delivery): 'normal' | 'high' | 'urgent' | undefined {
  const n = d.priority;
  if (n === 1) return 'urgent';
  if (n === 2) return 'high';
  if (typeof n === 'number') return 'normal';
  return undefined;
}

function hasGMD(d: Delivery): boolean {
  const raw = (d as Record<string, unknown>).goodsMovementDate;
  if (!raw) return false;
  const parsed = parseOptDate(raw);
  return parsed != null;
}

function deriveWorkflowStatus(d: Delivery, smsSentAt: Date | undefined): DeliveryStatus {
  const s = (d.status || '').toLowerCase();

  // Helper: is the date's Dubai calendar day strictly before today? (overdue)
  const isOverdue = (date: Date): boolean => calDiffFromTodayDubai(date) < 0;

  // 'rejected' is an alias of 'cancelled' (customer-refused delivery). Without
  // this mapping the workflow falls through to 'uploaded' and the order keeps
  // showing up in the Pending Orders tab with the "Resend SMS" action even
  // though it is terminal.
  if (s === 'cancelled' || s === 'rejected' || s === 'canceled') return 'cancelled';
  if (s === 'order-delay') return 'order_delay';

  // Rescheduled: classify by the new confirmed delivery date.
  //   - Future date → tier classification (next_shipment / future_schedule),
  //     or out_for_delivery / ready_to_dispatch when GMD is already attached.
  //   - Today     → out_for_delivery if GMD, else next_shipment.
  //   - Past date → order_delay (overdue reschedule — needs attention). The
  //     Rescheduled tag still surfaces in the action column because isRescheduled
  //     is driven off the DB status.
  //   - No date   → stays 'rescheduled' (waiting for a new date to be set).
  if (s === 'rescheduled') {
    const confirmedDate =
      parseOptDate(d.confirmedDeliveryDate) ??
      parseOptDate(d.customerConfirmedAt);

    if (confirmedDate) {
      if (isOverdue(confirmedDate)) return 'order_delay';
      // GMD was already attached (warehouse dispatched on the first attempt).
      // Honour that state so logistics doesn't have to re-click dispatch after
      // a reschedule: if the new date is today → on route; future → ready.
      if (hasGMD(d) && calDiffFromTodayDubai(confirmedDate) === 0) return 'out_for_delivery';
      if (hasGMD(d)) return 'ready_to_dispatch';
      const tier = classifyConfirmedDate(confirmedDate);
      if (tier === 'next') return 'next_shipment';
      return 'future_schedule';
    }
    // No date set → still waiting for a new date to be picked.
    return 'rescheduled';
  }
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

  // Out-for-delivery: on-route unless the planned delivery date has already passed.
  // If the driver was dispatched but today is after the scheduled/confirmed date,
  // the order is overdue — classify as order_delay so admin can take action.
  if (['out-for-delivery', 'in-transit', 'in-progress'].includes(s)) {
    const targetDate =
      parseOptDate(d.confirmedDeliveryDate) ??
      parseOptDate(d.customerConfirmedAt) ??
      parseOptDate((d.metadata as Record<string, unknown> | null)?.scheduledDate as string) ??
      parseOptDate((d.metadata as Record<string, unknown> | null)?.scheduled_date as string);
    if (targetDate && isOverdue(targetDate)) return 'order_delay';
    // Also flag as order_delay when the Goods Movement Date (GMD) is in the past
    // but the order hasn't been delivered yet — goods were dispatched on a past date.
    const gmdDate = parseOptDate((d as Record<string, unknown>).goodsMovementDate);
    if (gmdDate && isOverdue(gmdDate)) return 'order_delay';
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
      // If GMD is set and delivery date is today → treat as on route
      if (hasGMD(d) && calDiffFromTodayDubai(confirmedDate) === 0) return 'out_for_delivery';
      // If GMD is set and delivery date is future → ready to dispatch
      if (hasGMD(d)) return 'ready_to_dispatch';
      const tier = classifyConfirmedDate(confirmedDate);
      if (tier === 'next') return 'next_shipment';
      return 'future_schedule';
    }

    // Fallback: use metadata scheduledDate (admin-set)
    const target =
      parseOptDate(d.metadata?.scheduledDate) ??
      parseOptDate((d.metadata as Record<string, unknown> | null)?.scheduled_date) ??
      (d.estimatedTime instanceof Date ? d.estimatedTime : parseOptDate(d.estimatedTime));

    if (target) {
      if (isOverdue(target)) return 'order_delay';
      // If GMD is set and target date is today → treat as on route
      if (hasGMD(d) && calDiffFromTodayDubai(target) === 0) return 'out_for_delivery';
      // If GMD is set → ready to dispatch
      if (hasGMD(d)) return 'ready_to_dispatch';
      const tier = classifyConfirmedDate(target);
      if (tier === 'next') return 'next_shipment';
      if (tier === 'future') return 'future_schedule';
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
  const materialRaw = origRow['Material'] ?? origRow['material'] ?? origRow['Material Number'] ?? origRow['PNC'] ?? origRow['Matnr'];
  const material = materialRaw != null && String(materialRaw).trim() ? String(materialRaw).trim() : undefined;
  const qtyRaw = origRow['Order Quantity'] ?? origRow['Confirmed quantity'] ?? origRow['Total Line Deliv. Qt'] ?? origRow['Order Qty'] ?? origRow['Quantity'] ?? origRow['qty'];
  const qty = qtyRaw != null && String(qtyRaw).trim() ? String(qtyRaw).trim() : undefined;

  const confirmedAt =
    parseOptDate((meta as Record<string, unknown>).confirmedAt) ??
    parseOptDate((meta as Record<string, unknown>).confirmed_at);

  const deliveryNumber =
    // Prefer the dedicated DB column (set during upload / dedup)
    ((rec.deliveryNumber as string | null | undefined) && String(rec.deliveryNumber).trim()) ||
    // Legacy fallback: stored in metadata during earlier uploads
    (meta.originalDeliveryNumber != null && String(meta.originalDeliveryNumber).trim()) ||
    (delivery._originalDeliveryNumber != null && String(delivery._originalDeliveryNumber).trim()) ||
    null;

  const confirmedDeliveryDate =
    parseOptDate(delivery.confirmedDeliveryDate) ??
    parseOptDate(delivery.customerConfirmedAt);

  const goodsMovementDate = parseOptDate((delivery as Record<string, unknown>).goodsMovementDate);

  const isRescheduled = (delivery.status || '').toLowerCase() === 'rescheduled';

  // hasPod — prefer the server-computed boolean returned by the tracking API (most accurate).
  // Fall back to local field checks when the server field is absent (e.g. non-tracking fetch).
  // Note: podCompletedAt is intentionally excluded — it is stamped automatically on ANY
  // delivery status change to a terminal state and does NOT indicate actual POD upload.
  const hasPod: boolean = delivery.hasPod === true || (
    delivery.hasPod === undefined && !!(
      delivery.driverSignature ||
      delivery.customerSignature ||
      (delivery.photos && delivery.photos.length > 0) ||
      String(delivery.status || '').toLowerCase() === 'pod-completed'
    )
  );

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
    material,
    qty,
    status,
    uploadedAt,
    smsSentAt: smsSentAt,
    confirmedAt,
    scheduledDate: scheduledDate ?? (['scheduled', 'next_shipment', 'future_schedule'].includes(status) ? parseOptDate(delivery.estimatedTime) : undefined),
    confirmedDeliveryDate,
    goodsMovementDate,
    deliveryDate: deliveredAt,
    driverId: delivery.assignedDriverId ?? undefined,
    driverName: (rec.driverName as string) || delivery.driverName || undefined,
    priority: priorityFromDelivery(delivery),
    isPriority: (delivery.metadata as Record<string, unknown> | undefined)?.isPriority === true,
    notes: delivery.deliveryNotes ?? delivery.conditionNotes ?? undefined,
    failureReason: status === 'failed' ? (delivery.conditionNotes ?? undefined) : undefined,
    isRescheduled,
    orderType: getOrderType(delivery),
    hasPod,
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
    case 'next_shipment':
    case 'future_schedule':
    case 'ready_to_dispatch':
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
