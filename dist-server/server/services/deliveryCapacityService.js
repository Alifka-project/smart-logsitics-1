"use strict";
/**
 * Truck capacity: max pieces per route/day, customer date window (7 eligible days).
 * Non-working days: Sundays + UAE public holidays. Uses Asia/Dubai for calendar boundaries.
 *
 * Business rule: 1 driver = 1 truck = TRUCK_MAX_ITEMS_PER_DAY units max per day.
 * Fleet daily capacity = numActiveDrivers × TRUCK_MAX_ITEMS_PER_DAY.
 * Per-driver capacity is also enforced at assignment time.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.TRUCK_MAX_ITEMS_PER_DAY = void 0;
exports.getDubaiTodayIso = getDubaiTodayIso;
exports.getDubaiWeekday = getDubaiWeekday;
exports.addDubaiCalendarDays = addDubaiCalendarDays;
exports.isPastDubaiCutoff = isPastDubaiCutoff;
exports.getNextNEligibleDayIsoStrings = getNextNEligibleDayIsoStrings;
exports.getNextSevenEligibleDayIsoStrings = getNextSevenEligibleDayIsoStrings;
exports.parseDeliveryItemCount = parseDeliveryItemCount;
exports.dubaiDayRangeUtc = dubaiDayRangeUtc;
exports.getTotalItemCountForDeliveryDate = getTotalItemCountForDeliveryDate;
exports.getDriverItemCountForDate = getDriverItemCountForDate;
exports.getDateCapacityDetails = getDateCapacityDetails;
exports.getAvailableDatesForDeliveryId = getAvailableDatesForDeliveryId;
exports.assertSlotAvailable = assertSlotAvailable;
const dubaiHolidays_1 = require("../../utils/dubaiHolidays");
/** One driver / one truck = 20 units max per delivery day. Env-configurable. */
exports.TRUCK_MAX_ITEMS_PER_DAY = Math.max(1, Number.parseInt(process.env.TRUCK_MAX_ITEMS_PER_DAY || '20', 10) || 20);
const DUBAI_TZ = 'Asia/Dubai';
/** YYYY-MM-DD for "today" in Dubai */
function getDubaiTodayIso() {
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: DUBAI_TZ,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).format(new Date());
}
function getDubaiWeekday(isoDate) {
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: DUBAI_TZ,
        weekday: 'short'
    }).formatToParts(new Date(`${isoDate}T12:00:00+04:00`));
    const wd = parts.find(p => p.type === 'weekday')?.value;
    const map = {
        Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6
    };
    return wd ? (map[wd] ?? 0) : 0;
}
/** Add calendar days in Dubai (no DST in UAE). */
function addDubaiCalendarDays(isoDate, deltaDays) {
    const ref = new Date(`${isoDate}T12:00:00+04:00`);
    ref.setTime(ref.getTime() + deltaDays * 86400000);
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: DUBAI_TZ,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).format(ref);
}
/**
 * Returns true if the current Dubai time is at or past 15:00 (3 PM).
 * Business rule: orders uploaded/processed after 15:00 Dubai cannot choose tomorrow.
 */
function isPastDubaiCutoff() {
    const now = new Date();
    const dubaiHour = parseInt(new Intl.DateTimeFormat('en-US', { timeZone: DUBAI_TZ, hour: 'numeric', hour12: false }).format(now), 10);
    return dubaiHour >= 15;
}
/**
 * Next N eligible delivery days: skip Sundays and UAE public holidays.
 * Starts from tomorrow (Dubai timezone).
 * If current Dubai time >= 15:00, tomorrow is still returned but excluded from
 * availableDates (treated like a full-capacity day — shown but disabled).
 */
function getNextNEligibleDayIsoStrings(n) {
    const out = [];
    let cursor = addDubaiCalendarDays(getDubaiTodayIso(), 1);
    while (out.length < n) {
        const wd = getDubaiWeekday(cursor);
        if (wd !== 0 && !(0, dubaiHolidays_1.isDubaiPublicHoliday)(cursor)) {
            out.push(cursor);
        }
        cursor = addDubaiCalendarDays(cursor, 1);
    }
    return out;
}
/**
 * Next 7 eligible delivery days (backwards-compat alias).
 */
function getNextSevenEligibleDayIsoStrings() {
    return getNextNEligibleDayIsoStrings(7);
}
function num(v) {
    const n = typeof v === 'number' ? v : Number.parseFloat(String(v));
    return Number.isFinite(n) && n > 0 ? n : 0;
}
/**
 * Piece count for capacity: reads from metadata.originalQuantity first,
 * then from the raw Excel row (Order Quantity / Confirmed quantity),
 * then from parsed JSON items array, defaulting to 1.
 */
