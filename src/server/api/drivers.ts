// Express router for driver admin endpoints
import { Router, Request, Response } from 'express';
const router = Router();
const { authenticate, requireRole, requireAnyRole } = require('../auth');
const sapService = require('../services/sapService.js');
const prisma = require('../db/prisma').default;
const { hashPassword } = require('../auth');
const cache = require('../cache');

// GET /api/admin/drivers - list drivers (with filters)
// Optimized: cached for 30s, uses select instead of include
router.get('/', authenticate, requireAnyRole('admin', 'delivery_team'), async (req: Request, res: Response): Promise<void> => {
  try {
    const formattedDrivers = await cache.getOrFetch('drivers:list', async () => {
      const drivers = await prisma.driver.findMany({
        select: {
          id: true,
          username: true,
          email: true,
          phone: true,
          fullName: true,
          active: true,
          createdAt: true,
          updatedAt: true,
          account: {
            select: {
              id: true,
              role: true,
              lastLogin: true
            }
          }
        },
        orderBy: { createdAt: 'desc' }
      }) as Array<{
        id: string; username: string; email?: string; phone?: string; fullName?: string;
        active?: boolean; createdAt: string; updatedAt: string;
        account?: { id: string; role?: string; lastLogin?: string };
      }>;

      return drivers.map(driver => ({
        id: driver.id,
        username: driver.username,
        email: driver.email,
        phone: driver.phone,
        fullName: driver.fullName,
        full_name: driver.fullName,
        active: driver.active !== false,
        createdAt: driver.createdAt,
        updatedAt: driver.updatedAt,
        account: driver.account ? {
          id: driver.account.id,
          role: driver.account.role || 'driver',
          lastLogin: driver.account.lastLogin
        } : null
      }));
    }, 30000, 120000); // 30s fresh, 2min max

    res.json({ data: formattedDrivers, meta: { count: (formattedDrivers as unknown[]).length } });
  } catch (err: unknown) {
    const e = err as { message?: string; code?: string; name?: string; meta?: unknown; stack?: string };
    console.error('GET /api/admin/drivers error:', err);
    console.error('Error message:', e.message);
    console.error('Error code:', e.code);
    console.error('Error name:', e.name);
    if (e.meta) {
      console.error('Error meta:', JSON.stringify(e.meta, null, 2));
    }
    console.error('Error stack:', e.stack);

    // More detailed error response
    res.status(500).json({
      error: 'db_error',
      detail: e.message,
      code: e.code,
      name: e.name,
      meta: e.meta,
      stack: process.env.NODE_ENV === 'development' ? e.stack : undefined
    });
  }
});

