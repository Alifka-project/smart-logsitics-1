import { PrismaClient } from '@prisma/client';

const TERMINAL_STATUSES = new Set([
  'delivered',
  'completed',
  'delivered-with-installation',
  'delivered-without-installation',
  'cancelled',
  'canceled',
  'failed'
]);

interface IncomingDelivery {
  id?: string;
  businessKey?: string | null;
  /** Globally unique delivery number (primary dedup key). */
  deliveryNumber?: string | null;
  /** Goods Movement Date — ISO string or null. Null means not yet dispatched. */
  goodsMovementDate?: string | null;
  customer?: string | null;
  address?: string | null;
  phone?: string | null;
  poNumber?: string | null;
  lat?: number | string | null;
  lng?: number | string | null;
  status?: string | null;
  items?: string | null;
  metadata?: Record<string, unknown> | null;
}

interface UpsertOptions {
  prisma: PrismaClient;
  source: string;
  incoming: IncomingDelivery;
}

export interface UpsertResult {
  delivery: Record<string, unknown>;
  existed: boolean;
  /** True when the record was skipped (duplicate) or rejected (PO conflict). */
  skipped: boolean;
  /** Set when the delivery number belongs to a different PO — reject. */
  conflict?: string;
  /** True when Goods Movement Date was provided for the first time (triggers out-for-delivery). */
  gmdUpdated: boolean;
  /**
   * Plain-language outcome of the upload for this delivery row.
   * - 'new'        – first time this delivery number is seen; record created
   * - 'dispatched' – Goods Movement Date received → delivery is now Out for Delivery
   * - 'updated'    – Goods Movement Date date changed (was already set previously)
   * - 'duplicate'  – same delivery number, same PO, no new information; no change made
   * - 'rejected'   – delivery number already registered under a different PO
   */
  outcome: 'new' | 'dispatched' | 'updated' | 'duplicate' | 'rejected';
}

function normalizeKeyPart(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const str = String(value).trim();
  if (!str) return null;
  return str.toUpperCase();
}

function buildBusinessKey(poNumber: string | null | undefined, deliveryNumber: string | null | undefined): string | null {
  const po = normalizeKeyPart(poNumber);
  const dn = normalizeKeyPart(deliveryNumber);
  if (!po || !dn) return null;
  return `${po}::${dn}`;
}

function mergeMetadata(
  existing: Record<string, unknown> | null | undefined,
  incoming: Record<string, unknown> | null | undefined,
  source: string | undefined
): Record<string, unknown> {
  return {
    ...(existing || {}),
    ...(incoming || {}),
    lastImportedAt: new Date().toISOString(),
    lastSource: source || 'unknown',
  };
}

async function findByDeliveryNumber(
  prisma: PrismaClient,
  deliveryNumber: string | null
): Promise<Record<string, unknown> | null> {
  if (!deliveryNumber) return null;
  try {
    return await prisma.delivery.findFirst({
      where: { deliveryNumber } as Record<string, unknown>,
    }) as Record<string, unknown> | null;
  } catch {
    return null;
  }
}

async function findByBusinessKey(
  prisma: PrismaClient,
  businessKey: string | null
): Promise<Record<string, unknown> | null> {
  if (!businessKey) return null;
  try {
    return await prisma.delivery.findFirst({
      where: { businessKey } as Record<string, unknown>,
    }) as Record<string, unknown> | null;
  } catch {
    return null;
  }
}

async function logEvent(
  prisma: PrismaClient,
  deliveryId: string,
  eventType: string,
  payload: Record<string, unknown>
): Promise<void> {
  try {
    await (prisma as unknown as { deliveryEvent: { create: (args: unknown) => Promise<unknown> } }).deliveryEvent.create({
      data: {
        deliveryId,
        eventType,
        payload,
        actorType: 'system',
        actorId: null,
      },
    });
  } catch {
    // non-critical
  }
}