function parseDeliveryItemCount(items, metadata) {
    // Primary: pre-extracted quantity stored on metadata
    if (metadata?.originalQuantity != null) {
        const q = num(metadata.originalQuantity);
        if (q > 0)
            return Math.min(9999, Math.ceil(q));
    }
    // Secondary: raw Excel row fields (exact column names from the spreadsheet)
    const orig = (metadata?.originalRow ??
        metadata?._originalRow ??
        {});
    const excelQty = num(orig['Order Quantity'] ??
        orig['Confirmed quantity'] ??
        orig['Total Line Deliv. Qt'] ??
        orig['Order Qty'] ??
        orig['Quantity'] ??
        orig['qty'] ??
        orig['QTY'] ??
        0);
    if (excelQty > 0)
        return Math.min(9999, Math.ceil(excelQty));
    if (!items || !String(items).trim()) {
        return 1;
    }
    try {
        const parsed = JSON.parse(items);
        if (Array.isArray(parsed)) {
            if (parsed.length === 0)
                return 1;
            let sum = 0;
            for (const row of parsed) {
                if (row && typeof row === 'object') {
                    const o = row;
                    const q = num(o['Order Quantity']) ||
                        num(o['Confirmed quantity']) ||
                        num(o.Quantity) ||
                        num(o.quantity) ||
                        num(o.qty) ||
                        num(o.Qty);
                    sum += q > 0 ? q : 1;
                }
                else {
                    sum += 1;
                }
            }
            return Math.max(1, Math.min(9999, Math.ceil(sum)));
        }
    }
    catch {
        // fall through
    }
    return 1;
}
function dubaiDayRangeUtc(isoDate) {
    const start = new Date(`${isoDate}T00:00:00+04:00`);
    const end = new Date(`${isoDate}T23:59:59.999+04:00`);
    return { start, end };
}
const EXCLUDED_FROM_CAPACITY = new Set([
    'cancelled',
    'returned',
    'failed'
]);
/**
 * Count active drivers whose account has role='driver'.
 * Returns at least 1 so a zero-driver system still has a non-zero capacity ceiling.
 */
async function countActiveDeliveryDrivers(db) {
    try {
        const count = await db.driver.count({
            where: { active: true, account: { role: 'driver' } }
        });
        return Math.max(1, count);
    }
    catch {
        return 1;
    }
}
/**
 * Sum piece counts for deliveries confirmed on this Dubai calendar day (excluding one delivery).
 * Used for fleet-level capacity checking.
 */
async function getTotalItemCountForDeliveryDate(db, isoDate, excludeDeliveryId) {
    const { start, end } = dubaiDayRangeUtc(isoDate);
    const rows = await db.delivery.findMany({
        where: {
            confirmationStatus: 'confirmed',
            confirmedDeliveryDate: { gte: start, lte: end },
            ...(excludeDeliveryId ? { id: { not: excludeDeliveryId } } : {}),
            status: { notIn: [...EXCLUDED_FROM_CAPACITY] }
        },
        select: { id: true, items: true, metadata: true }
    });
    let total = 0;
    for (const r of rows) {
        const meta = r.metadata && typeof r.metadata === 'object' ? r.metadata : null;
        total += parseDeliveryItemCount(r.items, meta);
    }
    return total;
}
/**
 * Sum piece counts for deliveries assigned to a specific driver on a given Dubai calendar day.
 * Joins through DeliveryAssignment (active assignments only) → Delivery.confirmedDeliveryDate.
 * Used to enforce the per-driver 20-unit capacity limit at assignment time.
 */
const ROUTE_STATUSES_FOR_TODAY_CAPACITY = new Set([
    'out-for-delivery',
    'out_for_delivery',
    'in-transit',
    'in_transit',
    'in-progress',
    'in_progress',
    'pgi-done',
    'pgi_done',
    'pickup-confirmed',
    'pickup_confirmed',
]);
/**
 * Sum piece counts for deliveries actively assigned to this driver.
 * - Scheduled / pre-route: counts toward the delivery's **Dubai confirmed** calendar day.
 * - On route (dispatched): always counts toward **today (Dubai)** so trucks don't look "empty"
 *   while drivers are carrying overdue or mixed-date loads.
 */
async function getDriverItemCountForDate(db, driverId, isoDate, excludeDeliveryId) {
    const { start, end } = dubaiDayRangeUtc(isoDate);
    const todayIso = getDubaiTodayIso();
    const assignments = await db.deliveryAssignment.findMany({
        where: {
            driverId,
            status: { in: ['assigned', 'in_progress'] },
            delivery: {
                status: { notIn: [...EXCLUDED_FROM_CAPACITY] },
                ...(excludeDeliveryId ? { id: { not: excludeDeliveryId } } : {}),
            },
        },
        select: {
            delivery: {
                select: { id: true, items: true, metadata: true, status: true, confirmedDeliveryDate: true },
            },
        },
    });
    let total = 0;
    for (const a of assignments) {
        const r = a.delivery;
        if (!r)
            continue;
        const rawStatus = (r.status || '').toLowerCase();
        const onRoute = ROUTE_STATUSES_FOR_TODAY_CAPACITY.has(rawStatus);
        let countsForThisDay = false;
        if (onRoute) {
            countsForThisDay = isoDate === todayIso;
        }
        else if (r.confirmedDeliveryDate) {
            const cd = r.confirmedDeliveryDate;
            countsForThisDay = cd >= start && cd <= end;
        }
        if (!countsForThisDay)
            continue;
        const meta = r.metadata && typeof r.metadata === 'object' ? r.metadata : null;
        total += parseDeliveryItemCount(r.items, meta);
    }
    return total;
}
/**
 * Returns capacity details for each of the next 7 eligible calendar days,
 * plus unavailable days (Sunday, holiday) within the same 10-day scan window.
 * Customers see all days — available ones are selectable, full/blocked ones show reason.
 */
