/**
 * Auto-Assignment Service
 * Automatically assigns deliveries to drivers based on availability, load, and location
 */

const prisma = require('../db/prisma');

/**
 * Find the best available driver for a delivery
 * Priority: Available > Current Load (ascending) > Active
 */
async function findBestDriver() {
  try {
    // Get all active drivers with their status and current assignments
    const drivers = await prisma.driver.findMany({
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
    const availableDrivers = drivers.filter(driver => {
      const status = driver.status?.status || 'offline';
      return status === 'available' || status === 'offline';
    });

    if (availableDrivers.length === 0) {
      // If no available drivers, use all active drivers anyway (overload scenario)
      return drivers
        .sort((a, b) => a.assignments.length - b.assignments.length)[0];
    }

    // Sort by current assignment count (fewer = better)
    // Then by GPS enabled status (GPS enabled = better for tracking)
    availableDrivers.sort((a, b) => {
      const loadDiff = a.assignments.length - b.assignments.length;
      if (loadDiff !== 0) return loadDiff;
      
      // Prefer drivers with GPS enabled
      const gpsDiff = (b.gpsEnabled ? 1 : 0) - (a.gpsEnabled ? 1 : 0);
      return gpsDiff;
    });

    return availableDrivers[0];
  } catch (error) {
    console.error('[AutoAssignment] Error finding best driver:', error);
    return null;
  }
}

/**
 * Auto-assign a single delivery to the best available driver
 */
async function autoAssignDelivery(deliveryId) {
  try {
    // Check if delivery already has an active assignment
    const existingAssignment = await prisma.deliveryAssignment.findFirst({
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

    // Update driver status to 'busy' if they have assignments now
    const driverAssignments = await prisma.deliveryAssignment.count({
      where: {
        driverId: driver.id,
        status: {
          in: ['assigned', 'in_progress']
        }
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

    // Create delivery event
    await prisma.deliveryEvent.create({
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
  } catch (error) {
    console.error(`[AutoAssignment] Error assigning delivery ${deliveryId}:`, error);
    throw error;
  }
}

/**
 * Auto-assign multiple deliveries
 */
async function autoAssignDeliveries(deliveryIds) {
  const results = [];
  
  for (const deliveryId of deliveryIds) {
    try {
      // Ensure delivery exists in database
      await prisma.delivery.upsert({
        where: { id: deliveryId },
        update: {},
        create: { id: deliveryId }
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
    } catch (error) {
      console.error(`[AutoAssignment] Failed to assign delivery ${deliveryId}:`, error);
      results.push({
        deliveryId,
        success: false,
        assignment: null,
        error: error.message
      });
    }
  }

  return results;
}

/**
 * Get available drivers for manual selection
 */
async function getAvailableDrivers() {
  try {
    const drivers = await prisma.driver.findMany({
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

    return drivers.map(driver => ({
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
  } catch (error) {
    console.error('[AutoAssignment] Error getting available drivers:', error);
    return [];
  }
}

module.exports = {
  findBestDriver,
  autoAssignDelivery,
  autoAssignDeliveries,
  getAvailableDrivers
};