export async function upsertDeliveryByBusinessKey({
  prisma,
  source,
  incoming,
}: UpsertOptions): Promise<UpsertResult> {
  // ─── Normalise keys ──────────────────────────────────────────────────────
  const normDeliveryNumber = normalizeKeyPart(
    incoming.deliveryNumber ??
    (incoming.metadata as Record<string, unknown> | null | undefined)?.originalDeliveryNumber
  );
  const normPO = normalizeKeyPart(incoming.poNumber);
  const businessKey = buildBusinessKey(normPO, normDeliveryNumber);

  const hasIncomingGMD = !!(incoming.goodsMovementDate && String(incoming.goodsMovementDate).trim());
  const incomingGMDDate = hasIncomingGMD ? new Date(incoming.goodsMovementDate as string) : null;
  const validIncomingGMD = incomingGMDDate && !isNaN(incomingGMDDate.getTime()) ? incomingGMDDate : null;

  // ─── Find existing record ─────────────────────────────────────────────────
  let existing: Record<string, unknown> | null = null;

  // 1. Primary: by normalised delivery number
  if (normDeliveryNumber) {
    existing = await findByDeliveryNumber(prisma, normDeliveryNumber);
  }
  // 2. Legacy fallback: by business key
  if (!existing && businessKey) {
    existing = await findByBusinessKey(prisma, businessKey);
  }
  // 3. Last resort: by ID (e.g. browser re-upload of same record)
  if (!existing && incoming.id) {
    try {
      existing = await prisma.delivery.findUnique({
        where: { id: incoming.id },
      }) as Record<string, unknown> | null;
    } catch {
      existing = null;
    }
  }

  // ─── EXISTING RECORD ──────────────────────────────────────────────────────
  if (existing) {
    // ── PO conflict check ────────────────────────────────────────────────────
    const existingNormPO = normalizeKeyPart(existing.poNumber);
    if (normPO && existingNormPO && normPO !== existingNormPO) {
      // Same delivery number, different PO → hard conflict, reject
      return {
        delivery: existing,
        existed: true,
        skipped: true,
        conflict: `Delivery number "${normDeliveryNumber}" is already registered under PO "${existing.poNumber}". It cannot be assigned to PO "${incoming.poNumber}".`,
        gmdUpdated: false,
        outcome: 'rejected',
      };
    }

    const isTerminal = TERMINAL_STATUSES.has(
      ((existing.status as string) || '').toLowerCase()
    );
    const existingGMD = existing.goodsMovementDate as Date | null;
    const hasExistingGMD = !!(existingGMD);

    // ── No new information (both GMD blank) → skip ────────────────────────
    if (!validIncomingGMD && !hasExistingGMD) {
      // Pure duplicate — nothing to update
      await logEvent(prisma, existing.id as string, 'duplicate_upload', {
        source,
        reason: 'no_gmd_both_sides',
        businessKey,
        deliveryNumber: normDeliveryNumber,
      });
      return { delivery: existing, existed: true, skipped: true, gmdUpdated: false, outcome: 'duplicate' };
    }

    // ── Incoming blank but existing has GMD → don't downgrade → skip ─────
    if (!validIncomingGMD && hasExistingGMD) {
      await logEvent(prisma, existing.id as string, 'duplicate_upload', {
        source,
        reason: 'no_gmd_incoming_but_existing_has_gmd',
        businessKey,
        deliveryNumber: normDeliveryNumber,
      });
      return { delivery: existing, existed: true, skipped: true, gmdUpdated: false, outcome: 'duplicate' };
    }

    // ── Incoming has GMD → UPDATE ──────────────────────────────────────────
    const gmdUpdated = !hasExistingGMD; // first time GMD is set
    const prevStatus = (existing.status as string) || 'pending';

    // Determine new status: if GMD just arrived and order is not terminal,
    // automatically move to out-for-delivery (warehouse dispatched it)
    let newStatus = prevStatus;
    if (gmdUpdated && !isTerminal) {
      newStatus = 'out-for-delivery';
    }

    const updateData: Record<string, unknown> = {
      customer: incoming.customer ?? existing.customer,
      address: incoming.address ?? existing.address,
      phone: incoming.phone ?? existing.phone,
      poNumber: incoming.poNumber ?? existing.poNumber,
      lat: incoming.lat ?? existing.lat,
      lng: incoming.lng ?? existing.lng,
      items: incoming.items ?? existing.items,
      metadata: mergeMetadata(
        existing.metadata as Record<string, unknown> | null,
        incoming.metadata,
        source
      ),
      businessKey: businessKey || existing.businessKey || null,
      deliveryNumber: normDeliveryNumber || existing.deliveryNumber || null,
      goodsMovementDate: validIncomingGMD,
      updatedAt: new Date(),
    };
    if (!isTerminal) updateData.status = newStatus;

    const updated = await prisma.delivery.update({
      where: { id: existing.id as string },
      data: updateData,
    }) as Record<string, unknown>;

    await logEvent(prisma, existing.id as string, gmdUpdated ? 'gmd_received_dispatch' : 'gmd_updated', {
      source,
      previousStatus: prevStatus,
      newStatus,
      gmdUpdated,
      goodsMovementDate: validIncomingGMD?.toISOString(),
      businessKey,
      deliveryNumber: normDeliveryNumber,
    });

    return { delivery: updated, existed: true, skipped: false, gmdUpdated, outcome: gmdUpdated ? 'dispatched' : 'updated' };
  }

  // ─── NEW RECORD ───────────────────────────────────────────────────────────
  // Determine initial status: if GMD provided, auto-dispatch; else pending
  const initialStatus = validIncomingGMD ? 'out-for-delivery' : (incoming.status || 'pending');

  const createData: Record<string, unknown> = {
    customer: incoming.customer || null,
    address: incoming.address || null,
    phone: incoming.phone || null,
    poNumber: incoming.poNumber || null,
    lat: incoming.lat != null ? Number(incoming.lat) : null,
    lng: incoming.lng != null ? Number(incoming.lng) : null,
    status: initialStatus,
    items: incoming.items || null,
    metadata: mergeMetadata(null, incoming.metadata, source),
    businessKey: businessKey || null,
    deliveryNumber: normDeliveryNumber || null,
    goodsMovementDate: validIncomingGMD || null,
  };
  if (incoming.id) {
    createData.id = incoming.id;
  }

  const created = await prisma.delivery.create({ data: createData }) as Record<string, unknown>;

  // If GMD was present on a brand-new record, log that dispatch was already signalled at creation.
  if (validIncomingGMD) {
    await logEvent(prisma, created.id as string, 'gmd_received_dispatch', {
      source,
      reason: 'new_record_with_gmd',
      newStatus: initialStatus,
      goodsMovementDate: validIncomingGMD.toISOString(),
      businessKey,
      deliveryNumber: normDeliveryNumber,
    });
  }

  return { delivery: created, existed: false, skipped: false, gmdUpdated: !!validIncomingGMD, outcome: 'new' };
}

export { buildBusinessKey, normalizeKeyPart };