async function getDateCapacityDetails(db, deliveryId, items, metadata) {
    const orderItemCount = parseDeliveryItemCount(items, metadata);
    if (orderItemCount > exports.TRUCK_MAX_ITEMS_PER_DAY) {
        return {
            days: [],
            orderItemCount,
            exceedsTruckCapacity: true,
            availableDates: []
        };
    }
    const numDrivers = await countActiveDeliveryDrivers(db);
    const fleetDailyCapacity = numDrivers * exports.TRUCK_MAX_ITEMS_PER_DAY;
    // Scan up to 14 calendar days to collect 7 eligible + show blocked days in between
    const today = getDubaiTodayIso();
    const tomorrow = addDubaiCalendarDays(today, 1);
    const tomorrowBlockedByCutoff = isPastDubaiCutoff(); // past 15:00 Dubai → tomorrow disabled
    const days = [];
    const availableDates = [];
    let eligibleCount = 0;
    let cursor = tomorrow;
    while (eligibleCount < 7 || days.length < 14) {
        const wd = getDubaiWeekday(cursor);
        const isHoliday = (0, dubaiHolidays_1.isDubaiPublicHoliday)(cursor);
        if (wd === 0) {
            days.push({ iso: cursor, available: false, used: 0, total: 0, remaining: 0, reason: 'sunday' });
        }
        else if (isHoliday) {
            days.push({ iso: cursor, available: false, used: 0, total: 0, remaining: 0, reason: 'holiday' });
        }
        else if (cursor === tomorrow && tomorrowBlockedByCutoff) {
            // 15:00 cutoff: tomorrow shown but disabled (like full capacity)
            const used = await getTotalItemCountForDeliveryDate(db, cursor, deliveryId);
            days.push({ iso: cursor, available: false, used, total: fleetDailyCapacity, remaining: fleetDailyCapacity - used, reason: 'cutoff' });
            eligibleCount++; // still counts as a scanned eligible day so we advance the window
        }
        else {
            const used = await getTotalItemCountForDeliveryDate(db, cursor, deliveryId);
            const remaining = fleetDailyCapacity - used;
            const available = remaining >= orderItemCount;
            if (available)
                eligibleCount++;
            if (available)
                availableDates.push(cursor);
            days.push({
                iso: cursor,
                available,
                used,
                total: fleetDailyCapacity,
                remaining,
                reason: available ? undefined : 'full'
            });
        }
        // Stop once we have 7 eligible days and have shown at least 10 total days
        if (eligibleCount >= 7 && days.length >= 10)
            break;
        cursor = addDubaiCalendarDays(cursor, 1);
    }
    return { days, orderItemCount, exceedsTruckCapacity: false, availableDates };
}
async function getAvailableDatesForDeliveryId(db, deliveryId, items, metadata) {
    const result = await getDateCapacityDetails(db, deliveryId, items, metadata);
    return {
        availableDates: result.availableDates,
        orderItemCount: result.orderItemCount,
        exceedsTruckCapacity: result.exceedsTruckCapacity
    };
}
async function assertSlotAvailable(db, deliveryId, isoDate, items, metadata) {
    const orderItemCount = parseDeliveryItemCount(items, metadata);
    if (orderItemCount > exports.TRUCK_MAX_ITEMS_PER_DAY) {
        throw new Error(`This order (${orderItemCount} units) exceeds the maximum truck load of ${exports.TRUCK_MAX_ITEMS_PER_DAY} units per truck. Please contact support.`);
    }
    const allowed = getNextNEligibleDayIsoStrings(14);
    if (!allowed.includes(isoDate)) {
        throw new Error('Selected date is outside the allowed delivery window.');
    }
    if (getDubaiWeekday(isoDate) === 0) {
        throw new Error('Sunday is not available for delivery.');
    }
    if ((0, dubaiHolidays_1.isDubaiPublicHoliday)(isoDate)) {
        throw new Error('The selected date is a UAE public holiday. Please choose another available date.');
    }
    // Business rule: after 15:00 Dubai time, tomorrow's slot is closed for new bookings.
    const tomorrow = addDubaiCalendarDays(getDubaiTodayIso(), 1);
    if (isoDate === tomorrow && isPastDubaiCutoff()) {
        throw new Error('Orders cannot be booked for tomorrow after 15:00 Dubai time. Please choose a later date.');
    }
    const numDrivers = await countActiveDeliveryDrivers(db);
    const fleetDailyCapacity = numDrivers * exports.TRUCK_MAX_ITEMS_PER_DAY;
    const used = await getTotalItemCountForDeliveryDate(db, isoDate, deliveryId);
    if (used + orderItemCount > fleetDailyCapacity) {
        throw new Error(`That delivery date is fully booked (${used}/${fleetDailyCapacity} units used). Please choose another available date.`);
    }
}