// POST /api/admin/drivers - create driver/account
router.post('/', authenticate, requireRole('admin'), async (req: Request, res: Response): Promise<void> => {
  const body = req.body as {
    username?: string; password?: string; phone?: string; email?: string;
    full_name?: string; fullName?: string; active?: boolean; role?: string;
  } || {};
  if (!body.username) return void res.status(400).json({ error: 'username_required' });
  if (!body.password) return void res.status(400).json({ error: 'password_required' });
  if (!body.phone) return void res.status(400).json({ error: 'phone_required', message: 'Mobile phone number is required for GPS tracking' });

  try {
    // Check if username already exists
    const existing = await prisma.driver.findUnique({
      where: { username: body.username }
    });

    if (existing) {
      return void res.status(400).json({ error: 'username_already_exists' });
    }

    // Hash password
    const passwordHash = await hashPassword(body.password);

    // Create driver with account in transaction
    const role = body.role || 'driver';
    console.log(`[Create User] Creating user with role: ${role}`);

    const driver = await prisma.$transaction(async (tx: unknown) => {
      const tx_ = tx as { driver: { create: (args: unknown) => Promise<unknown> } };
      const newDriver = await tx_.driver.create({
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
              role: role
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
    }) as { username?: string; account?: { role?: string } };

    console.log(`✅ User created successfully: ${driver.username}, role: ${driver.account?.role}`);
    // Invalidate caches
    cache.delete('drivers:list');
    cache.invalidatePrefix('contacts:');
    cache.invalidatePrefix('tracking:');
    res.status(201).json(driver);
  } catch (err: unknown) {
    const e = err as { message?: string };
    console.error('POST /api/admin/drivers', err);
    res.status(500).json({ error: 'db_error', detail: e.message });
  }
});

// GET /api/admin/drivers/:id
// Allows admin and delivery_team roles to view driver details
router.get('/:id([0-9a-fA-F-]{36})', authenticate, requireAnyRole('admin', 'delivery_team'), async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params as { id: string };
  try {
    const driver = await prisma.driver.findUnique({
      where: { id },
      include: { account: true }
    });

    if (!driver) {
      return void res.status(404).json({ error: 'driver_not_found' });
    }

    res.json(driver);
  } catch (err: unknown) {
    const e = err as { message?: string };
    console.error('GET /api/admin/drivers/:id', err);
    res.status(500).json({ error: 'db_error', detail: e.message });
  }
});

// PUT /api/admin/drivers/:id - full update
router.put('/:id([0-9a-fA-F-]{36})', authenticate, requireRole('admin'), async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params as { id: string };
  const updates = req.body as {
    email?: string; phone?: string; full_name?: string; fullName?: string;
    active?: boolean; password?: string; role?: string;
  } || {};

  try {
    const driver = await prisma.driver.findUnique({
      where: { id },
      include: { account: true }
    }) as { id: string; username?: string; account?: { role?: string } } | null;

    if (!driver) {
      return void res.status(404).json({ error: 'driver_not_found' });
    }

    // Prepare update data
    const driverUpdate: Record<string, unknown> = {
      email: updates.email !== undefined ? updates.email : undefined,
      phone: updates.phone !== undefined ? updates.phone : undefined,
      fullName: updates.full_name || updates.fullName || undefined,
      active: updates.active !== undefined ? updates.active : undefined
    };

    // Remove undefined values
    Object.keys(driverUpdate).forEach(key =>
      driverUpdate[key] === undefined && delete driverUpdate[key]
    );

    const accountUpdate: Record<string, unknown> = {};
    if (updates.password) {
      accountUpdate.passwordHash = await hashPassword(updates.password);
    }
    if (updates.role) {
      accountUpdate.role = updates.role;
    }

    // Update in transaction
    const updated = await prisma.$transaction(async (tx: unknown) => {
      const tx_ = tx as {
        driver: {
          update: (args: unknown) => Promise<unknown>;
          findUnique: (args: unknown) => Promise<unknown>;
        };
        account: { update: (args: unknown) => Promise<unknown> };
      };
      const updatedDriver = await tx_.driver.update({
        where: { id },
        data: driverUpdate,
        include: { account: true }
      });

      if (Object.keys(accountUpdate).length > 0 && driver.account) {
        await tx_.account.update({
          where: { driverId: id },
          data: accountUpdate
        });
      }

      return await tx_.driver.findUnique({
        where: { id },
        include: { account: true }
      });
    }) as { username?: string; account?: { role?: string } };

    console.log(`✅ User updated successfully: ${updated.username}, role: ${updated.account?.role}`);
    cache.delete('drivers:list');
    cache.invalidatePrefix('contacts:');
    res.json(updated);
  } catch (err: unknown) {
    const e = err as { message?: string };
    console.error('PUT /api/admin/drivers/:id', err);
    res.status(500).json({ error: 'db_error', detail: e.message });
  }
});

