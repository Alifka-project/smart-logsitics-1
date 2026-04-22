"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.upsertDeliveryByBusinessKey = upsertDeliveryByBusinessKey;
exports.buildBusinessKey = buildBusinessKey;
exports.normalizeKeyPart = normalizeKeyPart;
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
    if (value === null || value === undefined)
        return null;
    const str = String(value).trim();
    if (!str)
        return null;
    return str.toUpperCase();
}
function buildBusinessKey(poNumber, deliveryNumber) {
    const po = normalizeKeyPart(poNumber);
    const dn = normalizeKeyPart(deliveryNumber);
    if (!po || !dn)
        return null;
    return `${po}::${dn}`;
}
function mergeMetadata(existing, incoming, source) {
    return {
        ...(existing || {}),
        ...(incoming || {}),
        lastImportedAt: new Date().toISOString(),
        lastSource: source || 'unknown',
    };
}
async function findByDeliveryNumber(prisma, deliveryNumber) {
    if (!deliveryNumber)
        return null;
    try {
        return await prisma.delivery.findFirst({
            where: { deliveryNumber },
        });
    }
    catch {
        return null;
    }
}
async function findByBusinessKey(prisma, businessKey) {
    if (!businessKey)
        return null;
    try {
        return await prisma.delivery.findFirst({
            where: { businessKey },
        });
    }
    catch {
        return null;
    }
}
async function logEvent(prisma, deliveryId, eventType, payload) {
    try {
        await prisma.deliveryEvent.create({
            data: {
                deliveryId,
                eventType,
                payload,
                actorType: 'system',
                actorId: null,
            },
        });
    }
    catch {
        // non-critical
    }
}
async function upsertDeliveryByBusinessKey({ prisma, source, incoming, }) {
    // ─── Normalise keys ──────────────────────────────────────────────────────
    const normDeliveryNumber = normalizeKeyPart(incoming.deliveryNumber ??
        incoming.metadata?.originalDeliveryNumber);
    const normPO = normalizeKeyPart(incoming.poNumber);
    const businessKey = buildBusinessKey(normPO, normDeliveryNumber);
    const hasIncomingGMD = !!(incoming.goodsMovementDate && String(incoming.goodsMovementDate).trim());
    const incomingGMDDate = hasIncomingGMD ? new Date(incoming.goodsMovementDate) : null;
    const validIncomingGMD = incomingGMDDate && !isNaN(incomingGMDDate.getTime()) ? incomingGMDDate : null;
    // ─── Find existing record ─────────────────────────────────────────────────
    let existing = null;
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
            });
        }
        catch {
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
        const isTerminal = TERMINAL_STATUSES.has((existing.status || '').toLowerCase());
        const existingGMD = existing.goodsMovementDate;
        const hasExistingGMD = !!(existingGMD);
        // ── No new information (both GMD blank) → skip ────────────────────────
        if (!validIncomingGMD && !hasExistingGMD) {
            // Pure duplicate — nothing to update
            await logEvent(prisma, existing.id, 'duplicate_upload', {
                source,
                reason: 'no_gmd_both_sides',
                businessKey,
                deliveryNumber: normDeliveryNumber,
            });
            return { delivery: existing, existed: true, skipped: true, gmdUpdated: false, outcome: 'duplicate' };
        }
        // ── Incoming blank but existing has GMD → don't downgrade → skip ─────
        if (!validIncomingGMD && hasExistingGMD) {
            await logEvent(prisma, existing.id, 'duplicate_upload', {
                source,
                reason: 'no_gmd_incoming_but_existing_has_gmd',
                businessKey,
                deliveryNumber: normDeliveryNumber,
            });
            return { delivery: existing, existed: true, skipped: true, gmdUpdated: false, outcome: 'duplicate' };
        }
        // ── Incoming has GMD → UPDATE ──────────────────────────────────────────
        const gmdUpdated = !hasExistingGMD; // first time GMD is set
        const prevStatus = existing.status || 'pending';
        // Determine new status: if GMD just arrived and order is not terminal,
        // automatically move to pgi-done (warehouse has issued goods; awaiting driver pick).
        // The driver flips through pickup-confirmed → out-for-delivery after verifying the
        // picking list and clicking Start Delivery.
        let newStatus = prevStatus;
        if (gmdUpdated && !isTerminal) {
            newStatus = 'pgi-done';
        }
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
            deliveryNumber: normDeliveryNumber || existing.deliveryNumber || null,
            goodsMovementDate: validIncomingGMD,
            updatedAt: new Date(),
        };
        if (!isTerminal)
            updateData.status = newStatus;
        const updated = await prisma.delivery.update({
            where: { id: existing.id },
            data: updateData,
        });
        await logEvent(prisma, existing.id, gmdUpdated ? 'gmd_received_dispatch' : 'gmd_updated', {
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
    // Determine initial status: if GMD provided, auto-set to pgi-done (warehouse issued
    // goods, awaiting driver pick/confirm/start). Else pending.
    const initialStatus = validIncomingGMD ? 'pgi-done' : (incoming.status || 'pending');
    const createData = {
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
    const created = await prisma.delivery.create({ data: createData });
    // If GMD was present on a brand-new record, log that dispatch was already signalled at creation.
    if (validIncomingGMD) {
        await logEvent(prisma, created.id, 'gmd_received_dispatch', {
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
