"use strict";
/**
 * File ingestion orchestrator.
 *
 * This is the SAME business logic as the manual upload endpoint in
 * `src/server/api/deliveries.ts` (POST /api/deliveries/upload), but driven by
 * a parsed file instead of a pre-parsed JSON payload posted from the browser.
 *
 * Design rule: REUSE the existing services (upsertDeliveryByBusinessKey,
 * autoAssignDelivery) instead of duplicating them. This guarantees that
 * auto-ingested deliveries behave identically to manually-uploaded ones.
 *
 * No UI changes required — the admin notification row created at the end
 * is picked up by the existing bell poller (15s) and all 3 portals refresh
 * their delivery lists every 60s.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ingestFile = ingestFile;
const crypto_1 = require("crypto");
const prisma_1 = __importDefault(require("../../db/prisma"));
const deliveryDedupService_1 = require("../deliveryDedupService");
// autoAssignmentService is CommonJS; keep the require pattern used elsewhere.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { autoAssignDelivery } = require('../autoAssignmentService');
const parser_1 = require("./parser");
const validator_1 = require("./validator");
function buildBusinessKey(poNumber, deliveryNumber) {
    const normalize = (v) => {
        if (v === null || v === undefined)
            return null;
        const s = String(v).trim();
        return s ? s.toUpperCase() : null;
    };
    const po = normalize(poNumber);
    const dn = normalize(deliveryNumber);
    if (!po || !dn)
        return null;
    return `${po}::${dn}`;
}
/**
 * Main entry point for auto-ingested files.
 * Returns a structured summary; never throws for row-level errors (they go in
 * `errors[]`). Only throws for catastrophic failures (corrupt file, DB down).
 */
