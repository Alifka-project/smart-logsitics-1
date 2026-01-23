// Express router for driver admin endpoints
const express = require('express');
const router = express.Router();
const { authenticate, requireRole } = require('../auth');
const sapService = require('../../../services/sapService');
const prisma = require('../db/prisma');
const { hashPassword } = require('../auth');

// Ensure Prisma client is initialized
if (!prisma) {
  console.error('Prisma client not initialized!');
}

// GET /api/admin/drivers - list drivers (with filters)
// NOTE: Returns ALL users (drivers and admins). Frontend filters by role as needed.
router.get('/', authenticate, requireRole('admin'), async (req, res, next) => {
  try {
    // Check Prisma connection
    try {
      await prisma.$connect();
    } catch (connectErr) {
      // Already connected or connection error - continue anyway
      console.log('Prisma connection check:', connectErr.message || 'already connected');
    }
    
    // Use Prisma to get all drivers with accounts
    const drivers = await prisma.driver.findMany({
      include: {
        account: true
      },
      orderBy: {
        createdAt: 'desc'
      }
    });
    
    // Transform data to ensure consistent format
    // NOTE: Returns all users - frontend will filter if needed
    const formattedDrivers = drivers.map(driver => ({
      id: driver.id,
      username: driver.username,
      email: driver.email,
      phone: driver.phone,
      fullName: driver.fullName,
      full_name: driver.fullName, // Also include legacy field name for compatibility
      active: driver.active !== false, // Ensure boolean
      createdAt: driver.createdAt,
      updatedAt: driver.updatedAt,
      account: driver.account ? {
        id: driver.account.id,
        role: driver.account.role || 'driver',
        lastLogin: driver.account.lastLogin
      } : null
    }));
    
    res.json({ data: formattedDrivers, meta: { count: formattedDrivers.length } });
  } catch (err) {
    console.error('GET /api/admin/drivers error:', err);
    console.error('Error message:', err.message);
    console.error('Error code:', err.code);
    console.error('Error name:', err.name);
    if (err.meta) {
      console.error('Error meta:', JSON.stringify(err.meta, null, 2));
    }
    console.error('Error stack:', err.stack);
    
    // More detailed error response
    res.status(500).json({ 
      error: 'db_error', 
      detail: err.message,
      code: err.code,
      name: err.name,
      meta: err.meta,
      stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
    });
  }
});

// POST /api/admin/drivers - create driver/account
router.post('/', authenticate, requireRole('admin'), async (req, res) => {
  const body = req.body || {};
  if (!body.username) return res.status(400).json({ error: 'username_required' });
  if (!body.password) return res.status(400).json({ error: 'password_required' });
  if (!body.phone) return res.status(400).json({ error: 'phone_required', message: 'Mobile phone number is required for GPS tracking' });
  
  try {
    // Check if username already exists
    const existing = await prisma.driver.findUnique({
      where: { username: body.username }
    });
    
    if (existing) {
      return res.status(400).json({ error: 'username_already_exists' });
    }

    // Hash password
    const passwordHash = await hashPassword(body.password);

    // Create driver with account in transaction
    const driver = await prisma.$transaction(async (tx) => {
      const newDriver = await tx.driver.create({
        data: {
          username: body.username,
          email: body.email || null,
          phone: body.phone, // Required - validated above
          fullName: body.full_name || body.fullName || null,
          active: body.active !== false,
          gpsEnabled: false, // Will be enabled when driver activates GPS
          gpsPermissionGranted: false,
          account: {
            create: {
              passwordHash: passwordHash,
              role: body.role || 'driver'
            }
          },
          status: {
            create: {
              status: 'offline'
            }
          }
        },
        include: {
          account: true,
          status: true
        }
      });
      return newDriver;
    });

    res.status(201).json(driver);
  } catch (err) {
    console.error('POST /api/admin/drivers', err);
    res.status(500).json({ error: 'db_error', detail: err.message });
  }
});

// GET /api/admin/drivers/:id
router.get('/:id', authenticate, requireRole('admin'), async (req, res) => {
  const id = req.params.id;
  try {
    const driver = await prisma.driver.findUnique({
      where: { id },
      include: { account: true }
    });

    if (!driver) {
      return res.status(404).json({ error: 'driver_not_found' });
    }

    res.json(driver);
  } catch (err) {
    console.error('GET /api/admin/drivers/:id', err);
    res.status(500).json({ error: 'db_error', detail: err.message });
  }
});

