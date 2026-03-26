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

    // Create driver and account in a transaction using raw SQL to avoid column mismatch issues
    const driverId = await prisma.$transaction(async (tx: unknown) => {
      const tx_ = tx as { $queryRawUnsafe: (sql: string, ...args: unknown[]) => Promise<Array<{ id: string }>> };

      // Insert driver (only columns guaranteed to exist in DB)
      const driverRows = await tx_.$queryRawUnsafe(
        `INSERT INTO drivers (id, username, email, phone, full_name, active, created_at, updated_at)
         VALUES (gen_random_uuid(), $1::varchar, $2::varchar, $3::varchar, $4::varchar, $5::boolean, now(), now())
         RETURNING id::text`,
        body.username,
        body.email || null,
        body.phone,
        body.full_name || body.fullName || null,
        body.active !== false
      );
      const newId = driverRows[0]?.id;
      if (!newId) throw new Error('Failed to get new driver id');

      // Insert account
      await tx_.$queryRawUnsafe(
        `INSERT INTO accounts (id, driver_id, password_hash, role, created_at)
         VALUES (gen_random_uuid(), $1::uuid, $2, $3, now())`,
        newId,
        passwordHash,
        role
      );

      // Insert driver_status (best effort — table may not exist in all envs)
      try {
        await tx_.$queryRawUnsafe(
          `INSERT INTO driver_status (driver_id, status, updated_at) VALUES ($1::uuid, 'offline', now())
           ON CONFLICT (driver_id) DO NOTHING`,
          newId
        );
      } catch (_e) {
        // driver_status table optional
      }

      return newId;
    });

    const driver = { id: driverId, username: body.username, role };

    console.log(`✅ User created successfully: ${driver.username}, role: ${driver.role}`);
    // Invalidate caches
    cache.del('drivers:list');
    cache.invalidatePrefix('contacts:');
    cache.invalidatePrefix('tracking:');
    res.status(201).json(driver);
  } catch (err: unknown) {
    const e = err as { message?: string; code?: string; meta?: unknown };
    console.error('POST /api/admin/drivers', err);
    res.status(500).json({ error: e.message || 'db_error', detail: e.message, code: e.code, meta: e.meta });
  }
});