// PATCH /api/admin/drivers/:id - partial update
router.patch('/:id([0-9a-fA-F-]{36})', authenticate, requireRole('admin'), async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params as { id: string };
  const updates = req.body as {
    email?: string; phone?: string; full_name?: string; fullName?: string;
    active?: boolean; password?: string; role?: string;
  } || {};
  if (!Object.keys(updates).length) return void res.status(400).json({ error: 'no_updates' });

  try {
    const driver = await prisma.driver.findUnique({
      where: { id },
      include: { account: true }
    }) as { id: string; account?: { role?: string } } | null;

    if (!driver) {
      return void res.status(404).json({ error: 'driver_not_found' });
    }

    // Prepare update data
    const driverUpdate: Record<string, unknown> = {};
    if (updates.email !== undefined) driverUpdate.email = updates.email;
    if (updates.phone !== undefined) driverUpdate.phone = updates.phone;
    if (updates.full_name !== undefined || updates.fullName !== undefined) {
      driverUpdate.fullName = updates.full_name || updates.fullName;
    }
    if (updates.active !== undefined) driverUpdate.active = updates.active;

    const accountUpdate: Record<string, unknown> = {};
    if (updates.password) {
      accountUpdate.passwordHash = await hashPassword(updates.password);
    }
    if (updates.role) {
      accountUpdate.role = updates.role;
    }

    // Update in transaction
    const updated = await prisma.$transaction(async (tx: unknown) => {
      const tx_ = tx as {
        driver: {
          update: (args: unknown) => Promise<unknown>;
          findUnique: (args: unknown) => Promise<unknown>;
        };
        account: { update: (args: unknown) => Promise<unknown> };
      };

      if (Object.keys(driverUpdate).length > 0) {
        await tx_.driver.update({
          where: { id },
          data: driverUpdate
        });
      }

      if (Object.keys(accountUpdate).length > 0 && driver.account) {
        await tx_.account.update({
          where: { driverId: id },
          data: accountUpdate
        });
      }

      return await tx_.driver.findUnique({
        where: { id },
        include: { account: true }
      });
    });

    cache.delete('drivers:list');
    cache.invalidatePrefix('contacts:');
    res.json(updated);
  } catch (err: unknown) {
    const e = err as { message?: string };
    console.error('PATCH /api/admin/drivers/:id', err);
    res.status(500).json({ error: 'db_error', detail: e.message });
  }
});

// DELETE /api/admin/drivers/:id
router.delete('/:id([0-9a-fA-F-]{36})', authenticate, requireRole('admin'), async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params as { id: string };

  try {
    const driver = await prisma.driver.findUnique({
      where: { id },
      include: { account: true }
    });

    if (!driver) {
      return void res.status(404).json({ error: 'driver_not_found' });
    }

    // Delete driver (account will be cascade deleted)
    await prisma.driver.delete({
      where: { id }
    });

    cache.delete('drivers:list');
    cache.invalidatePrefix('contacts:');
    cache.invalidatePrefix('tracking:');
    res.json({ ok: true, message: 'Driver deleted successfully' });
  } catch (err: unknown) {
    const e = err as { message?: string };
    console.error('DELETE /api/admin/drivers/:id', err);
    res.status(500).json({ error: 'db_error', detail: e.message });
  }
});

// POST /api/admin/drivers/:id/reset-password
router.post('/:id([0-9a-fA-F-]{36})/reset-password', authenticate, requireRole('admin'), async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params as { id: string };
  try {
    // Forward to SAP if endpoint exists (best-effort)
    const resp = await sapService.call(`/Drivers/${id}/resetPassword`, 'post', req.body || {});
    res.json({ ok: true, data: resp.data });
  } catch (err: unknown) {
    // Fallback: return ok (no-op) but log
    console.error('POST /api/admin/drivers/:id/reset-password (sap)', err);
    res.json({ ok: true, note: 'no-op; SAP call failed or not implemented' });
  }
});

