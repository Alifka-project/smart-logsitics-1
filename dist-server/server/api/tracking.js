"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_js_1 = require("../auth.js");
const sapService_js_1 = __importDefault(require("../services/sapService.js"));
const prisma_js_1 = __importDefault(require("../db/prisma.js"));
const cache_js_1 = __importDefault(require("../cache.js"));
const db = __importStar(require("../db/index.js"));
const deliveryListFilter_js_1 = require("../../utils/deliveryListFilter.js");
const normalizeTrackingDelivery_js_1 = require("../utils/normalizeTrackingDelivery.js");
const router = (0, express_1.Router)();
/**
 * Detect addresses that cannot be used for routing (e.g. "call for delivery").
 * Mirrors src/utils/addressHandler.js isUnrecognizableAddress for server-side use.
 */
const UNRECOGNIZABLE_ADDR_PATTERNS = [
    /^(call|call\s+for\s+(delivery|pickup|address|location)|call\s+customer)$/i,
    /^(tbd|to\s+be\s+(confirmed|determined|advised)|n\/a|na|none|nil|-)$/i,
    /^(pickup|warehouse|collect|collection\s+point)$/i,
    /^(see\s+notes?|as\s+instructed|contact\s+(customer|driver|office))$/i,
    /^(unknown|unspecified|no\s+address|no\s+delivery\s+address)$/i,
    /^(refer\s+to|check\s+with|pending|awaiting)$/i,
];
function isUnrecognizableAddressServer(address) {
    if (!address || typeof address !== 'string')
        return true;
    const trimmed = address.trim();
    if (trimmed.length < 5)
        return true;
    for (const p of UNRECOGNIZABLE_ADDR_PATTERNS) {
        if (p.test(trimmed))
            return true;
    }
    if (/^call\b/i.test(trimmed))
        return true;
    return false;
}
// GET /api/admin/tracking/deliveries - real-time delivery tracking
// Optimized: uses select instead of include, server-side cache (30s fresh, 2min max)
router.get('/deliveries', auth_js_1.authenticate, (0, auth_js_1.requireAnyRole)('admin', 'delivery_team', 'logistics_team'), async (req, res) => {
    try {
        const data = await cache_js_1.default.getOrFetch('tracking:deliveries:v2', async () => {
            let dbDeliveries = [];
            try {
                // Statuses permanently excluded (never shown on portal/manage tab).
                // 'rescheduled' is intentionally NOT here — rescheduled orders must
                // remain visible until the customer confirms a new date.
                const ALWAYS_EXCLUDED = ['cancelled', 'returned'];
                // Delivered-type statuses: excluded beyond 24 h unless POD is still missing.
                const DELIVERED_STATUSES = [
                    'delivered', 'delivered-with-installation', 'delivered-without-installation',
                    'completed', 'pod-completed', 'finished',
                ];
                const cutoff24h = new Date(Date.now() - 86400000); // 24 hours ago
                // Include delivered-no-POD orders up to 30 days back so logistics staff
                // can see and action them even after the 24 h window closes.
                const cutoff30d = new Date(Date.now() - 30 * 86400000);
                dbDeliveries = await prisma_js_1.default.delivery.findMany({
                    where: {
                        OR: [
                            // All active (non-terminal) deliveries
                            { status: { notIn: [...ALWAYS_EXCLUDED, ...DELIVERED_STATUSES] } },
                            // Recently delivered (last 24 h) — powers the "Delivered Today" dashboard card
                            { status: { in: DELIVERED_STATUSES }, updatedAt: { gte: cutoff24h } },
                            // Delivered WITHOUT any signature within last 30 days → must stay visible
                            // until a Proof of Delivery is uploaded.
                            // Note: photo-only POD (admin upload) sets updatedAt, so those orders
                            // are covered by the 24 h clause above and naturally drop off after 24 h.
                            {
                                status: { in: DELIVERED_STATUSES },
                                driverSignature: null,
                                customerSignature: null,
                                updatedAt: { gte: cutoff30d },
                            },
                        ],
                    },
                    select: {
                        id: true,
                        customer: true,
                        address: true,
                        phone: true,
                        lat: true,
                        lng: true,
                        status: true,
                        items: true,
                        metadata: true,
                        poNumber: true,
                        createdAt: true,
                        updatedAt: true,
                        confirmationStatus: true,
                        confirmationToken: true,
                        customerConfirmedAt: true,
                        confirmedDeliveryDate: true,
                        smsSentAt: true,
                        goodsMovementDate: true,
                        deliveryNumber: true,
                        // Driver comments (e.g. mandatory rejection reason) — needed by the
                        // View Reason button on cancelled/rejected rows.
                        deliveryNotes: true,
                        conditionNotes: true,
                        // POD indicator fields — returned to compute hasPod flag; raw values NOT forwarded to client
                        driverSignature: true,
                        customerSignature: true,
                        photos: true,
                        assignments: {
                            take: 1,
                            orderBy: { assignedAt: 'desc' },
                            select: {
                                driverId: true,
                                status: true,
                                assignedAt: true,
                                driver: {
                                    select: { fullName: true }
                                }
                            }
                        }
                    },
                    orderBy: { createdAt: 'desc' },
                    take: 600
                });
            }
            catch (err) {
                const e = err;
                console.error('[Tracking] Prisma query error:', e.message);
                dbDeliveries = [];
            }
            let deliveries = dbDeliveries.map(d => {
                // Compute hasPod server-side: true when at least one signature OR photo is present,
                // or the status is 'pod-completed' (explicit POD submission status).
                // Raw signature/photo values are intentionally NOT forwarded to the client.
                const hasPod = !!(d.driverSignature ||
                    d.customerSignature ||
                    d.status === 'pod-completed' ||
                    (Array.isArray(d.photos) && d.photos.length > 0));
                return {
                    id: d.id,
                    customer: d.customer,
                    address: d.address,
                    phone: d.phone,
                    lat: d.lat,
                    lng: d.lng,
                    status: d.status,
                    items: d.items,
                    metadata: d.metadata,
                    poNumber: d.poNumber,
                    created_at: d.createdAt,
                    createdAt: d.createdAt,
                    created: d.createdAt,
                    updatedAt: d.updatedAt,
                    confirmationStatus: d.confirmationStatus,
                    confirmationToken: d.confirmationToken,
                    customerConfirmedAt: d.customerConfirmedAt,
                    confirmedDeliveryDate: d.confirmedDeliveryDate,
                    smsSentAt: d.smsSentAt,
                    goodsMovementDate: d.goodsMovementDate,
                    deliveryNumber: d.deliveryNumber,
                    deliveryNotes: d.deliveryNotes,
                    conditionNotes: d.conditionNotes,
                    hasPod,
                    assignedDriverId: d.assignments?.[0]?.driverId || null,
                    driverName: d.assignments?.[0]?.driver?.fullName || null,
                    assignmentStatus: d.assignments?.[0]?.status || 'unassigned',
                    tracking: {
                        assigned: !!(d.assignments?.[0]?.driverId),
                        driverId: d.assignments?.[0]?.driverId || null,
                        status: d.assignments?.[0]?.status || 'unassigned',
                        assignedAt: d.assignments?.[0]?.assignedAt || null,
                        lastLocation: null
                    }
                };
            });
            try {
                const deliveriesResp = await sapService_js_1.default.call('/Deliveries', 'get');
                let sapDeliveries = [];
                const sapData = deliveriesResp.data;
                if (Array.isArray(sapData?.value)) {
                    sapDeliveries = sapData.value;
                }
                else if (Array.isArray(deliveriesResp.data)) {
                    sapDeliveries = deliveriesResp.data;
                }
                const dbDeliveryIds = new Set(deliveries.map(d => d.id));
                const newSapDeliveries = sapDeliveries.filter(d => {
                    const sapId = d.id || d.ID;
                    return sapId && !dbDeliveryIds.has(sapId);
                });
                const normalizedSap = newSapDeliveries.map((d) => (0, normalizeTrackingDelivery_js_1.normalizeSapDeliveryForTracking)(d));
                deliveries = deliveries.concat(normalizedSap);
            }
            catch (_) {
                // SAP not available, use database only
            }
            deliveries.sort((a, b) => {
                const aPhone = a.phone != null ? String(a.phone).trim() : '';
                const bPhone = b.phone != null ? String(b.phone).trim() : '';
                const aHasPhone = aPhone.length > 0;
                const bHasPhone = bPhone.length > 0;
                const aBadAddress = isUnrecognizableAddressServer(a.address);
                const bBadAddress = isUnrecognizableAddressServer(b.address);
                const aHasContact = aHasPhone && !aBadAddress;
                const bHasContact = bHasPhone && !bBadAddress;
                if (aHasContact && !bHasContact)
                    return -1;
                if (!aHasContact && bHasContact)
                    return 1;
                return 0;
            });
            return (0, deliveryListFilter_js_1.excludeTeamPortalGarbageDeliveries)(deliveries);
        }, 5000, 15000);
        res.json({
            deliveries: data,
            timestamp: new Date().toISOString()
        });
    }
    catch (err) {
        const e = err;
        console.error('tracking/deliveries error', err);
        res.status(500).json({ error: 'tracking_fetch_failed', detail: e.message });
    }
});
// GET /api/admin/tracking/drivers - real-time driver tracking
// Optimized: uses select, server-side cache, single combined query
router.get('/drivers', auth_js_1.authenticate, (0, auth_js_1.requireAnyRole)('admin', 'delivery_team', 'logistics_team'), async (req, res) => {
    try {
        const ONLINE_WINDOW_MINUTES = 15;
        const data = await cache_js_1.default.getOrFetch('tracking:drivers', async () => {
            let prismaDrivers = [];
            try {
                // For the monitoring map, show all active drivers regardless of account linkage.
                // The assignment endpoint enforces role='driver' separately; here we just need
                // to know who is in the field. Drivers without a linked account are included so
                // the map is never silently empty.
                const dbDrivers = await prisma_js_1.default.driver.findMany({
                    where: { active: true },
                    select: {
                        id: true,
                        username: true,
                        email: true,
                        phone: true,
                        fullName: true,
                        active: true,
                        account: { select: { role: true, lastLogin: true } },
                        status: { select: { status: true, updatedAt: true, currentAssignmentId: true } }
                    }
                });
                // Keep only role='driver' accounts for the assignment dropdown; drivers without
                // an account are still surfaced in monitoring with role='driver' as a safe default.
                prismaDrivers = dbDrivers.filter(d => !d.account || d.account.role === 'driver');
            }
            catch (e) {
                const err = e;
                console.warn('[Tracking] Could not fetch Prisma drivers:', err.message);
            }
            if (prismaDrivers.length === 0) {
                console.warn('[Tracking] No active drivers found in database.');
                return [];
            }
            const locationsMap = {};
            try {
                const driverIds = prismaDrivers.map(d => d.id).filter(Boolean);
                if (driverIds.length > 0) {
                    const latestRows = await db.query(`
              SELECT DISTINCT ON (driver_id)
                driver_id, latitude, longitude, heading, speed, accuracy, recorded_at
              FROM live_locations
              WHERE driver_id = ANY($1::uuid[])
              ORDER BY driver_id, recorded_at DESC
            `, [driverIds]);
                    for (const row of latestRows.rows) {
                        locationsMap[row.driver_id] = {
                            driverId: row.driver_id,
                            latitude: Number(row.latitude),
                            longitude: Number(row.longitude),
                            heading: row.heading != null ? Number(row.heading) : null,
                            speed: row.speed != null ? Number(row.speed) : null,
                            accuracy: row.accuracy != null ? Number(row.accuracy) : null,
                            recordedAt: new Date(row.recorded_at)
                        };
                    }
                }
            }
            catch (err) {
                const e = err;
                console.warn('[Tracking] Could not fetch latest live locations:', e.message);
            }
            return prismaDrivers.map(d => {
                const loc = locationsMap[d.id];
                return {
                    id: d.id,
                    username: d.username,
                    email: d.email,
                    phone: d.phone,
                    fullName: d.fullName,
                    full_name: d.fullName,
                    active: d.active,
                    role: d.account?.role || 'driver',
                    account: { role: d.account?.role || 'driver', lastLogin: d.account?.lastLogin || null },
                    tracking: {
                        online: loc ? (Date.now() - new Date(loc.recordedAt).getTime()) < ONLINE_WINDOW_MINUTES * 60 * 1000 : false,
                        location: loc ? {
                            lat: loc.latitude,
                            lng: loc.longitude,
                            heading: loc.heading,
                            speed: loc.speed,
                            accuracy: loc.accuracy,
                            timestamp: loc.recordedAt
                        } : null,
                        status: d.status?.status || 'offline',
                        lastUpdate: loc?.recordedAt || d.status?.updatedAt || null,
                        assignmentId: d.status?.currentAssignmentId || null
                    }
                };
            });
        }, 2000, 10000);
        res.json({
            drivers: data,
            timestamp: new Date().toISOString()
        });
    }
    catch (err) {
        const e = err;
        console.error('tracking/drivers error', err);
        res.status(500).json({ error: 'tracking_fetch_failed', detail: e.message });
    }
});
exports.default = router;
