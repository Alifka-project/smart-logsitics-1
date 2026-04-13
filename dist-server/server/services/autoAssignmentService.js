"use strict";
/**
 * Auto-Assignment Service
 * Assigns deliveries to accounts with role "driver" only.
 * When a confirmed delivery date exists, balances load per driver for that Dubai calendar day (truck piece limit).
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.findBestDriver = findBestDriver;
exports.findBestDriverForDeliveryDate = findBestDriverForDeliveryDate;
exports.autoAssignDelivery = autoAssignDelivery;
exports.autoAssignDeliveries = autoAssignDeliveries;
exports.getAvailableDrivers = getAvailableDrivers;
const prisma_1 = __importDefault(require("../db/prisma"));
const deliveryCapacityService_1 = require("./deliveryCapacityService");
const driverWhereRoleDriver = {
    active: true,
    account: { role: 'driver' }
};
function confirmedDateToDubaiIso(d) {
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Dubai',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).format(d);
}
/**
 * Sum pieces already assigned to this driver for the Dubai calendar day of `dayAnchor`.
 */
async function sumDriverPiecesOnDate(driverId, dayStart, dayEnd, excludeDeliveryId) {
    const rows = await prisma_1.default.deliveryAssignment.findMany({
        where: {
            driverId,
            status: { in: ['assigned', 'in_progress'] },
            delivery: {
                confirmedDeliveryDate: { gte: dayStart, lte: dayEnd },
                ...(excludeDeliveryId ? { id: { not: excludeDeliveryId } } : {})
            }
        },
        include: {
            delivery: { select: { items: true, metadata: true } }
        }
    });
    let sum = 0;
    for (const a of rows) {
        const meta = a.delivery.metadata && typeof a.delivery.metadata === 'object'
            ? a.delivery.metadata
            : null;
        sum += (0, deliveryCapacityService_1.parseDeliveryItemCount)(a.delivery.items, meta);
    }
    return sum;
}
/**
 * Best driver for a delivery on a specific Dubai day: lowest current piece load, respects truck cap when possible.
 */
async function findBestDriverForDeliveryDate(deliveryId, orderPieces, dayStart, dayEnd) {
    const allFetched = (await prisma_1.default.driver.findMany({
        where: driverWhereRoleDriver,
        include: {
            status: true,
            account: true,
            assignments: {
                where: { status: { in: ['assigned', 'in_progress'] } }
            }
        }
    }));
    // JS-level safety filter: only role='driver' accounts (guards against Prisma edge cases)
    const drivers = allFetched.filter(d => d.account?.role === 'driver');
    if (drivers.length === 0) {
        console.warn('[AutoAssignment] No active drivers with role=driver found for date assignment.');
        return null;
    }
    const scored = [];
    for (const driver of drivers) {
        const load = await sumDriverPiecesOnDate(driver.id, dayStart, dayEnd, deliveryId);
        scored.push({
            driver,
            load,
            assignmentCount: driver.assignments.length
        });
    }
    const fits = scored.filter(s => s.load + orderPieces <= deliveryCapacityService_1.TRUCK_MAX_ITEMS_PER_DAY);
    const pool = fits.length > 0 ? fits : scored;
    pool.sort((a, b) => {
        if (a.load !== b.load)
            return a.load - b.load;
        if (a.assignmentCount !== b.assignmentCount)
            return a.assignmentCount - b.assignmentCount;
        const gps = (b.driver.gpsEnabled ? 1 : 0) - (a.driver.gpsEnabled ? 1 : 0);
        return gps;
    });
    const pick = pool[0];
    if (!pick)
        return null;
    if (pick.load + orderPieces > deliveryCapacityService_1.TRUCK_MAX_ITEMS_PER_DAY) {
        console.warn(`[AutoAssignment] Driver ${pick.driver.id} day load ${pick.load} + ${orderPieces} exceeds ${deliveryCapacityService_1.TRUCK_MAX_ITEMS_PER_DAY}; assigning to least-loaded driver.`);
    }
    return pick.driver;
}
/**
 * Fallback when delivery has no confirmed date (e.g. legacy bulk assign): pick least busy driver with role driver.
 */