// PUT /api/admin/drivers/:id - full update
router.put('/:id', authenticate, requireRole('admin'), async (req, res) => {
  const id = req.params.id;
  const updates = req.body || {};
  
  try {
    const driver = await prisma.driver.findUnique({
      where: { id },
      include: { account: true }
    });

    if (!driver) {
      return res.status(404).json({ error: 'driver_not_found' });
    }

    // Prepare update data
    const driverUpdate = {
      email: updates.email !== undefined ? updates.email : undefined,
      phone: updates.phone !== undefined ? updates.phone : undefined,
      fullName: updates.full_name || updates.fullName || undefined,
      active: updates.active !== undefined ? updates.active : undefined
    };

    // Remove undefined values
    Object.keys(driverUpdate).forEach(key => 
      driverUpdate[key] === undefined && delete driverUpdate[key]
    );

    const accountUpdate = {};
    if (updates.password) {
      accountUpdate.passwordHash = await hashPassword(updates.password);
    }
    if (updates.role) {
      accountUpdate.role = updates.role;
    }

    // Update in transaction
    const updated = await prisma.$transaction(async (tx) => {
      const updatedDriver = await tx.driver.update({
        where: { id },
        data: driverUpdate,
        include: { account: true }
      });

      if (Object.keys(accountUpdate).length > 0 && driver.account) {
        await tx.account.update({
          where: { driverId: id },
          data: accountUpdate
        });
      }

      return await tx.driver.findUnique({
        where: { id },
        include: { account: true }
      });
    });

    res.json(updated);
  } catch (err) {
    console.error('PUT /api/admin/drivers/:id', err);
    res.status(500).json({ error: 'db_error', detail: err.message });
  }
});

// PATCH /api/admin/drivers/:id - partial update
router.patch('/:id', authenticate, requireRole('admin'), async (req, res) => {
  const id = req.params.id;
  const updates = req.body || {};
  if (!Object.keys(updates).length) return res.status(400).json({ error: 'no_updates' });
  
  try {
    const driver = await prisma.driver.findUnique({
      where: { id },
      include: { account: true }
    });

    if (!driver) {
      return res.status(404).json({ error: 'driver_not_found' });
    }

    // Prepare update data
    const driverUpdate = {};
    if (updates.email !== undefined) driverUpdate.email = updates.email;
    if (updates.phone !== undefined) driverUpdate.phone = updates.phone;
    if (updates.full_name !== undefined || updates.fullName !== undefined) {
      driverUpdate.fullName = updates.full_name || updates.fullName;
    }
    if (updates.active !== undefined) driverUpdate.active = updates.active;

    const accountUpdate = {};
    if (updates.password) {
      accountUpdate.passwordHash = await hashPassword(updates.password);
    }
    if (updates.role) {
      accountUpdate.role = updates.role;
    }

    // Update in transaction
    const updated = await prisma.$transaction(async (tx) => {
      if (Object.keys(driverUpdate).length > 0) {
        await tx.driver.update({
          where: { id },
          data: driverUpdate
        });
      }

      if (Object.keys(accountUpdate).length > 0 && driver.account) {
        await tx.account.update({
          where: { driverId: id },
          data: accountUpdate
        });
      }

      return await tx.driver.findUnique({
        where: { id },
        include: { account: true }
      });
    });

    res.json(updated);
  } catch (err) {
    console.error('PATCH /api/admin/drivers/:id', err);
    res.status(500).json({ error: 'db_error', detail: err.message });
  }
});

// DELETE /api/admin/drivers/:id
router.delete('/:id', authenticate, requireRole('admin'), async (req, res) => {
  const id = req.params.id;
  
  try {
    const driver = await prisma.driver.findUnique({
      where: { id },
      include: { account: true }
    });

    if (!driver) {
      return res.status(404).json({ error: 'driver_not_found' });
    }

    // Delete driver (account will be cascade deleted)
    await prisma.driver.delete({
      where: { id }
    });

    res.json({ ok: true, message: 'Driver deleted successfully' });
  } catch (err) {
    console.error('DELETE /api/admin/drivers/:id', err);
    res.status(500).json({ error: 'db_error', detail: err.message });
  }
});

