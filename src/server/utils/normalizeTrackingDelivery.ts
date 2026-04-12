/**
 * SAP/OData `/Deliveries` rows use varying property names. Tracking merges them
 * with Prisma-shaped deliveries — map common aliases so portals show PO, phone, etc.
 */

function firstStr(...vals: unknown[]): string | null {
  for (const v of vals) {
    if (v == null) continue;
    const s = String(v).trim();
    if (s && s !== 'null' && s !== 'undefined') return s;
  }
  return null;
}

function parseDateField(v: unknown): Date | null {
  if (v == null) return null;
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v;
  const s = String(v).trim();
  if (!s) return null;
  const ms = /^\/Date\((\d+)\)\/$/.exec(s);
  if (ms) {
    const t = Number(ms[1]);
    return Number.isFinite(t) ? new Date(t) : null;
  }
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Normalize a raw delivery object (typically SAP-only) to the same core fields
 * as `tracking.ts` Prisma mapping.
 */
export function normalizeSapDeliveryForTracking(raw: Record<string, unknown>): Record<string, unknown> {
  const id = firstStr(raw.id, raw.ID, raw.DeliveryDocument, raw.DeliveryID);
  if (!id) return raw;

  const customer =
    firstStr(raw.customer, raw.CustomerName, raw.customerName, raw.Name, raw.CompanyName, raw.ShipToPartyName, raw.SoldToPartyName) ?? null;
  const phone =
    firstStr(raw.phone, raw.Phone, raw.MobilePhone, raw.Telephone, raw.Mobile, raw.customerPhone, raw.CustomerPhone) ?? null;
  const address =
    firstStr(raw.address, raw.Address, raw.deliveryAddress, raw.DeliveryAddress, raw.Street, raw.ShipToAddress) ?? null;
  const poNumber =
    firstStr(raw.poNumber, raw.PONumber, raw.PurchaseOrder, raw.CustomerPONumber, raw['Cust. PO Number'], raw['PO Number']) ?? null;
  const deliveryNumber =
    firstStr(
      raw.deliveryNumber,
      raw.DeliveryNumber,
      raw['Delivery number'],
      raw.DeliveryDocument,
      raw.Delivery,
    ) ?? null;
  const status = (firstStr(raw.status, raw.Status, raw.OverallDeliveryStatus) ?? 'pending').toLowerCase();
  const items = firstStr(raw.items, raw.Items, raw.Description, raw.MaterialDescription) ?? null;

  const confirmedDeliveryDate =
    parseDateField(raw.confirmedDeliveryDate) ??
    parseDateField(raw.CustomerRequestedDate) ??
    parseDateField(raw.RequestedDeliveryDate) ??
    parseDateField(raw['Delivery Date']);
  const goodsMovementDate =
    parseDateField(raw.goodsMovementDate) ??
    parseDateField(raw.GoodsMovementDate) ??
    parseDateField(raw.PostingDate);

  const now = new Date();
  const meta: Record<string, unknown> = {
    ...(typeof raw.metadata === 'object' && raw.metadata !== null ? (raw.metadata as Record<string, unknown>) : {}),
    originalRow: { ...raw },
    originalPONumber: poNumber ?? undefined,
    originalDeliveryNumber: deliveryNumber ?? undefined,
  };

  return {
    id,
    customer,
    address,
    phone,
    lat: typeof raw.lat === 'number' ? raw.lat : typeof raw.Latitude === 'number' ? raw.Latitude : null,
    lng: typeof raw.lng === 'number' ? raw.lng : typeof raw.Longitude === 'number' ? raw.Longitude : null,
    status,
    items,
    metadata: meta,
    poNumber,
    created_at: now,
    createdAt: now,
    created: now,
    updatedAt: now,
    confirmationStatus: raw.confirmationStatus ?? null,
    confirmationToken: raw.confirmationToken ?? null,
    customerConfirmedAt: parseDateField(raw.customerConfirmedAt),
    confirmedDeliveryDate,
    smsSentAt: parseDateField(raw.smsSentAt),
    goodsMovementDate,
    deliveryNumber,
    assignedDriverId: null,
    driverName: null,
    assignmentStatus: 'unassigned',
    tracking: {
      assigned: false,
      driverId: null,
      status: 'unassigned',
      assignedAt: null,
      lastLocation: null,
    },
  };
}