async function findBestDriver() {
    try {
        const allFetched = (await prisma_1.default.driver.findMany({
            where: driverWhereRoleDriver,
            include: {
                status: true,
                assignments: {
                    where: { status: { in: ['assigned', 'in_progress'] } }
                },
                account: true
            }
        }));
        // JS-level safety filter: only role='driver' accounts
        const drivers = allFetched.filter(d => d.account?.role === 'driver');
        if (drivers.length === 0) {
            console.warn('[AutoAssignment] No active drivers with role=driver found.');
            return null;
        }
        const availableDrivers = drivers.filter(driver => {
            const status = driver.status?.status || 'offline';
            return status === 'available' || status === 'offline';
        });
        const pool = availableDrivers.length > 0 ? availableDrivers : [...drivers];
        pool.sort((a, b) => {
            const loadDiff = a.assignments.length - b.assignments.length;
            if (loadDiff !== 0)
                return loadDiff;
            return (b.gpsEnabled ? 1 : 0) - (a.gpsEnabled ? 1 : 0);
        });
        return pool[0];
    }
    catch (error) {
        console.error('[AutoAssignment] Error finding best driver:', error);
        return null;
    }
}
async function autoAssignDelivery(deliveryId) {
    try {
        const existingAssignment = await prisma_1.default.deliveryAssignment.findFirst({
            where: {
                deliveryId,
                status: { in: ['assigned', 'in_progress'] }
            }
        });
        if (existingAssignment) {
            console.log(`[AutoAssignment] Delivery ${deliveryId} already assigned to driver ${existingAssignment.driverId}`);
            return existingAssignment;
        }
        const delivery = await prisma_1.default.delivery.findUnique({
            where: { id: deliveryId },
            select: {
                id: true,
                items: true,
                metadata: true,
                confirmedDeliveryDate: true
            }
        });
        if (!delivery) {
            console.warn(`[AutoAssignment] Delivery ${deliveryId} not found`);
            return null;
        }
        const meta = delivery.metadata && typeof delivery.metadata === 'object'
            ? delivery.metadata
            : null;
        const orderPieces = (0, deliveryCapacityService_1.parseDeliveryItemCount)(delivery.items, meta);
        let driver = null;
        if (delivery.confirmedDeliveryDate) {
            const iso = confirmedDateToDubaiIso(delivery.confirmedDeliveryDate);
            const { start, end } = (0, deliveryCapacityService_1.dubaiDayRangeUtc)(iso);
            driver = await findBestDriverForDeliveryDate(deliveryId, orderPieces, start, end);
        }
        else {
            driver = await findBestDriver();
        }
        if (!driver) {
            console.warn(`[AutoAssignment] No eligible driver account for delivery ${deliveryId}`);
            return null;
        }
        // Hard guard: never assign to a non-driver role account
        if (!driver.account || driver.account.role !== 'driver') {
            console.error(`[AutoAssignment] BLOCKED: candidate driver ${driver.id} has role="${driver.account?.role ?? 'none'}" — only role="driver" allowed. Delivery ${deliveryId} left unassigned.`);
            return null;
        }
        const assignment = await prisma_1.default.deliveryAssignment.create({
            data: {
                deliveryId,
                driverId: driver.id,
                status: 'assigned',
                assignedAt: new Date()
            },
            include: {
                driver: {
                    include: {
                        status: true
                    }
                }
            }
        });
        const driverAssignments = await prisma_1.default.deliveryAssignment.count({
            where: {
                driverId: driver.id,
                status: { in: ['assigned', 'in_progress'] }
            }
        });
        if (driverAssignments > 0) {
            await prisma_1.default.driverStatus.upsert({
                where: { driverId: driver.id },
                update: {
                    status: 'busy',
                    currentAssignmentId: assignment.id,
                    updatedAt: new Date()
                },
                create: {
                    driverId: driver.id,
                    status: 'busy',
                    currentAssignmentId: assignment.id
                }
            });
        }
        await prisma_1.default.deliveryEvent.create({
            data: {
                deliveryId,
                eventType: 'auto_assigned',
                payload: {
                    driverId: driver.id,
                    driverName: driver.fullName || driver.username,
                    assignedAt: assignment.assignedAt.toISOString(),
                    confirmedDeliveryDate: delivery.confirmedDeliveryDate?.toISOString() ?? null
                },
                actorType: 'system',
                actorId: null
            }
        });
        console.log(`[AutoAssignment] Delivery ${deliveryId} assigned to driver ${driver.id} (${driver.username || driver.fullName})`);
        return assignment;
    }
    catch (error) {
        console.error(`[AutoAssignment] Error assigning delivery ${deliveryId}:`, error);
        throw error;
    }
}
async function autoAssignDeliveries(deliveryIds) {
    const results = [];
    for (const deliveryId of deliveryIds) {
        try {
            const exists = await prisma_1.default.delivery.findUnique({
                where: { id: deliveryId },
                select: { id: true }
            });
            if (!exists) {
                results.push({
                    deliveryId,
                    success: false,
                    assignment: null,
                    error: 'delivery_not_found'
                });
                continue;
            }
            const assignment = await autoAssignDelivery(deliveryId);
            results.push({
                deliveryId,
                success: !!assignment,
                assignment: assignment
                    ? {
                        id: assignment.id,
                        driverId: assignment.driverId,
                        driverName: assignment.driver?.fullName || assignment.driver?.username || undefined,
                        status: assignment.status
                    }
                    : null,
                error: assignment ? null : 'No available driver'
            });
        }
        catch (error) {
            console.error(`[AutoAssignment] Failed to assign delivery ${deliveryId}:`, error);
            const e = error;
            results.push({
                deliveryId,
                success: false,
                assignment: null,
                error: e.message
            });
        }
    }
    return results;
}
async function getAvailableDrivers() {
    try {
        const drivers = (await prisma_1.default.driver.findMany({
            where: driverWhereRoleDriver,
            include: {
                status: true,
                assignments: {
                    where: {
                        status: { in: ['assigned', 'in_progress'] }
                    }
                },
                account: true
            },
            orderBy: {
                createdAt: 'desc'
            }
        }));
        return drivers.map(driver => ({
            id: driver.id,
            username: driver.username ?? undefined,
            fullName: driver.fullName ?? undefined,
            phone: driver.phone ?? undefined,
            email: driver.email ?? undefined,
            active: driver.active,
            gpsEnabled: driver.gpsEnabled ?? undefined,
            status: driver.status?.status || 'offline',
            currentAssignments: driver.assignments.length,
            role: driver.account?.role || 'driver'
        }));
    }
    catch (error) {
        console.error('[AutoAssignment] Error getting available drivers:', error);
        return [];
    }
}