// GET /api/admin/drivers/:id
// Allows admin and delivery_team roles to view driver details
router.get('/:id([0-9a-fA-F-]{36})', authenticate, requireAnyRole('admin', 'delivery_team'), async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params as { id: string };
  try {
    type DR = { id: string; username: string; email: string; phone: string; full_name: string; active: boolean };
    type AR = { role: string; last_login: string };
    const [dRows, aRows] = await Promise.all([
      prisma.$queryRawUnsafe(`SELECT id::text, username, email, phone, full_name, active FROM drivers WHERE id = $1::uuid`, id) as Promise<DR[]>,
      prisma.$queryRawUnsafe(`SELECT role, last_login FROM accounts WHERE driver_id = $1::uuid`, id) as Promise<AR[]>,
    ]);
    if (!dRows.length) return void res.status(404).json({ error: 'driver_not_found' });
    res.json({ ...dRows[0], account: aRows[0] ?? null });
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
    const exists = (await prisma.$queryRawUnsafe(`SELECT id::text FROM drivers WHERE id = $1::uuid`, id)) as Array<{ id: string }>;
    if (!exists.length) return void res.status(404).json({ error: 'driver_not_found' });

    // Build SET clause with explicit type casts
    const setClauses: string[] = [];
    const params: unknown[] = [];
    let idx = 1;
    if (updates.email !== undefined)  { setClauses.push(`email = $${idx}::varchar`);    params.push(updates.email);  idx++; }
    if (updates.phone !== undefined)  { setClauses.push(`phone = $${idx}::varchar`);    params.push(updates.phone);  idx++; }
    const fn = updates.full_name || updates.fullName;
    if (fn !== undefined)             { setClauses.push(`full_name = $${idx}::varchar`); params.push(fn);             idx++; }
    if (updates.active !== undefined) { setClauses.push(`active = $${idx}::boolean`);   params.push(updates.active); idx++; }
    setClauses.push('updated_at = now()');
    params.push(id);
    if (setClauses.length > 1) {
      await prisma.$queryRawUnsafe(`UPDATE drivers SET ${setClauses.join(', ')} WHERE id = $${idx}::uuid`, ...params);
    }
    if (updates.password) {
      const h = await hashPassword(updates.password);
      await prisma.$queryRawUnsafe(`UPDATE accounts SET password_hash = $1::text WHERE driver_id = $2::uuid`, h, id);
    }
    if (updates.role) {
      await prisma.$queryRawUnsafe(`UPDATE accounts SET role = $1::varchar WHERE driver_id = $2::uuid`, updates.role, id);
    }

    type DR = { id: string; username: string; email: string; phone: string; full_name: string; active: boolean };
    type AR = { role: string };
    const [dr, ar] = await Promise.all([
      prisma.$queryRawUnsafe(`SELECT id::text, username, email, phone, full_name, active FROM drivers WHERE id = $1::uuid`, id) as Promise<DR[]>,
      prisma.$queryRawUnsafe(`SELECT role FROM accounts WHERE driver_id = $1::uuid`, id) as Promise<AR[]>,
    ]);
    const updated = { ...(dr as DR[])[0], account: { role: (ar as AR[])[0]?.role } };

    console.log(`✅ User updated: ${updated.username}, role: ${updated.account?.role}`);
    cache.del('drivers:list');
    cache.invalidatePrefix('contacts:');
    res.json(updated);
  } catch (err: unknown) {
    const e = err as { message?: string };
    console.error('PUT /api/admin/drivers/:id', err);
    res.status(500).json({ error: e.message || 'db_error', detail: e.message });
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
    const exists = (await prisma.$queryRawUnsafe(`SELECT id::text FROM drivers WHERE id = $1::uuid`, id)) as Array<{ id: string }>;
    if (!exists.length) return void res.status(404).json({ error: 'driver_not_found' });

    const setClauses: string[] = [];
    const params: unknown[] = [];
    let idx = 1;
    if (updates.email !== undefined)  { setClauses.push(`email = $${idx}::varchar`);    params.push(updates.email);  idx++; }
    if (updates.phone !== undefined)  { setClauses.push(`phone = $${idx}::varchar`);    params.push(updates.phone);  idx++; }
    const fn = updates.full_name || updates.fullName;
    if (fn !== undefined)             { setClauses.push(`full_name = $${idx}::varchar`); params.push(fn);             idx++; }
    if (updates.active !== undefined) { setClauses.push(`active = $${idx}::boolean`);   params.push(updates.active); idx++; }
    setClauses.push('updated_at = now()');
    params.push(id);
    if (setClauses.length > 1) {
      await prisma.$queryRawUnsafe(`UPDATE drivers SET ${setClauses.join(', ')} WHERE id = $${idx}::uuid`, ...params);
    }
    if (updates.password) {
      const h = await hashPassword(updates.password);
      await prisma.$queryRawUnsafe(`UPDATE accounts SET password_hash = $1::text WHERE driver_id = $2::uuid`, h, id);
    }
    if (updates.role) {
      await prisma.$queryRawUnsafe(`UPDATE accounts SET role = $1::varchar WHERE driver_id = $2::uuid`, updates.role, id);
    }

    type DR = { id: string; username: string; email: string; phone: string; full_name: string; active: boolean };
    type AR = { role: string };
    const [dr, ar] = await Promise.all([
      prisma.$queryRawUnsafe(`SELECT id::text, username, email, phone, full_name, active FROM drivers WHERE id = $1::uuid`, id) as Promise<DR[]>,
      prisma.$queryRawUnsafe(`SELECT role FROM accounts WHERE driver_id = $1::uuid`, id) as Promise<AR[]>,
    ]);
    const updated = { ...(dr as DR[])[0], account: { role: (ar as AR[])[0]?.role } };

    cache.del('drivers:list');
    cache.invalidatePrefix('contacts:');
    res.json(updated);
  } catch (err: unknown) {
    const e = err as { message?: string };
    console.error('PATCH /api/admin/drivers/:id', err);
    res.status(500).json({ error: e.message || 'db_error', detail: e.message });
  }
});

// DELETE /api/admin/drivers/:id
router.delete('/:id([0-9a-fA-F-]{36})', authenticate, requireRole('admin'), async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params as { id: string };

  try {
    const rows = (await prisma.$queryRawUnsafe(`SELECT id::text FROM drivers WHERE id = $1::uuid`, id)) as Array<{ id: string }>;
    if (!rows.length) return void res.status(404).json({ error: 'driver_not_found' });

    // Delete driver (account cascades via FK)
    await prisma.$queryRawUnsafe(`DELETE FROM drivers WHERE id = $1::uuid`, id);

    cache.del('drivers:list');
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
