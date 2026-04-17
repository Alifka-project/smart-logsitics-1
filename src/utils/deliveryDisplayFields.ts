import type { Delivery } from '../types';

function str(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  if (!s || s === 'null' || s === 'undefined') return null;
  return s;
}

/** Excel / SAP upload row attached to metadata */
export function getDeliveryOriginalRow(delivery: Delivery): Record<string, unknown> {
  const meta = (delivery.metadata ?? {}) as Record<string, unknown>;
  const row = meta.originalRow ?? meta._originalRow;
  if (row && typeof row === 'object') return row as Record<string, unknown>;
  return {};
}

/** PO / order id for operations table — DB column plus metadata / upload row / SAP aliases */
export function displayPoNumber(delivery: Delivery): string {
  const meta = (delivery.metadata ?? {}) as Record<string, unknown>;
  const orig = getDeliveryOriginalRow(delivery);
  const rec = delivery as unknown as Record<string, unknown>;
  const v =
    str(delivery.poNumber) ??
    str(meta.originalPONumber) ??
    str(orig['PO Number']) ??
    str(orig['PO#']) ??
    str(orig['Cust. PO Number']) ??
    str(orig['PONumber']) ??
    str(orig['Purchase Order']) ??
    str(orig['PO Ref']) ??
    str(orig['Order Number']) ??
    str(rec['_originalPONumber']) ??
    str(rec['PONumber']) ??
    str(rec['poNumber']);
  return v ?? '—';
}

export function displayPhone(delivery: Delivery): string {
  const meta = (delivery.metadata ?? {}) as Record<string, unknown>;
  const orig = getDeliveryOriginalRow(delivery);
  const rec = delivery as unknown as Record<string, unknown>;
  const v =
    str(delivery.phone) ??
    str(meta.phone) ??
    str(meta.customerPhone) ??
    str(orig['Phone']) ??
    str(orig['Mobile']) ??
    str(orig['Mobile Number']) ??
    str(orig['Telephone']) ??
    str(orig['Tel']) ??
    str(rec['customerPhone']) ??
    str(rec['phoneNumber']);
  return v ?? '—';
}

export function displayDeliveryNumber(delivery: Delivery): string {
  const meta = (delivery.metadata ?? {}) as Record<string, unknown>;
  const orig = getDeliveryOriginalRow(delivery);
  const rec = delivery as unknown as Record<string, unknown>;
  const v =
    str(delivery.deliveryNumber) ??
    str(meta.originalDeliveryNumber) ??
    str(meta.sapDeliveryNumber) ??
    str(orig['Delivery number']) ??
    str(orig['Delivery Number']) ??
    str(orig['Delivery']) ??
    str(rec['_originalDeliveryNumber']);
  return v ?? '—';
}

export function displayCustomerName(delivery: Delivery): string {
  const orig = getDeliveryOriginalRow(delivery);
  // Determine B2B/B2C from the source row — same logic as getOrderType
  const shipToName = str(orig['Ship-to Name'] ?? orig['Ship to Name'] ?? orig['ShipToName'] ?? orig['Ship-To Name']);
  const individualName = str(orig['Name']);

  // B2B: use ship-to / company name
  if (shipToName) return shipToName;
  // B2C: use individual name
  if (individualName) return individualName;

  // Legacy fallback — data uploaded before originalRow was captured
  const meta = (delivery.metadata ?? {}) as Record<string, unknown>;
  const rec = delivery as unknown as Record<string, unknown>;
  return (
    str(delivery.customer) ??
    str(meta.customerName) ??
    str(orig['Customer']) ??
    str(rec['customerName']) ??
    '—'
  );
}

/**
 * Determine order type: B2B if Ship-to Name variant present (company/party order),
 * B2C if individual Name field present but no Ship-to Name.
 */
export function getOrderType(delivery: Delivery): 'B2C' | 'B2B' {
  const orig = getDeliveryOriginalRow(delivery);
  // If any Ship-to Name variant is present → always B2B (company/party order)
  const shipToName = orig['Ship-to Name'] ?? orig['Ship to Name'] ?? orig['ShipToName'] ?? orig['Ship-To Name'];
  if (shipToName && String(shipToName).trim().length > 0) return 'B2B';
  // No Ship-to Name → B2C if individual Name field present
  const name = orig['Name'];
  return (name && String(name).trim().length > 0) ? 'B2C' : 'B2B';
}

export function displayCityForOps(delivery: Delivery): string {
  const meta = (delivery.metadata ?? {}) as Record<string, unknown>;
  const orig = getDeliveryOriginalRow(delivery);
  const rec = delivery as unknown as Record<string, unknown>;
  const v =
    str(meta.originalCity) ??
    str(orig['City']) ??
    str(orig['city']) ??
    str(orig['Ship-to City']) ??
    str(orig['Ship to City']) ??
    str(rec['_originalCity']);
  return v ?? '—';
}

export function displayModelForOps(delivery: Delivery): string {
  const orig = getDeliveryOriginalRow(delivery);
  const v =
    str(orig['MODEL ID']) ??
    str(orig['Model ID']) ??
    str(orig['model_id']) ??
    str(orig['Model']) ??
    str(orig['model']) ??
    str(orig['Material']) ??
    str(orig['Matnr']);
  return v ?? '—';
}

export function displayMaterialForOps(delivery: Delivery): string {
  const orig = getDeliveryOriginalRow(delivery);
  const v =
    str(orig['Material']) ??
    str(orig['material']) ??
    str(orig['Material Number']) ??
    str(orig['PNC']) ??
    str(orig['Matnr']);
  return v ?? '—';
}

export function displayDescriptionForOps(delivery: Delivery): string {
  const meta = (delivery.metadata ?? {}) as Record<string, unknown>;
  const orig = getDeliveryOriginalRow(delivery);
  const v =
    str(orig['Description']) ??
    str(orig['description']) ??
    str(meta['description']) ??
    str(meta['items']) ??
    str(delivery.items);
  return v ?? '—';
}
