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

interface BusinessKeyInput {
  poNumber?: string | null;
  originalDeliveryNumber?: string | null;
}

interface IncomingDelivery {
  id?: string;
  businessKey?: string | null;
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

interface UpsertResult {
  delivery: Record<string, unknown>;
  existed: boolean;
}

function normalizeKeyPart(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const str = String(value).trim();
  if (!str) return null;
  return str.toUpperCase();
}

function buildBusinessKey({ poNumber, originalDeliveryNumber }: BusinessKeyInput): string | null {
  const po = normalizeKeyPart(poNumber);
  const original = normalizeKeyPart(originalDeliveryNumber);
  if (!po || !original) return null;
  return `${po}::${original}`;
}

async function findExistingDeliveryByBusinessKey(
  prisma: PrismaClient,
  businessKey: string | null
): Promise<Record<string, unknown> | null> {
  if (!businessKey) return null;
  try {
    return await prisma.delivery.findFirst({
      where: { businessKey } as Record<string, unknown>
    }) as Record<string, unknown> | null;
  } catch {
    return null;
  }
}

function mergeMetadata(
  existingMetadata: Record<string, unknown> | null | undefined,
  incomingMetadata: Record<string, unknown> | null | undefined,
  source: string | undefined
): Record<string, unknown> {
  const now = new Date().toISOString();
  return {
    ...(existingMetadata || {}),
    ...(incomingMetadata || {}),
    lastImportedAt: now,
    lastSource: source || 'unknown'
  };
}

async function upsertDeliveryByBusinessKey({ prisma, source, incoming }: UpsertOptions): Promise<UpsertResult> {
  const { businessKey } = incoming;

  let existing = await findExistingDeliveryByBusinessKey(prisma, businessKey ?? null);

  if (!existing && incoming.id) {
    try {
      existing = await prisma.delivery.findUnique({
        where: { id: incoming.id }
      }) as Record<string, unknown> | null;
    } catch {
      existing = null;
    }
  }

  if (existing) {
    const isTerminal = TERMINAL_STATUSES.has((existing.status as string || '').toLowerCase());

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
      updatedAt: new Date()
    };

    if (!isTerminal && incoming.status) {
      updateData.status = incoming.status;
    }

    const updated = await prisma.delivery.update({
      where: { id: existing.id as string },
      data: updateData
    }) as Record<string, unknown>;

    try {
      await (prisma as any).deliveryEvent.create({
        data: {
          deliveryId: existing.id as string,
          eventType: 'duplicate_upload',
          payload: {
            source: source || 'unknown',
            previousStatus: existing.status,
            newStatus: updated.status,
            businessKey,
            updatedAt: new Date().toISOString()
          },
          actorType: 'system',
          actorId: null
        }
      });
    } catch {
      // non-critical
    }

    return {
      delivery: updated,
      existed: true
    };
  }

  const createData: Record<string, unknown> = {
    customer: incoming.customer || null,
    address: incoming.address || null,
    phone: incoming.phone || null,
    poNumber: incoming.poNumber || null,
    lat: incoming.lat != null ? Number(incoming.lat) : null,
    lng: incoming.lng != null ? Number(incoming.lng) : null,
    status: incoming.status || 'pending',
    items: incoming.items || null,
    metadata: mergeMetadata(null, incoming.metadata, source),
    businessKey: businessKey || null
  };

  if (incoming.id) {
    createData.id = incoming.id;
  }

  const created = await prisma.delivery.create({
    data: createData
  }) as Record<string, unknown>;

  return {
    delivery: created,
    existed: false
  };
}

export {
  buildBusinessKey,
  findExistingDeliveryByBusinessKey,
  upsertDeliveryByBusinessKey
};
