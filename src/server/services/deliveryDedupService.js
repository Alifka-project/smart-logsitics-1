const TERMINAL_STATUSES = new Set([
  'delivered',
  'completed',
  'delivered-with-installation',
  'delivered-without-installation',
  'cancelled',
  'canceled',
  'failed'
]);

function normalizeKeyPart(value) {
  if (value === null || value === undefined) return null;
  const str = String(value).trim();
  if (!str) return null;
  return str.toUpperCase();
}

function buildBusinessKey({ poNumber, originalDeliveryNumber }) {
  const po = normalizeKeyPart(poNumber);
  const original = normalizeKeyPart(originalDeliveryNumber);
  if (!po || !original) return null;
  return `${po}::${original}`;
}

async function findExistingDeliveryByBusinessKey(prisma, businessKey) {
  if (!businessKey) return null;
  try {
    return await prisma.delivery.findFirst({
      where: { businessKey }
    });
  } catch {
    return null;
  }
}

function mergeMetadata(existingMetadata, incomingMetadata, source) {
  const now = new Date().toISOString();
  return {
    ...(existingMetadata || {}),
    ...(incomingMetadata || {}),
    lastImportedAt: now,
    lastSource: source || 'unknown'
  };
}

async function upsertDeliveryByBusinessKey({ prisma, source, incoming }) {
  const { businessKey } = incoming;

  let existing = await findExistingDeliveryByBusinessKey(prisma, businessKey);

  if (!existing && incoming.id) {
    try {
      existing = await prisma.delivery.findUnique({
        where: { id: incoming.id }
      });
    } catch {
      existing = null;
    }
  }

  if (existing) {
    const isTerminal = TERMINAL_STATUSES.has((existing.status || '').toLowerCase());

    const updateData = {
      customer: incoming.customer ?? existing.customer,
      address: incoming.address ?? existing.address,
      phone: incoming.phone ?? existing.phone,
      poNumber: incoming.poNumber ?? existing.poNumber,
      lat: incoming.lat ?? existing.lat,
      lng: incoming.lng ?? existing.lng,
      items: incoming.items ?? existing.items,
      metadata: mergeMetadata(existing.metadata, incoming.metadata, source),
      businessKey: businessKey || existing.businessKey || null,
      updatedAt: new Date()
    };

    if (!isTerminal && incoming.status) {
      updateData.status = incoming.status;
    }

    const updated = await prisma.delivery.update({
      where: { id: existing.id },
      data: updateData
    });

    try {
      await prisma.deliveryEvent.create({
        data: {
          deliveryId: existing.id,
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

  const createData = {
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
  });

  return {
    delivery: created,
    existed: false
  };
}

module.exports = {
  buildBusinessKey,
  findExistingDeliveryByBusinessKey,
  upsertDeliveryByBusinessKey
};

