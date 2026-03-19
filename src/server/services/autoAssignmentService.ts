/**
 * Auto-Assignment Service
 * Automatically assigns deliveries to drivers based on availability, load, and location
 */

import prisma from '../db/prisma';

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

interface Driver {
  id: string;
  username?: string;
  fullName?: string;
  phone?: string;
  email?: string;
  active: boolean;
  gpsEnabled?: boolean;
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
    fullName?: string;
    username?: string;
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

/**
 * Find the best available driver for a delivery
 * Priority: Available > Current Load (ascending) > Active
 */
async function findBestDriver(): Promise<Driver | null> {
  try {
    // Get all active drivers with their status and current assignments
    const drivers = await (prisma as any).driver.findMany({
      where: {
        active: true
      },
      include: {
        status: true,
        assignments: {
          where: {
            status: {
              in: ['assigned', 'in_progress']
            }
          }
        },
        account: true
      }
    });

    if (drivers.length === 0) {
      return null;
    }

    // Filter to only available drivers (status = 'available' or null/offline)
    const availableDrivers = drivers.filter((driver: Driver) => {
      const status = driver.status?.status || 'offline';
      return status === 'available' || status === 'offline';
    });

    if (availableDrivers.length === 0) {
      // If no available drivers, use all active drivers anyway (overload scenario)
      return [...drivers].sort((a: Driver, b: Driver) => a.assignments.length - b.assignments.length)[0];
    }

    // Sort by current assignment count (fewer = better)
    // Then by GPS enabled status (GPS enabled = better for tracking)
    availableDrivers.sort((a: Driver, b: Driver) => {
      const loadDiff = a.assignments.length - b.assignments.length;
      if (loadDiff !== 0) return loadDiff;

      // Prefer drivers with GPS enabled
      const gpsDiff = (b.gpsEnabled ? 1 : 0) - (a.gpsEnabled ? 1 : 0);
      return gpsDiff;
    });

    return availableDrivers[0];
  } catch (error: unknown) {
    console.error('[AutoAssignment] Error finding best driver:', error);
    return null;
  }
}

/**
 * Auto-assign a single delivery to the best available driver
 */
async function autoAssignDelivery(deliveryId: string): Promise<AssignmentWithDriver | null> {
  try {
    // Check if delivery already has an active assignment
    const existingAssignment = await (prisma as any).deliveryAssignment.findFirst({
      where: {
        deliveryId,
        status: {
          in: ['assigned', 'in_progress']
        }
      }
    });

    if (existingAssignment) {
      console.log(`[AutoAssignment] Delivery ${deliveryId} already assigned to driver ${existingAssignment.driverId}`);
      return existingAssignment;
    }

    // Find best driver
    const driver = await findBestDriver();

    if (!driver) {
      console.warn(`[AutoAssignment] No available driver for delivery ${deliveryId}`);
      return null;
    }

    // Create assignment
    const assignment = await (prisma as any).deliveryAssignment.create({
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

    // Update driver status to 'busy' if they have assignments now
    const driverAssignments = await (prisma as any).deliveryAssignment.count({
      where: {
        driverId: driver.id,
        status: {
          in: ['assigned', 'in_progress']
        }
      }
    });

    if (driverAssignments > 0) {
      await (prisma as any).driverStatus.upsert({
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

    // Create delivery event
    await (prisma as any).deliveryEvent.create({
      data: {
        deliveryId,
        eventType: 'auto_assigned',
        payload: {
          driverId: driver.id,
          driverName: driver.fullName || driver.username,
          assignedAt: assignment.assignedAt.toISOString()
        },
        actorType: 'system',
        actorId: null
      }
    });

    console.log(`[AutoAssignment] Delivery ${deliveryId} assigned to driver ${driver.id} (${driver.username || driver.fullName})`);

    return assignment;
  } catch (error: unknown) {
    console.error(`[AutoAssignment] Error assigning delivery ${deliveryId}:`, error);
    throw error;
  }
}

/**
 * Auto-assign multiple deliveries
 */
async function autoAssignDeliveries(deliveryIds: string[]): Promise<AssignmentResult[]> {
  const results: AssignmentResult[] = [];

  for (const deliveryId of deliveryIds) {
    try {
      // Ensure delivery exists in database
      await prisma.delivery.upsert({
        where: { id: deliveryId },
        update: {},
        create: { id: deliveryId } as Record<string, unknown>
      });

      const assignment = await autoAssignDelivery(deliveryId);
      results.push({
        deliveryId,
        success: !!assignment,
        assignment: assignment ? {
          id: assignment.id,
          driverId: assignment.driverId,
          driverName: assignment.driver?.fullName || assignment.driver?.username,
          status: assignment.status
        } : null,
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

/**
 * Get available drivers for manual selection
 */
async function getAvailableDrivers(): Promise<AvailableDriver[]> {
  try {
    const drivers = await (prisma as any).driver.findMany({
      where: {
        active: true
      },
      include: {
        status: true,
        assignments: {
          where: {
            status: {
              in: ['assigned', 'in_progress']
            }
          }
        },
        account: true
      },
      orderBy: {
        createdAt: 'desc'
      }
    });

    return drivers.map((driver: Driver) => ({
      id: driver.id,
      username: driver.username,
      fullName: driver.fullName,
      phone: driver.phone,
      email: driver.email,
      active: driver.active,
      gpsEnabled: driver.gpsEnabled,
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
  autoAssignDelivery,
  autoAssignDeliveries,
  getAvailableDrivers
};