// POST /api/admin/drivers/:id/activate-gps - Activate GPS tracking for driver
router.post('/:id([0-9a-fA-F-]{36})/activate-gps', authenticate, async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params as { id: string };
  const { phone, gpsPermission } = req.body as { phone?: string; gpsPermission?: boolean };

  try {
    // Verify this is the driver's own account or admin
    const isAdmin = req.user?.role === 'admin';
    const isOwnAccount = req.user?.sub === id;

    if (!isAdmin && !isOwnAccount) {
      return void res.status(403).json({ error: 'forbidden', message: 'You can only activate GPS for your own account' });
    }

    // Get driver
    const driver = await prisma.driver.findUnique({
      where: { id }
    }) as { id: string; username?: string; phone?: string; gpsEnabled?: boolean } | null;

    if (!driver) {
      return void res.status(404).json({ error: 'driver_not_found' });
    }

    // Verify phone matches (if provided)
    if (phone && driver.phone && phone !== driver.phone) {
      return void res.status(400).json({ error: 'phone_mismatch', message: 'Phone number does not match driver record' });
    }

    if (!driver.phone && !phone) {
      return void res.status(400).json({ error: 'phone_required', message: 'Phone number is required for GPS tracking' });
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
    }) as {
      id: string; username?: string; phone?: string; gpsEnabled?: boolean;
      gpsPermissionGranted?: boolean; status?: { status?: string };
    };

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
  } catch (err: unknown) {
    const e = err as { message?: string };
    console.error('POST /api/admin/drivers/:id/activate-gps', err);
    res.status(500).json({ error: 'db_error', detail: e.message });
  }
});

// GET /api/admin/drivers/sessions - Get active sessions for online user detection
// Note: global authenticate middleware in api/index.js already runs before this route
router.get('/sessions', async (req: Request, res: Response): Promise<void> => {
  // Allow both admin and delivery_team roles
  const userRole = ((req.user?.account as Record<string, unknown>)?.role || req.user?.role) as string | undefined;
  if (userRole !== 'admin' && userRole !== 'delivery_team') {
    return void res.status(403).json({ error: 'Forbidden - Admin or Delivery Team access required' });
  }

  try {
    const ONLINE_WINDOW_MINUTES = 15;
    const onlineCutoff = new Date(Date.now() - ONLINE_WINDOW_MINUTES * 60 * 1000);
    let activeSessions: unknown[] = [];

    // In serverless (Vercel), the in-memory sessionStore is always fresh per cold start.
    // Try it first; if empty or unavailable fall back to a DB-based lastLogin query.
    try {
      const sessionStore = require('../sessionStore');
      if (sessionStore && typeof sessionStore.getAllActiveSessions === 'function') {
        activeSessions = sessionStore.getAllActiveSessions();
      }
    } catch (_storeErr) {
      // sessionStore unavailable — silent, fall through to DB fallback below
    }

    // Merge DB signals so users with active GPS are not shown offline.
    try {
      const recentUsers = await prisma.driver.findMany({
        where: {
          OR: [
            { account: { lastLogin: { gte: onlineCutoff } } },
            { liveLocations: { some: { recordedAt: { gte: onlineCutoff } } } },
          ]
        },
        select: {
          id: true,
          fullName: true,
          account: { select: { username: true, lastLogin: true, role: true } },
          liveLocations: {
            take: 1,
            orderBy: { recordedAt: 'desc' },
            select: { recordedAt: true }
          }
        },
      }) as Array<{
        id: string;
        fullName?: string;
        account?: { username?: string; lastLogin?: string; role?: string };
        liveLocations?: Array<{ recordedAt?: string | Date }>;
      }>;

      const merged = new Map<string, { userId: string; username?: string; lastSeen?: string | Date; role?: string }>();
      for (const s of activeSessions as Array<{ userId?: string; username?: string; lastSeen?: string | Date; role?: string }>) {
        const userId = s?.userId ? String(s.userId) : '';
        if (!userId) continue;
        merged.set(userId, {
          userId,
          username: s.username,
          lastSeen: s.lastSeen,
          role: s.role
        });
      }

      for (const u of recentUsers) {
        const latestGps = u.liveLocations?.[0]?.recordedAt;
        const latestSeen = latestGps || u.account?.lastLogin;
        merged.set(u.id, {
          userId: u.id,
          username: u.account?.username || u.fullName,
          lastSeen: latestSeen,
          role: u.account?.role
        });
      }

      activeSessions = Array.from(merged.values());
    } catch (dbErr: unknown) {
      const e = dbErr as { message?: string };
      console.warn('GET /api/admin/drivers/sessions DB merge error:', e.message);
    }

    return void res.json({ sessions: activeSessions });
  } catch (err: unknown) {
    console.error('GET /api/admin/drivers/sessions error:', err);
    return void res.json({ sessions: [] });
  }
});

export default router;
