/**
 * Auto-Assignment Service
 * Assigns deliveries to accounts with role "driver" only.
 * When a confirmed delivery date exists, balances load per driver for that Dubai calendar day (truck piece limit).
 */

import type { Prisma } from '@prisma/client';
import prisma from '../db/prisma';
import {
  dubaiDayRangeUtc,
  parseDeliveryItemCount,
  TRUCK_MAX_ITEMS_PER_DAY
} from './deliveryCapacityService';

interface DriverStatus {
  status: string;
}

interface DriverAccount {
  role: string;
}

interface DriverAssignment {
  id: string;
  driverId: string;
  status: string;
}

interface DriverRow {
  id: string;
  username?: string | null;
  fullName?: string | null;
  phone?: string | null;
  email?: string | null;
  active: boolean;
  gpsEnabled?: boolean | null;
  status?: DriverStatus | null;
  assignments: DriverAssignment[];
  account?: DriverAccount | null;
}

interface AssignmentWithDriver {
  id: string;
  deliveryId: string;
  driverId: string;
  status: string;
  assignedAt: Date;
  driver?: {
    fullName?: string | null;
    username?: string | null;
    status?: DriverStatus | null;
  };
}

interface AssignmentResult {
  deliveryId: string;
  success: boolean;
  assignment: {
    id: string;
    driverId: string;
    driverName: string | undefined;
    status: string;
  } | null;
  error: string | null;
}

interface AvailableDriver {
  id: string;
  username?: string;
  fullName?: string;
  phone?: string;
  email?: string;
  active: boolean;
  gpsEnabled?: boolean;
  status: string;
  currentAssignments: number;
  role: string;
}

const driverWhereRoleDriver: Prisma.DriverWhereInput = {
  active: true,
  account: { role: 'driver' }
};