// POST /api/admin/drivers/:id/reset-password
router.post('/:id/reset-password', authenticate, requireRole('admin'), async (req, res) => {
  const id = req.params.id;
  try {
    // Forward to SAP if endpoint exists (best-effort)
    const resp = await sapService.call(`/Drivers/${id}/resetPassword`, 'post', req.body || {});
    res.json({ ok: true, data: resp.data });
  } catch (err) {
    // Fallback: return ok (no-op) but log
    console.error('POST /api/admin/drivers/:id/reset-password (sap)', err);
    res.json({ ok: true, note: 'no-op; SAP call failed or not implemented' });
  }
});

// POST /api/admin/drivers/:id/activate-gps - Activate GPS tracking for driver
router.post('/:id/activate-gps', authenticate, async (req, res) => {
  const id = req.params.id;
  const { phone, gpsPermission } = req.body;

  try {
    // Verify this is the driver's own account or admin
    const isAdmin = req.user.role === 'admin';
    const isOwnAccount = req.user.sub === id;

    if (!isAdmin && !isOwnAccount) {
      return res.status(403).json({ error: 'forbidden', message: 'You can only activate GPS for your own account' });
    }

    // Get driver
    const driver = await prisma.driver.findUnique({
      where: { id }
    });

    if (!driver) {
      return res.status(404).json({ error: 'driver_not_found' });
    }

    // Verify phone matches (if provided)
    if (phone && driver.phone && phone !== driver.phone) {
      return res.status(400).json({ error: 'phone_mismatch', message: 'Phone number does not match driver record' });
    }

    if (!driver.phone && !phone) {
      return res.status(400).json({ error: 'phone_required', message: 'Phone number is required for GPS tracking' });
    }

    // Update driver with GPS enabled
    const updated = await prisma.driver.update({
      where: { id },
      data: {
        gpsEnabled: gpsPermission === true,
        gpsPermissionGranted: gpsPermission === true,
        phone: phone || driver.phone // Update phone if provided
      },
      include: {
        account: true,
        status: true
      }
    });

    // Update driver status to available if offline
    if (updated.status?.status === 'offline' || !updated.status) {
      await prisma.driverStatus.upsert({
        where: { driverId: id },
        update: {
          status: 'available',
          updatedAt: new Date()
        },
        create: {
          driverId: id,
          status: 'available'
        }
      });
    }

    console.log(`[GPS] Driver ${id} (${driver.username}) GPS ${gpsPermission ? 'activated' : 'deactivated'}`);

    res.json({
      success: true,
      driver: {
        id: updated.id,
        username: updated.username,
        phone: updated.phone,
        gpsEnabled: updated.gpsEnabled,
        gpsPermissionGranted: updated.gpsPermissionGranted
      },
      message: gpsPermission ? 'GPS tracking activated successfully' : 'GPS tracking deactivated'
    });
  } catch (err) {
    console.error('POST /api/admin/drivers/:id/activate-gps', err);
    res.status(500).json({ error: 'db_error', detail: err.message });
  }
});

// GET /api/admin/sessions - Get active sessions for online user detection
router.get('/sessions', authenticate, requireRole('admin'), async (req, res) => {
  try {
    let activeSessions = [];
    
    // Try to load from sessionStore if it exists
    try {
      const sessionStore = require('../sessionStore');
      if (sessionStore && typeof sessionStore.getAllActiveSessions === 'function') {
        activeSessions = sessionStore.getAllActiveSessions();
      }
    } catch (storeErr) {
      // sessionStore doesn't exist or failed, use time-based fallback
      console.debug('sessionStore not available, using time-based detection');
      
      // Fallback: Get drivers with recent activity (logged in within last 2 minutes)
      const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000);
      const recentDrivers = await prisma.driver.findMany({
        where: {
          account: {
            lastLogin: { gte: twoMinutesAgo }
          }
        },
        include: { account: true }
      });
      
      activeSessions = recentDrivers.map(driver => ({
        userId: driver.id,
        username: driver.account?.username || driver.fullName,
        lastSeen: driver.account?.lastLogin
      }));
    }
    
    res.json({ sessions: activeSessions });
  } catch (err) {
    console.error('GET /api/admin/sessions error:', err);
    res.json({ sessions: [] }); // Return empty on error, frontend will use fallback
  }
});

module.exports = router;