async function ingestFile(opts) {
    const started = Date.now();
    const ingestionId = `ing-${new Date().toISOString().replace(/[:.]/g, '-')}-${(0, crypto_1.randomUUID)().slice(0, 8)}`;
    console.log(`[Ingest] Starting ingestion ${ingestionId} from ${opts.source} file="${opts.filename || '<buffer>'}"`);
    // 1. Parse
    const { rows } = (0, parser_1.parseFileBuffer)(opts.buffer, opts.filename);
    // 2. Validate — uses the same rules as manual upload (requires customer/address/lat/lng/items).
    //    If the incoming file is a raw SAP/ERP export without these mapped columns, it will fail
    //    validation here — that is intentional: auto-ingest expects a file already normalised to
    //    the portal's column format, same as what the frontend transformer produces.
    const validation = (0, validator_1.validateDeliveryData)(rows);
    if (!validation.isValid) {
        return {
            ingestionId,
            filename: opts.filename || null,
            parsed: rows.length,
            saved: 0,
            dispatched: 0,
            updated: 0,
            duplicate: 0,
            rejected: 0,
            errors: validation.errors,
            warnings: validation.warnings,
            savedDeliveryIds: [],
            durationMs: Date.now() - started,
        };
    }
    // 3. Upsert each row using the SAME service the manual upload uses.
    const outcomeCounts = { new: 0, dispatched: 0, updated: 0, duplicate: 0, rejected: 0 };
    const savedIds = [];
    const dispatchedIds = [];
    const errors = [...validation.errors];
    for (let i = 0; i < validation.validData.length; i++) {
        const row = validation.validData[i];
        const deliveryId = row.id && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(row.id)
            ? row.id
            : (0, crypto_1.randomUUID)();
        const poNumberToSave = (row.poNumber || row._originalPONumber || null);
        const deliveryNumberToSave = ((row._deliveryNumber || row._originalDeliveryNumber) ?? null);
        const goodsMovementDateRaw = row._goodsMovementDate || row.goodsMovementDate || null;
        const goodsMovementDateToSave = goodsMovementDateRaw
            ? (() => {
                const d = new Date(String(goodsMovementDateRaw));
                return isNaN(d.getTime()) ? null : d.toISOString();
            })()
            : null;
        const metadata = {
            originalPONumber: row._originalPONumber,
            originalDeliveryNumber: row._originalDeliveryNumber,
            ingestedFrom: opts.source,
            ingestionId,
            filename: opts.filename || null,
            ingestedAt: new Date().toISOString(),
        };
        try {
            const upsertResult = await (0, deliveryDedupService_1.upsertDeliveryByBusinessKey)({
                prisma: prisma_1.default,
                source: opts.source,
                incoming: {
                    id: deliveryId,
                    deliveryNumber: deliveryNumberToSave,
                    goodsMovementDate: goodsMovementDateToSave,
                    customer: row.customer,
                    address: row.address,
                    phone: row.phone || null,
                    poNumber: poNumberToSave,
                    lat: row.lat,
                    lng: row.lng,
                    status: row.status || 'pending',
                    items: typeof row.items === 'string' ? row.items : JSON.stringify(row.items),
                    metadata,
                    businessKey: buildBusinessKey(poNumberToSave, deliveryNumberToSave),
                },
            });
            if (upsertResult.conflict) {
                outcomeCounts.rejected += 1;
                errors.push(`Row ${i + 2}: ${upsertResult.conflict}`);
                continue;
            }
            const outcome = upsertResult.outcome;
            outcomeCounts[outcome] += 1;
            if (!upsertResult.skipped) {
                savedIds.push(upsertResult.delivery.id);
            }
            if (outcome === 'dispatched' || (outcome === 'new' && upsertResult.gmdUpdated)) {
                dispatchedIds.push(upsertResult.delivery.id);
            }
        }
        catch (err) {
            const e = err;
            console.error(`[Ingest] Row ${i + 2} upsert failed:`, e.message);
            errors.push(`Row ${i + 2}: ${e.message}`);
            outcomeCounts.rejected += 1;
        }
    }
    // 4. Auto-assign drivers for dispatched rows (same as manual upload).
    //    We do NOT await each — they are non-critical to the response path.
    //    Wrap the awaited block in its own try/catch so a single failure doesn't
    //    poison the whole ingestion result.
    if (dispatchedIds.length > 0) {
        console.log(`[Ingest] Auto-assigning drivers for ${dispatchedIds.length} dispatched deliveries`);
        for (const id of dispatchedIds) {
            try {
                const existing = await prisma_1.default.deliveryAssignment.findFirst({
                    where: { deliveryId: id, status: { in: ['assigned', 'in_progress'] } },
                });
                if (!existing) {
                    await autoAssignDelivery(id);
                }
            }
            catch (assignErr) {
                console.warn(`[Ingest] Auto-assign failed for ${id}:`, assignErr.message);
            }
        }
    }
    // 5. Admin notification — triggers the bell in all portals within 15s.
    //    Shape matches the existing 'status_changed' / 'gmd_upload' notifications
    //    so the frontend renders it the same way.
    const savedTotal = outcomeCounts.new + outcomeCounts.dispatched + outcomeCounts.updated;
    try {
        await prisma_1.default.adminNotification.create({
            data: {
                type: 'upload_completed',
                title: `Auto-ingested ${savedTotal} deliveries from ${opts.filename || 'OneDrive'}`,
                message: `${outcomeCounts.new} new, ${outcomeCounts.dispatched} dispatched, ${outcomeCounts.updated} updated, ${outcomeCounts.duplicate} duplicate, ${outcomeCounts.rejected} rejected`,
                payload: {
                    ingestionId,
                    source: opts.source,
                    filename: opts.filename || null,
                    summary: outcomeCounts,
                    errorCount: errors.length,
                },
            },
        });
    }
    catch (notifErr) {
        console.warn(`[Ingest] Failed to create admin notification:`, notifErr.message);
    }
    const result = {
        ingestionId,
        filename: opts.filename || null,
        parsed: rows.length,
        saved: savedTotal,
        dispatched: outcomeCounts.dispatched,
        updated: outcomeCounts.updated,
        duplicate: outcomeCounts.duplicate,
        rejected: outcomeCounts.rejected,
        errors,
        warnings: validation.warnings,
        savedDeliveryIds: savedIds,
        durationMs: Date.now() - started,
    };
    console.log(`[Ingest] ${ingestionId} complete in ${result.durationMs}ms — parsed=${result.parsed}, saved=${result.saved}, errors=${result.errors.length}`);
    return result;
}