function confirmedDateToDubaiIso(d: Date): string {
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
async function sumDriverPiecesOnDate(
  driverId: string,
  dayStart: Date,
  dayEnd: Date,
  excludeDeliveryId?: string
): Promise<number> {
  const rows = await prisma.deliveryAssignment.findMany({
    where: {
      driverId,
      status: { in: ['assigned', 'in_progress'] as const },
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
    const meta =
      a.delivery.metadata && typeof a.delivery.metadata === 'object'
        ? (a.delivery.metadata as Record<string, unknown>)
        : null;
    sum += parseDeliveryItemCount(a.delivery.items, meta);
  }
  return sum;
}

/**
 * Best driver for a delivery on a specific Dubai day: lowest current piece load, respects truck cap when possible.
 */
async function findBestDriverForDeliveryDate(
  deliveryId: string,
  orderPieces: number,
  dayStart: Date,
  dayEnd: Date
): Promise<DriverRow | null> {
  const drivers = (await prisma.driver.findMany({
    where: driverWhereRoleDriver,
    include: {
      status: true,
      account: true,
      assignments: {
        where: { status: { in: ['assigned', 'in_progress'] } }
      }
    }
  })) as DriverRow[];

  if (drivers.length === 0) {
    return null;
  }

  type Scored = { driver: DriverRow; load: number; assignmentCount: number };
  const scored: Scored[] = [];
  for (const driver of drivers) {
    const load = await sumDriverPiecesOnDate(driver.id, dayStart, dayEnd, deliveryId);
    scored.push({
      driver,
      load,
      assignmentCount: driver.assignments.length
    });
  }

  const fits = scored.filter(s => s.load + orderPieces <= TRUCK_MAX_ITEMS_PER_DAY);
  const pool = fits.length > 0 ? fits : scored;

  pool.sort((a, b) => {
    if (a.load !== b.load) return a.load - b.load;
    if (a.assignmentCount !== b.assignmentCount) return a.assignmentCount - b.assignmentCount;
    const gps = (b.driver.gpsEnabled ? 1 : 0) - (a.driver.gpsEnabled ? 1 : 0);
    return gps;
  });

  const pick = pool[0];
  if (!pick) return null;

  if (pick.load + orderPieces > TRUCK_MAX_ITEMS_PER_DAY) {
    console.warn(
      `[AutoAssignment] Driver ${pick.driver.id} day load ${pick.load} + ${orderPieces} exceeds ${TRUCK_MAX_ITEMS_PER_DAY}; assigning to least-loaded driver.`
    );
  }

  return pick.driver;
}

/**
 * Fallback when delivery has no confirmed date (e.g. legacy bulk assign): pick least busy driver with role driver.
 */
async function findBestDriver(): Promise<DriverRow | null> {
  try {
    const drivers = (await prisma.driver.findMany({
      where: driverWhereRoleDriver,
      include: {
        status: true,
        assignments: {
          where: { status: { in: ['assigned', 'in_progress'] } }
        },
        account: true
      }
    })) as DriverRow[];

    if (drivers.length === 0) {
      return null;
    }

    const availableDrivers = drivers.filter(driver => {
      const status = driver.status?.status || 'offline';
      return status === 'available' || status === 'offline';
    });

    const pool = availableDrivers.length > 0 ? availableDrivers : [...drivers];

    pool.sort((a, b) => {
      const loadDiff = a.assignments.length - b.assignments.length;
      if (loadDiff !== 0) return loadDiff;
      return (b.gpsEnabled ? 1 : 0) - (a.gpsEnabled ? 1 : 0);
    });

    return pool[0];
  } catch (error: unknown) {
    console.error('[AutoAssignment] Error finding best driver:', error);
    return null;
  }
}

async function autoAssignDelivery(deliveryId: string): Promise<AssignmentWithDriver | null> {
  try {
    const existingAssignment = await prisma.deliveryAssignment.findFirst({
      where: {
        deliveryId,
        status: { in: ['assigned', 'in_progress'] }
      }
    });

    if (existingAssignment) {
      console.log(`[AutoAssignment] Delivery ${deliveryId} already assigned to driver ${existingAssignment.driverId}`);
      return existingAssignment as AssignmentWithDriver;
    }

    const delivery = await prisma.delivery.findUnique({
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

    const meta =
      delivery.metadata && typeof delivery.metadata === 'object'
        ? (delivery.metadata as Record<string, unknown>)
        : null;
    const orderPieces = parseDeliveryItemCount(delivery.items, meta);

    let driver: DriverRow | null = null;

    if (delivery.confirmedDeliveryDate) {
      const iso = confirmedDateToDubaiIso(delivery.confirmedDeliveryDate);
      const { start, end } = dubaiDayRangeUtc(iso);
      driver = await findBestDriverForDeliveryDate(deliveryId, orderPieces, start, end);
    } else {
      driver = await findBestDriver();
    }

    if (!driver) {
      console.warn(`[AutoAssignment] No eligible driver account for delivery ${deliveryId}`);
      return null;
    }

    const assignment = await prisma.deliveryAssignment.create({
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

    const driverAssignments = await prisma.deliveryAssignment.count({
      where: {
        driverId: driver.id,
        status: { in: ['assigned', 'in_progress'] }
      }
    });

    if (driverAssignments > 0) {
      await prisma.driverStatus.upsert({
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

    await prisma.deliveryEvent.create({
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

    return assignment as AssignmentWithDriver;
  } catch (error: unknown) {
    console.error(`[AutoAssignment] Error assigning delivery ${deliveryId}:`, error);
    throw error;
  }
}

async function autoAssignDeliveries(deliveryIds: string[]): Promise<AssignmentResult[]> {
  const results: AssignmentResult[] = [];

  for (const deliveryId of deliveryIds) {
    try {
      const exists = await prisma.delivery.findUnique({
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
    } catch (error: unknown) {
      console.error(`[AutoAssignment] Failed to assign delivery ${deliveryId}:`, error);
      const e = error as Error;
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

async function getAvailableDrivers(): Promise<AvailableDriver[]> {
  try {
    const drivers = (await prisma.driver.findMany({
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
    })) as DriverRow[];

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
  } catch (error: unknown) {
    console.error('[AutoAssignment] Error getting available drivers:', error);
    return [];
  }
}

export {
  findBestDriver,
  findBestDriverForDeliveryDate,
  autoAssignDelivery,
  autoAssignDeliveries,
  getAvailableDrivers
};
