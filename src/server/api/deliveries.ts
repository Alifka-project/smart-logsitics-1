import { Router, Request, Response } from 'express';
import { randomUUID } from 'crypto';
import {
  assertSlotAvailable,
  dubaiDayRangeUtc,
  getDubaiWeekday,
  getDubaiTodayIso,
  addDubaiCalendarDays,
  getNextSevenEligibleDayIsoStrings,
  getDriverItemCountForDate,
  parseDeliveryItemCount,
  TRUCK_MAX_ITEMS_PER_DAY
} from '../services/deliveryCapacityService';
const router = Router();
const { authenticate, requireRole, requireAnyRole } = require('../auth');
const sapService = require('../services/sapService.js');
const { autoAssignDelivery, autoAssignDeliveries, getAvailableDrivers } = require('../services/autoAssignmentService');
const { buildBusinessKey, upsertDeliveryByBusinessKey } = require('../services/deliveryDedupService');
const prisma = require('../db/prisma').default;
const cache = require('../cache');
const { sortDeliveriesIncompleteLast } = require('../utils/deliveryListSort');
const { normalizePhone } = require('../utils/phoneUtils');

async function deliveryExists(deliveryId: string): Promise<boolean> {
  try {
    const resp = await sapService.call(`/Deliveries/${deliveryId}`, 'get');
    return resp && resp.status && resp.status < 400;
  } catch (e) {
    return false;
  }
}

// POST /api/deliveries/:id/status
// body: { status, actor_type, actor_id, note }
router.post('/:id/status', authenticate, async (req: Request, res: Response): Promise<void> => {
  const { id: deliveryId } = req.params as { id: string };
  const { status, actor_type, actor_id, note } = req.body as {
    status?: string; actor_type?: string; actor_id?: string; note?: string;
  };

  if (!status) return void res.status(400).json({ error: 'status_required' });

  const exists = await deliveryExists(deliveryId);
  if (!exists) return void res.status(404).json({ error: 'delivery_not_found' });

  try {
    // Forward status update to SAP
    const payload = { status, actor_type, actor_id, note };
    const resp = await sapService.call(`/Deliveries/${deliveryId}/status`, 'post', payload);
    res.status(resp.status || 200).json({ ok: true, status: status, data: resp.data });
  } catch (err: unknown) {
    const e = err as { message?: string; response?: { status?: number } };
    console.error('deliveries status update error (sap)', err);
    const statusCode = e.response && e.response.status ? e.response.status : 500;
    res.status(statusCode).json({ error: 'sap_error', detail: e.message });
  }
});

// Shared status update logic - used by both admin and driver
async function updateDeliveryStatusHandler(
  req: Request,
  deliveryIdParam: string,
  body: {
    status?: string;
    notes?: string;
    driverSignature?: string;
    customerSignature?: string;
    photos?: Array<string | { data?: string; name?: string; id?: string; type?: string }>;
    actualTime?: string;
    customer?: string;
    address?: string;
    scheduledDate?: string;
    goodsMovementDate?: string;
  },
  options: { requireAssignment?: boolean; driverId?: string }
): Promise<{ ok: boolean; delivery?: unknown; previousDelivery?: unknown; error?: string }> {
  const { status, notes, driverSignature, customerSignature, photos, actualTime, customer, address, scheduledDate } = body;
  if (!status) return { ok: false, error: 'status_required' };

  let existingDelivery: Record<string, unknown> | null = null;
  try {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (uuidRegex.test(deliveryIdParam)) {
      existingDelivery = await prisma.delivery.findUnique({ where: { id: deliveryIdParam } });
    }
  } catch {
    /* ignore */
  }

  if (!existingDelivery && customer && address) {
    existingDelivery = await prisma.delivery.findFirst({
      where: { customer, address },
      orderBy: { createdAt: 'desc' }
    });
  }

  if (!existingDelivery) return { ok: false, error: 'delivery_not_found' };

  // Guard: dispatch statuses require Goods Movement Date to be set on the delivery.
  // Normalise underscore ↔ hyphen variants so both UI formats are covered:
  //   types/delivery.ts uses out_for_delivery (underscore)
  //   API / DB stores   out-for-delivery (hyphen)
  // Rule: without a GMD the warehouse has NOT dispatched the item, so the system
  // must refuse any attempt to move it into a dispatch status.
  const DISPATCH_STATUSES_GUARD = new Set([
    'out-for-delivery', 'out_for_delivery',
    'dispatched',
    'on-route', 'on_route',
  ]);
  if (status && DISPATCH_STATUSES_GUARD.has(status.toLowerCase())) {
    const existingGMD = (existingDelivery as Record<string, unknown>).goodsMovementDate;
    const bodyGMD = (body as Record<string, unknown>).goodsMovementDate;
    const hasGMD = !!(existingGMD || bodyGMD);
    if (!hasGMD) {
      return {
        ok: false,
        error: 'goods_movement_date_required',
      };
    }
  }

  if (options.requireAssignment && options.driverId) {
    const assignment = await prisma.deliveryAssignment.findFirst({
      where: { deliveryId: existingDelivery.id as string, driverId: options.driverId }
    });
    if (!assignment) {
      return { ok: false, error: 'delivery_not_assigned_to_driver' };
    }
  }

  const prevMeta = existingDelivery.metadata && typeof existingDelivery.metadata === 'object'
    ? (existingDelivery.metadata as Record<string, unknown>) : {};
  const nextMeta: Record<string, unknown> = {
    ...prevMeta,
    statusUpdatedAt: new Date().toISOString(),
    statusUpdatedBy: req.user?.sub || 'admin',
    actualTime: actualTime != null ? actualTime : (prevMeta.actualTime ?? null),
  };
  if (scheduledDate != null && String(scheduledDate).trim() !== '') {
    try {
      const d = new Date(scheduledDate);
      if (!Number.isNaN(d.getTime())) nextMeta.scheduledDate = d.toISOString();
    } catch {
      /* ignore */
    }
  }

  const updateData: Record<string, unknown> = {
    status,
    metadata: nextMeta,
    updatedAt: new Date()
  };
  // If a Goods Movement Date is being set for the first time alongside a dispatch status, persist it
  if (body.goodsMovementDate) {
    const gmdDate = new Date(String(body.goodsMovementDate));
    if (!isNaN(gmdDate.getTime())) {
      updateData.goodsMovementDate = gmdDate;
    }
  }
  if (driverSignature) updateData.driverSignature = driverSignature;
  if (customerSignature) updateData.customerSignature = customerSignature;
  if (photos && Array.isArray(photos) && photos.length > 0) {
    updateData.photos = photos.map((p) => ({
      data: typeof p === 'string' ? p : ((p as { data?: string }).data || p),
      name: typeof p === 'object' && p != null ? ((p as { name?: string }).name || null) : null
    }));
  }
  if (notes) {
    updateData.deliveryNotes = notes;
    updateData.conditionNotes = notes;
  }
  if (['delivered', 'completed', 'delivered-with-installation', 'delivered-without-installation'].includes(status.toLowerCase())) {
    updateData.deliveredAt = new Date();
    updateData.deliveredBy = req.user?.username || req.user?.email || req.user?.sub || 'driver';
    updateData.podCompletedAt = new Date();
  }

  const isTerminalStatus = ['delivered', 'completed', 'delivered-with-installation',
    'delivered-without-installation', 'cancelled', 'returned', 'failed'].includes(status.toLowerCase());

  // Run delivery update + assignment closure atomically so both succeed or both fail.
  // Driver status recalculation runs outside the transaction (read-then-write, low-risk).
  let updatedDelivery: Record<string, unknown>;
  let affectedDriverIds: string[] = [];

  try {
    const txResult = await prisma.$transaction(async (tx: typeof prisma) => {
      const updated = await tx.delivery.update({
        where: { id: existingDelivery!.id },
        data: updateData
      }) as Record<string, unknown>;

      let closedAssignmentDriverIds: string[] = [];
      if (isTerminalStatus) {
        const closing = await tx.deliveryAssignment.findMany({
          where: { deliveryId: existingDelivery!.id as string, status: { in: ['assigned', 'in_progress'] } },
          select: { driverId: true }
        });
        closedAssignmentDriverIds = Array.from(new Set<string>(closing.map((a: { driverId: string }) => a.driverId)));
        await tx.deliveryAssignment.updateMany({
          where: { deliveryId: existingDelivery!.id as string, status: { in: ['assigned', 'in_progress'] } },
          data: { status: 'completed' }
        });
      }
      return { updated, closedAssignmentDriverIds };
    });
    updatedDelivery = txResult.updated;
    affectedDriverIds = txResult.closedAssignmentDriverIds;
  } catch (txErr: unknown) {
    console.error('[Deliveries] Status update transaction failed:', (txErr as Error).message);
    return { ok: false, error: 'status_update_failed' };
  }

  // After transaction: recalculate driver availability (outside tx — read-then-write is safe here)
  for (const driverId of affectedDriverIds) {
    try {
      const remaining = await prisma.deliveryAssignment.count({
        where: { driverId, status: { in: ['assigned', 'in_progress'] } }
      });
      if (remaining === 0) {
        await prisma.driverStatus.upsert({
          where: { driverId },
          update: { status: 'available', currentAssignmentId: null, updatedAt: new Date() },
          create: { driverId, status: 'available' }
        });
      }
    } catch (e: unknown) {
      console.warn('[Deliveries] Failed to reset driver status:', (e as Error).message);
    }
  }

  // Bust caches so the next admin reload reflects the change immediately
  cache.invalidatePrefix('tracking:');
  cache.invalidatePrefix('deliveries:list:');

  // When an order is confirmed for delivery (scheduled-confirmed):
  // Auto-assign a driver if none yet, so the driver can see upcoming work
  // before the admin formally dispatches.
  if (status.toLowerCase() === 'scheduled-confirmed') {
    try {
      const existingAssignment = await prisma.deliveryAssignment.findFirst({
        where: {
          deliveryId: existingDelivery.id as string,
          status: { in: ['assigned', 'in_progress'] }
        }
      });
      if (!existingAssignment) {
        await autoAssignDelivery(existingDelivery.id as string);
      }
    } catch (assignErr: unknown) {
      // Non-fatal — log but don't fail the status update.
      console.warn('[Deliveries] scheduled-confirmed auto-assign failed:', (assignErr as Error).message);
    }
  }

  // When dispatching (out-for-delivery):
  // 1. Auto-assign a driver if none is assigned yet (so the driver sees the order).
  // 2. Promote any existing assignment to in_progress so the driver's portal shows
  //    the delivery as actively in transit.
  if (status.toLowerCase() === 'out-for-delivery') {
    try {
      const activeAssignment = await prisma.deliveryAssignment.findFirst({
        where: {
          deliveryId: existingDelivery.id as string,
          status: { in: ['assigned', 'in_progress'] }
        }
      });
      if (!activeAssignment) {
        // No driver yet — auto-assign so the order lands in a driver's list.
        await autoAssignDelivery(existingDelivery.id as string);
      } else {
        // Promote to in_progress so the driver knows they're actively en route.
        await prisma.deliveryAssignment.updateMany({
          where: {
            deliveryId: existingDelivery.id as string,
            status: 'assigned'
          },
          data: { status: 'in_progress' }
        });
      }
    } catch (dispatchErr: unknown) {
      // Non-fatal — log but don't fail the status update.
      console.warn('[Deliveries] dispatch assignment step failed:', (dispatchErr as Error).message);
    }
  }

  await prisma.deliveryEvent.create({
    data: {
      deliveryId: existingDelivery.id,
      eventType: 'status_updated',
      payload: {
        previousStatus: existingDelivery.status,
        newStatus: status,
        notes,
        actualTime,
        hasPOD: !!(driverSignature || customerSignature || (photos && photos.length > 0)),
        photoCount: photos ? photos.length : 0,
        hasDriverSignature: !!driverSignature,
        hasCustomerSignature: !!customerSignature,
        updatedAt: new Date().toISOString()
      },
      actorType: req.user?.role || 'driver',
      actorId: req.user?.sub || null
    }
  }).catch((err: unknown) => {
    console.warn(`[Deliveries] Failed to create audit event:`, (err as Error).message);
  });

  cache.invalidatePrefix('tracking:');
  cache.invalidatePrefix('dashboard:');
  cache.invalidatePrefix('deliveries:list:v2');

  return { ok: true, delivery: updatedDelivery, previousDelivery: existingDelivery };
}

// PUT /api/deliveries/driver/:id/status - Driver POD/status update (assigned deliveries only)
router.put('/driver/:id/status', authenticate, requireRole('driver'), async (req: Request, res: Response): Promise<void> => {
  const { id: deliveryIdParam } = req.params as { id: string };
  const driverId = (req.user as { sub?: string })?.sub;
  if (!driverId) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }
  const body = req.body as {
    status?: string;
    notes?: string;
    driverSignature?: string;
    customerSignature?: string;
    photos?: Array<string | { data?: string; name?: string }>;
    actualTime?: string;
    customer?: string;
    address?: string;
  };
  try {
    const result = await updateDeliveryStatusHandler(req, deliveryIdParam, body, {
      requireAssignment: true,
      driverId
    });
    if (!result.ok) {
      const code = result.error === 'delivery_not_found' ? 404 : result.error === 'delivery_not_assigned_to_driver' ? 403 : 400;
      res.status(code).json({ error: result.error || 'update_failed' });
      return;
    }
    res.json({ ok: true, delivery: result.delivery });
  } catch (err: unknown) {
    const e = err as { message?: string };
    console.error('[Deliveries] Driver status update error:', err);
    res.status(500).json({ error: 'db_error', detail: e.message });
  }
});

// PUT /api/admin/deliveries/:id/status - Update delivery status in database
// body: { status, notes, driverSignature, customerSignature, photos, actualTime, customer, address }
router.put('/admin/:id/status', authenticate, requireAnyRole('admin', 'delivery_team', 'logistics_team'), async (req: Request, res: Response): Promise<void> => {
  const { id: deliveryIdParam } = req.params as { id: string };
  const body = req.body as {
    status?: string;
    notes?: string;
    driverSignature?: string;
    customerSignature?: string;
    photos?: Array<string | { data?: string; name?: string; id?: string; type?: string }>;
    actualTime?: string;
    customer?: string;
    address?: string;
    scheduledDate?: string;
    goodsMovementDate?: string;
  };

  try {
    console.log(`[Deliveries] Admin updating delivery ${deliveryIdParam} status to ${body.status}`);
    const result = await updateDeliveryStatusHandler(req, deliveryIdParam, body, {});
    if (!result.ok) {
      const code = result.error === 'delivery_not_found' ? 404 : 400;
      res.status(code).json({ error: result.error || 'update_failed' });
      return;
    }
    const updatedDelivery = result.delivery as Record<string, unknown>;
    const existingDelivery = result.previousDelivery as Record<string, unknown>;
    const status = body.status || '';

    // Create admin notification for status change (fire-and-forget)
    prisma.adminNotification.create({
      data: {
        type: 'status_changed',
        title: 'Delivery Status Updated',
        message: `${existingDelivery?.customer || 'Unknown customer'} — ${existingDelivery?.address || 'Unknown address'}: ${existingDelivery?.status} → ${status}`,
        payload: {
          deliveryId: existingDelivery?.id,
          customer: existingDelivery?.customer,
          address: existingDelivery?.address,
          poNumber: existingDelivery?.poNumber,
          previousStatus: existingDelivery?.status,
          newStatus: status,
          updatedBy: req.user?.username || req.user?.sub || 'admin'
        }
      }
    }).catch((err: unknown) => {
      const e = err as { message?: string };
      console.warn(`[Deliveries] Failed to create status notification:`, e.message);
    });

    // Optionally notify customer by SMS for key status changes
    try {
      const lowerStatus = (status || '').toLowerCase();
      const phone = (updatedDelivery.phone || existingDelivery.phone) as string | undefined;

      if (phone) {
        const smsService = require('../sms/smsService');
        const frontendUrl = process.env.FRONTEND_URL || 'https://electrolux-smart-portal.vercel.app';
        const token = (updatedDelivery.confirmationToken || existingDelivery.confirmationToken) as string | undefined;
        const trackingLink = token ? `${frontendUrl}/customer-tracking/${token}` : null;
        const customerName = (updatedDelivery.customer || existingDelivery.customer || 'Valued Customer') as string;
        const poNum = (updatedDelivery.poNumber || existingDelivery.poNumber) as string | undefined;
        const poRef = poNum ? `#${poNum}` : '';

        // ── STATUS SMS TEMPORARILY DISABLED — D7 provider compliance pending ────
        // All smsAdapter.sendSms() calls below are commented out.
        // Message bodies are still built (for logging/wa.me links) but not sent.
        // Restore by removing the comment wrappers once D7 approval is granted.

        // Out for delivery (same day as scheduled)
        if (lowerStatus === 'out-for-delivery') {
          const body = `Dear ${customerName},\n\nYour Electrolux order ${poRef} is out for delivery today.\n${trackingLink ? `\nTrack your delivery in real time:\n${trackingLink}\n` : ''}\nFor assistance, please contact the Electrolux Delivery Team at +971524408687.\n\nThank you,\nElectrolux Delivery Team`;

          // const smsResult = await smsService.smsAdapter.sendSms({
          //   to: phone, body,
          //   metadata: { deliveryId: updatedDelivery.id, type: 'status_out_for_delivery' }
          // }) as { messageId?: string; status?: string };
          const { buildWhatsAppLink: _bwa1 } = require('../sms/waLink');
          console.log('[SMS→WhatsApp] OFD link:', (_bwa1 as (p: string, b: string) => string)(phone, body));

          await prisma.smsLog.create({
            data: {
              deliveryId: updatedDelivery.id,
              phoneNumber: phone,
              messageContent: body,
              smsProvider: 'whatsapp-link',
              status: 'whatsapp_link_generated',
              sentAt: new Date(),
              metadata: { type: 'status_out_for_delivery' }
            }
          });
        }

        // Order delay: logistics team cannot dispatch — notify customer to reschedule
        if (lowerStatus === 'order-delay') {
          const body = `Dear ${customerName},\n\nWe regret to inform you that your Electrolux delivery ${poRef} has been delayed and could not be dispatched as scheduled.\n\nOur delivery team will contact you shortly to arrange a new delivery date at your convenience.\n${trackingLink ? `\nYou can also view your order status at:\n${trackingLink}\n` : ''}\nWe apologise for any inconvenience. For assistance, please contact us at +971524408687.\n\nThank you for your patience,\nElectrolux Delivery Team`;

          // const smsResult = await smsService.smsAdapter.sendSms({
          //   to: phone, body,
          //   metadata: { deliveryId: updatedDelivery.id, type: 'status_order_delay' }
          // }) as { messageId?: string; status?: string };
          const { buildWhatsAppLink: _bwa2 } = require('../sms/waLink');
          console.log('[SMS→WhatsApp] Delay link:', (_bwa2 as (p: string, b: string) => string)(phone, body));

          await prisma.smsLog.create({
            data: {
              deliveryId: updatedDelivery.id as string,
              phoneNumber: phone,
              messageContent: body,
              smsProvider: 'whatsapp-link',
              status: 'whatsapp_link_generated',
              sentAt: new Date(),
              metadata: { type: 'status_order_delay' }
            }
          });
        }

        // Order finished: send final thank-you SMS ONLY once, when moving into a true
        // "finished" state (completed / POD done). Do NOT send when the item just arrives.
        const prevStatus = (String(existingDelivery.status || '')).toLowerCase();
        const completionStatuses = ['completed'];
        const wasAlreadyFinished = completionStatuses.includes(prevStatus);

        if (completionStatuses.includes(lowerStatus) && !wasAlreadyFinished) {
          const body = `Dear ${customerName},\n\nYour Electrolux delivery ${poRef} has been completed.\n\nThank you for choosing Electrolux.`;

          // const smsResult = await smsService.smsAdapter.sendSms({
          //   to: phone, body,
          //   metadata: { deliveryId: updatedDelivery.id, type: 'status_order_finished' }
          // }) as { messageId?: string; status?: string };
          const { buildWhatsAppLink: _bwa3 } = require('../sms/waLink');
          console.log('[SMS→WhatsApp] Completed link:', (_bwa3 as (p: string, b: string) => string)(phone, body));

          await prisma.smsLog.create({
            data: {
              deliveryId: updatedDelivery.id,
              phoneNumber: phone,
              messageContent: body,
              smsProvider: 'whatsapp-link',
              status: 'whatsapp_link_generated',
              sentAt: new Date(),
              metadata: { type: 'status_order_finished' }
            }
          });
        }
      }
    } catch (notifyErr: unknown) {
      const ne = notifyErr as { message?: string };
      console.warn('[Deliveries] Failed to send customer status SMS:', ne.message);
    }

    res.json({
      ok: true,
      status: status,
      delivery: {
        id: updatedDelivery.id,
        customer: updatedDelivery.customer,
        address: updatedDelivery.address,
        status: updatedDelivery.status,
        updatedAt: updatedDelivery.updatedAt
      }
    });
  } catch (err: unknown) {
    const e = err as { message?: string };
    console.error('deliveries status update error (database)', err);
    res.status(500).json({ error: 'status_update_failed', detail: e.message });
  }
});

// PUT /admin/:id/contact - Update delivery contact details (address, phone, lat, lng)
router.put('/admin/:id/contact', authenticate, requireAnyRole('admin', 'delivery_team', 'logistics_team'), async (req: Request, res: Response): Promise<void> => {
  const { id: deliveryIdParam } = req.params as { id: string };
  const { customer, address, phone, lat, lng } = req.body as {
    customer?: string; address?: string; phone?: string; lat?: unknown; lng?: unknown;
  };

  if (!address && !phone) {
    return void res.status(400).json({ error: 'address_or_phone_required' });
  }

  try {
    console.log(`[Deliveries] Updating contact for delivery ${deliveryIdParam}`);

    let existingDelivery: Record<string, unknown> | null = null;

    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (uuidRegex.test(deliveryIdParam)) {
      existingDelivery = await prisma.delivery.findUnique({ where: { id: deliveryIdParam } });
    }

    if (!existingDelivery && customer && address) {
      existingDelivery = await prisma.delivery.findFirst({
        where: { customer, address },
        orderBy: { createdAt: 'desc' }
      });
    }

    if (!existingDelivery) {
      console.warn(`[Deliveries] Delivery not found for contact update: id=${deliveryIdParam}`);
      return void res.status(404).json({ error: 'delivery_not_found' });
    }

    const updateData: Record<string, unknown> = { updatedAt: new Date() };
    if (address) updateData.address = address;
    if (phone)   updateData.phone = phone;
    if (lat != null && !Number.isNaN(Number(lat)))  updateData.lat = Number(lat);
    if (lng != null && !Number.isNaN(Number(lng)))  updateData.lng = Number(lng);

    const updatedDelivery = await prisma.delivery.update({
      where: { id: existingDelivery.id },
      data: updateData
    }) as Record<string, unknown>;

    cache.invalidatePrefix('tracking:');
    cache.invalidatePrefix('dashboard:');
    cache.del('deliveries:list:v2');

    console.log(`[Deliveries] Contact updated for delivery ${existingDelivery.id}`);

    res.json({
      ok: true,
      delivery: {
        id: updatedDelivery.id,
        customer: updatedDelivery.customer,
        address: updatedDelivery.address,
        phone: updatedDelivery.phone,
        lat: updatedDelivery.lat,
        lng: updatedDelivery.lng,
        updatedAt: updatedDelivery.updatedAt
      }
    });
  } catch (err: unknown) {
    const e = err as { message?: string };
    console.error('[Deliveries] contact update error:', err);
    res.status(500).json({ error: 'contact_update_failed', detail: e.message });
  }
});

// POST /api/deliveries/:id/assign - assign driver
// body: { driver_id }
router.post('/:id/assign', authenticate, requireRole('admin'), async (req: Request, res: Response): Promise<void> => {
  const { id: deliveryId } = req.params as { id: string };
  const { driver_id } = req.body as { driver_id?: string };
  if (!driver_id) return void res.status(400).json({ error: 'driver_id_required' });
  const exists = await deliveryExists(deliveryId);
  if (!exists) return void res.status(404).json({ error: 'delivery_not_found' });
  try {
    const resp = await sapService.call(`/Deliveries/${deliveryId}/assign`, 'post', { driver_id });
    res.status(resp.status || 200).json({ ok: true, assignment: resp.data });
  } catch (err: unknown) {
    const e = err as { message?: string; response?: { status?: number } };
    console.error('deliveries assign error (sap)', err);
    const statusCode = e.response && e.response.status ? e.response.status : 500;
    res.status(statusCode).json({ error: 'sap_error', detail: e.message });
  }
});

// GET /api/deliveries/:id/events
router.get('/:id/events', authenticate, requireRole('admin'), async (req: Request, res: Response): Promise<void> => {
  const { id: deliveryId } = req.params as { id: string };
  try {
    const resp = await sapService.call(`/Deliveries/${deliveryId}/events`, 'get');
    res.json({ events: resp.data && resp.data.value ? resp.data.value : resp.data });
  } catch (err: unknown) {
    const e = err as { message?: string; response?: { status?: number } };
    console.error('deliveries events error (sap)', err);
    const statusCode = e.response && e.response.status ? e.response.status : 500;
    res.status(statusCode).json({ error: 'sap_error', detail: e.message });
  }
});

// GET /api/deliveries/debug/check-po-numbers - Debug endpoint to check PO numbers in database
router.get('/debug/check-po-numbers', authenticate, requireRole('admin'), async (req: Request, res: Response): Promise<void> => {
  try {
    const deliveries = await prisma.delivery.findMany({
      select: {
        id: true,
        customer: true,
        poNumber: true,
        metadata: true,
        createdAt: true
      },
      orderBy: {
        createdAt: 'desc'
      },
      take: 20
    }) as Array<{ id: string; customer: string; poNumber?: string; metadata?: Record<string, unknown>; createdAt: string }>;

    const stats = {
      total: deliveries.length,
      withPONumber: deliveries.filter(d => d.poNumber).length,
      withoutPONumber: deliveries.filter(d => !d.poNumber).length,
      withMetadataPO: deliveries.filter(d => d.metadata?.originalPONumber).length
    };

    res.json({
      stats,
      recentDeliveries: deliveries.map(d => ({
        id: d.id.substring(0, 8),
        customer: d.customer,
        poNumber: d.poNumber,
        metadataPO: d.metadata?.originalPONumber,
        createdAt: d.createdAt
      }))
    });
  } catch (error: unknown) {
    const e = error as { message?: string };
    console.error('[Deliveries/Debug] Error checking PO numbers:', error);
    res.status(500).json({ error: e.message });
  }
});

// POST /api/deliveries/upload - Save uploaded delivery data and auto-assign
router.post('/upload', authenticate, requireAnyRole('admin', 'delivery_team', 'logistics_team'), async (req: Request, res: Response): Promise<void> => {
  try {
    const { deliveries } = req.body as { deliveries?: Record<string, unknown>[] };

    console.log(`[Deliveries/Upload] *** UPLOAD ENDPOINT RECEIVED ***`);
    console.log(`[Deliveries/Upload] Received ${deliveries?.length || 0} deliveries to save`);

    // Log the FIRST delivery in full detail
    if (deliveries && deliveries.length > 0) {
      console.log(`[Deliveries/Upload] *** FIRST DELIVERY IN REQUEST ***`);
      console.log(`[Deliveries/Upload] First delivery keys:`, Object.keys(deliveries[0]));
      console.log(`[Deliveries/Upload] First delivery._originalPONumber:`, deliveries[0]._originalPONumber);
      console.log(`[Deliveries/Upload] First delivery._originalDeliveryNumber:`, deliveries[0]._originalDeliveryNumber);
      console.log(`[Deliveries/Upload] First delivery:`, JSON.stringify(deliveries[0], null, 2).substring(0, 500));
      console.log(`[Deliveries/Upload] *** END FIRST DELIVERY ***`);
    }

    if (!deliveries || !Array.isArray(deliveries)) {
      return void res.status(400).json({ error: 'deliveries_array_required' });
    }

    if (deliveries.length === 0) {
      return void res.status(400).json({ error: 'no_deliveries_provided' });
    }

    const results: Array<{ deliveryId: string; saved: boolean; error?: string; deduplicated?: boolean; outcome?: string; gmdUpdated?: boolean }> = [];
    /** IDs of records that were created or updated (included in savedDeliveries response). */
    const deliveryIds: string[] = [];
    /** IDs of records that were skipped (pure duplicate) — returned in response for UI refresh. */
    const skippedIds: string[] = [];

    // Save deliveries to database with full data
    for (let i = 0; i < deliveries.length; i++) {
      const delivery = deliveries[i];
      // Generate valid UUID for each delivery (required by database)
      // If delivery.id exists and is a valid UUID, use it; otherwise generate new UUID
      let deliveryId = delivery.id as string | undefined;
      if (!deliveryId || !String(deliveryId).match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)) {
        deliveryId = randomUUID();
      }

      console.log(`[Deliveries/Upload] Saving delivery ${i + 1}/${deliveries.length}: ${deliveryId}`);
      console.log(`[Deliveries/Upload] Data: customer="${delivery.customer}", address="${String(delivery.address || '').substring(0, 50)}", phone="${delivery.phone}", status="${delivery.status}"`);
      console.log(`[Deliveries/Upload] *** CRITICAL DEBUG ***`);
      console.log(`[Deliveries/Upload] delivery object type:`, typeof delivery);
      console.log(`[Deliveries/Upload] delivery object keys:`, Object.keys(delivery));
      console.log(`[Deliveries/Upload] delivery._originalPONumber:`, delivery._originalPONumber);
      console.log(`[Deliveries/Upload] delivery._originalDeliveryNumber:`, delivery._originalDeliveryNumber);
      console.log(`[Deliveries/Upload] *** END CRITICAL DEBUG ***`);

      try {
        // PO Number: use transformed fields first, then raw delivery keys (untransformed upload), then _originalRow
        let poNumberToSave: string | null = (delivery.poNumber ?? delivery.PONumber ?? delivery._originalPONumber ?? null) as string | null;
        if (poNumberToSave == null) {
          const raw = delivery['PO Number'] ?? delivery['PO#'] ?? delivery['Cust. PO Number'] ?? delivery['PONumber'] ?? delivery['Delivery number'] ?? delivery['Delivery Number'];
          if (raw != null && raw !== '') poNumberToSave = String(raw).trim();
        }
        const origRow = delivery._originalRow as Record<string, unknown> | undefined;
        if (poNumberToSave == null && origRow && typeof origRow === 'object') {
          const fromRow = origRow['PO Number'] ?? origRow['PO#'] ?? origRow['Cust. PO Number'] ?? origRow['PONumber'] ?? origRow['Delivery number'] ?? origRow['Delivery Number'] ?? null;
          if (fromRow != null) poNumberToSave = String(fromRow).trim() || null;
        }
        if (poNumberToSave != null && typeof poNumberToSave !== 'string') poNumberToSave = String(poNumberToSave);

        // Metadata: store all original row columns plus mapped fields so nothing is lost
        const baseMeta: Record<string, unknown> = {
          originalDeliveryNumber: delivery._originalDeliveryNumber ?? origRow?.['Delivery number'] ?? origRow?.['Delivery Number'],
          originalPONumber: poNumberToSave ?? delivery._originalPONumber,
          originalQuantity: delivery._originalQuantity ?? origRow?.['Confirmed quantity'],
          originalCity: delivery._originalCity ?? origRow?.['City'],
          originalRoute: delivery._originalRoute ?? origRow?.['Route'],
        };
        if (origRow && typeof origRow === 'object') {
          baseMeta.originalRow = origRow;
        }
        const deliveryMetadata = delivery.metadata as Record<string, unknown> | undefined;
        const metadataToSave = deliveryMetadata && typeof deliveryMetadata === 'object'
          ? { ...baseMeta, ...deliveryMetadata }
          : baseMeta;
        const originalDeliveryNumberToSave = (baseMeta.originalDeliveryNumber ?? null) as string | null;

        // Extract Goods Movement Date from upload
        const rawGmd = (delivery as Record<string, unknown>)._goodsMovementDate ?? (delivery as Record<string, unknown>).goodsMovementDate ?? origRow?.['Goods Movement Date'] ?? origRow?.['GoodsMovementDate'] ?? null;
        const goodsMovementDateToSave: string | null = (() => {
          if (!rawGmd) return null;
          const d = new Date(String(rawGmd));
          return isNaN(d.getTime()) ? null : d.toISOString();
        })();

        // Delivery Number: normalised version from transform
        const deliveryNumberToSave: string | null = (() => {
          const raw = (delivery as Record<string, unknown>)._deliveryNumber ?? (delivery as Record<string, unknown>).deliveryNumber ?? originalDeliveryNumberToSave;
          if (!raw) return null;
          const s = String(raw).trim().toUpperCase();
          return s || null;
        })();

        const businessKey = buildBusinessKey(poNumberToSave, deliveryNumberToSave);

        const deliveryItems = delivery.items;
        const incoming = {
          id: deliveryId,
          deliveryNumber: deliveryNumberToSave,
          goodsMovementDate: goodsMovementDateToSave,
          customer: (delivery.customer || delivery.name || null) as string | null,
          address: (delivery.address || null) as string | null,
          phone: (delivery.phone ?? null) as string | null,
          poNumber: poNumberToSave,
          lat: delivery.lat != null ? Number(delivery.lat) : null,
          lng: delivery.lng != null ? Number(delivery.lng) : null,
          status: (delivery.status || 'pending') as string,
          items: typeof deliveryItems === 'string' ? deliveryItems : (deliveryItems ? JSON.stringify(deliveryItems) : null),
          metadata: metadataToSave,
          businessKey
        };

        const upsertResult = await upsertDeliveryByBusinessKey({
          prisma,
          source: 'manual_upload',
          incoming
        }) as { delivery: Record<string, unknown>; existed: boolean; skipped: boolean; conflict?: string; gmdUpdated: boolean; outcome: string };

        if (upsertResult.conflict) {
          console.warn(`[Deliveries/Upload] REJECTED delivery ${deliveryId}: ${upsertResult.conflict}`);
          results.push({ deliveryId, saved: false, error: upsertResult.conflict, outcome: 'rejected' });
          continue;
        }

        const { delivery: savedDelivery, existed, skipped, gmdUpdated, outcome: upsertOutcome } = upsertResult;

        console.log(`[Deliveries/Upload] ✓ ${upsertOutcome} delivery ${savedDelivery.id} (existed=${!!existed}, skipped=${!!skipped}, gmdUpdated=${!!gmdUpdated})`);
        const savedMeta = savedDelivery.metadata as Record<string, unknown> | null;
        if (!savedDelivery.poNumber && !savedMeta?.originalPONumber) {
          console.log(`[Deliveries/Upload] ⚠ Warning: No PO Number found for delivery ${savedDelivery.id}`);
        }

        if (skipped) {
          // Pure duplicate — dedup service already logged the event. Track separately so
          // the frontend can refresh the current state without marking it as newly saved.
          skippedIds.push(savedDelivery.id as string);
          results.push({ deliveryId: savedDelivery.id as string, saved: false, deduplicated: true, outcome: 'duplicate' });
        } else {
          // New record or meaningful update — dedup service already logged gmd_received_dispatch
          // / dispatch events. Only log 'uploaded' here for brand-new records so we don't
          // double-log for update cases.
          if (!existed) {
            await prisma.deliveryEvent.create({
              data: {
                deliveryId: savedDelivery.id,
                eventType: 'uploaded',
                payload: {
                  customer: delivery.customer || delivery.name,
                  address: delivery.address,
                  phone: delivery.phone,
                  lat: delivery.lat,
                  lng: delivery.lng,
                  uploadDate: new Date().toISOString(),
                  businessKey: savedDelivery.businessKey || businessKey || null,
                  hasGMD: !!goodsMovementDateToSave,
                },
                actorType: req.user?.role || 'admin',
                actorId: req.user?.sub || null
              }
            }).catch((err: unknown) => {
              const e = err as { message?: string };
              console.warn(`[Deliveries] Failed to create event for ${deliveryId}:`, e.message);
            });
          }

          deliveryIds.push(savedDelivery.id as string);
          results.push({ deliveryId: savedDelivery.id as string, saved: true, deduplicated: !!existed, outcome: upsertOutcome, gmdUpdated: !!gmdUpdated });
        }
      } catch (error: unknown) {
        const e = error as { message?: string };
        console.error(`[Deliveries] Error saving delivery ${deliveryId}:`, error);
        results.push({ deliveryId, saved: false, error: e.message });
      }
    }

    // ── Post-processing for deliveries that became Out for Delivery via GMD ──────
    // Covers both 'dispatched' (existing record receives GMD for first time) and
    // 'new' records uploaded WITH a GMD already set — both result in out-for-delivery.
    //   1. Auto-assign a driver (or promote existing assignment to in_progress)
    //   2. Send the customer an "Out for Delivery" SMS notification
    //   3. Create an adminNotification so all portal users see the bell alert
    const dispatchedIds = results.filter(r => r.saved && (r.outcome === 'dispatched' || (r.outcome === 'new' && r.gmdUpdated))).map(r => r.deliveryId);

    if (dispatchedIds.length > 0) {
      // Fetch just the fields needed for assignment + SMS
      const dispatchedRows = await prisma.delivery.findMany({
        where: { id: { in: dispatchedIds } },
        select: { id: true, phone: true, customer: true, poNumber: true, confirmationToken: true }
      }) as Array<{ id: string; phone?: string | null; customer?: string | null; poNumber?: string | null; confirmationToken?: string | null }>;

      for (const d of dispatchedRows) {
        // 1. Auto-assign / promote driver assignment
        try {
          const activeAssignment = await prisma.deliveryAssignment.findFirst({
            where: { deliveryId: d.id, status: { in: ['assigned', 'in_progress'] } }
          });
          if (!activeAssignment) {
            await autoAssignDelivery(d.id);
          } else {
            await prisma.deliveryAssignment.updateMany({
              where: { deliveryId: d.id, status: 'assigned' },
              data: { status: 'in_progress' }
            });
          }
        } catch (assignErr: unknown) {
          console.warn(`[Deliveries/Upload] Auto-assign failed for ${d.id}:`, (assignErr as Error).message);
        }

        // 2. Notify customer that their order is out for delivery
        //    SMS API TEMPORARILY DISABLED — D7 compliance pending.
        //    wa.me link logged; restore smsAdapter call once approved.
        if (d.phone) {
          try {
            const frontendUrl = process.env.FRONTEND_URL || 'https://electrolux-smart-portal.vercel.app';
            const trackingLink = d.confirmationToken
              ? `${frontendUrl}/customer-tracking/${d.confirmationToken}`
              : null;
            const customerName = d.customer || 'Valued Customer';
            const poRef = d.poNumber ? `#${d.poNumber}` : '';
            const smsBody = `Dear ${customerName},\n\nYour Electrolux order ${poRef} is out for delivery today.\n${trackingLink ? `\nTrack your delivery in real time:\n${trackingLink}\n` : ''}\nFor assistance, please contact the Electrolux Delivery Team at +971524408687.\n\nThank you,\nElectrolux Delivery Team`;

            // const smsService = require('../sms/smsService');
            // const smsResult = await smsService.smsAdapter.sendSms({
            //   to: d.phone, body: smsBody,
            //   metadata: { deliveryId: d.id, type: 'status_out_for_delivery' }
            // });
            const { buildWhatsAppLink: _bwaGmd } = require('../sms/waLink');
            const _gmdWaUrl = (_bwaGmd as (p: string, b: string) => string)(d.phone, smsBody);
            console.log(`[SMS→WhatsApp] GMD dispatch link for ${d.id}:`, _gmdWaUrl);

            await prisma.smsLog.create({
              data: {
                deliveryId: d.id,
                phoneNumber: d.phone,
                messageContent: smsBody,
                smsProvider: 'whatsapp-link',
                status: 'whatsapp_link_generated',
                sentAt: new Date(),
                metadata: { type: 'status_out_for_delivery', triggeredBy: 'gmd_upload' }
              }
            });
          } catch (smsErr: unknown) {
            console.warn(`[Deliveries/Upload] SMS notification failed for ${d.id}:`, (smsErr as Error).message);
          }
        }

        // 3. Create an AdminNotification so the bell rings for admin, delivery_team and logistics_team
        prisma.adminNotification.create({
          data: {
            type: 'status_changed',
            title: 'Out for Delivery — GMD Received',
            message: `${d.customer || 'Order'} (${d.poNumber ? '#' + d.poNumber : d.id}) dispatched — Goods Movement Date received via upload`,
            payload: {
              deliveryId: d.id,
              customer: d.customer,
              poNumber: d.poNumber,
              previousStatus: 'pending',
              newStatus: 'out-for-delivery',
              triggeredBy: 'gmd_upload',
              uploadedBy: req.user?.sub || req.user?.username || 'system'
            }
          }
        }).catch((err: unknown) => {
          const e = err as { message?: string };
          console.warn(`[Deliveries/Upload] Failed to create dispatch notification for ${d.id}:`, e.message);
        });
      }
    }

    const mergedResults = results.map(result => ({
      ...result,
      assigned: dispatchedIds.includes(result.deliveryId),
      driverId: null as string | null,
      driverName: null as string | null,
      assignmentError: null as string | null,
      assignmentPendingCustomerConfirm: !dispatchedIds.includes(result.deliveryId)
    }));

    // Invalidate caches after bulk upload
    cache.invalidatePrefix('tracking:');
    cache.invalidatePrefix('dashboard:');
    cache.del('deliveries:list:v2');

    const newCount = results.filter(r => r.outcome === 'new').length;
    const dispatchedCount = results.filter(r => r.outcome === 'dispatched').length;
    const updatedCount = results.filter(r => r.outcome === 'updated').length;
    const duplicateCount = results.filter(r => r.outcome === 'duplicate').length;
    const rejectedCount = results.filter(r => r.outcome === 'rejected').length;

    console.log(`[Deliveries] Upload complete: ${newCount} new, ${dispatchedCount} out-for-delivery (GMD received), ${updatedCount} updated, ${duplicateCount} duplicate (skipped), ${rejectedCount} rejected (PO conflict)`);

    // The delivery fields we always return — includes goodsMovementDate and deliveryNumber
    // so the frontend can correctly reflect dispatch state after upload.
    const deliverySelect = {
      id: true,
      customer: true,
      address: true,
      phone: true,
      poNumber: true,
      deliveryNumber: true,
      goodsMovementDate: true,
      businessKey: true,
      lat: true,
      lng: true,
      status: true,
      items: true,
      metadata: true,
      createdAt: true,
      updatedAt: true
    };

    // Fetch created/updated deliveries with full data including UUIDs
    const savedDeliveries = await prisma.delivery.findMany({
      where: { id: { in: deliveryIds } },
      select: deliverySelect
    });

    // Also fetch skipped deliveries so the frontend can refresh their current state
    const skippedDeliveries = skippedIds.length > 0
      ? await prisma.delivery.findMany({ where: { id: { in: skippedIds } }, select: deliverySelect })
      : [];

    console.log(`[Deliveries] Returning ${(savedDeliveries as unknown[]).length} saved + ${(skippedDeliveries as unknown[]).length} skipped deliveries to frontend`);

    // ── Auto-generate confirmation WhatsApp links for new pending deliveries ─────
    // For every newly created delivery (no GMD) that has a phone number, generate
    // a confirmation token and return a wa.me link so staff can immediately send
    // WhatsApp confirmation to the customer after upload.
    const newPendingDeliveries = savedDeliveries.filter((d: Record<string, unknown>) => {
      const matchedResult = results.find(r => r.deliveryId === d.id);
      return matchedResult?.outcome === 'new' && !matchedResult?.gmdUpdated && d.phone;
    }) as Array<{ id: string; customer?: string | null; phone?: string | null; poNumber?: string | null; confirmationToken?: string | null }>;

    const { buildWhatsAppLink: bwaUpload } = require('../sms/waLink');
    const smsUploadService = require('../sms/smsService');
    const frontendUrlUpload = process.env.FRONTEND_URL || 'https://electrolux-smart-portal.vercel.app';
    const confirmationsReady: Array<{ deliveryId: string; customerName: string; phone: string; whatsappUrl: string; confirmationLink: string }> = [];

    for (const d of newPendingDeliveries) {
      try {
        const token = smsUploadService.generateConfirmationToken() as string;
        const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
        const confirmationLink = `${frontendUrlUpload}/confirm-delivery/${token}`;
        const customerName = (d.customer as string) || 'Valued Customer';
        const poRef = d.poNumber ? `#${d.poNumber}` : '';
        const msgBody = `Dear ${customerName},\n\nYour Electrolux order ${poRef} is ready for delivery.\n\nPlease confirm your preferred delivery date using the link below:\n${confirmationLink}\n\nFor assistance, please contact the Electrolux Delivery Team at +971524408687.\n\nThank you,\nElectrolux Delivery Team`;

        // Save token to DB
        await prisma.delivery.update({
          where: { id: d.id },
          data: {
            confirmationToken: token,
            tokenExpiresAt: expiresAt,
            confirmationStatus: 'pending',
            status: 'scheduled',
            smsSentAt: new Date()
          }
        });

        // Log the WhatsApp link
        await prisma.smsLog.create({
          data: {
            deliveryId: d.id,
            phoneNumber: (d.phone as string),
            messageContent: msgBody,
            smsProvider: 'whatsapp-link',
            status: 'whatsapp_link_generated',
            sentAt: new Date(),
            metadata: { type: 'confirmation_request', triggeredBy: 'auto_upload' }
          }
        }).catch(() => { /* non-critical */ });

        const normalizedPhone = (normalizePhone((d.phone as string)) || (d.phone as string));
        confirmationsReady.push({
          deliveryId: d.id,
          customerName,
          phone: normalizedPhone,
          confirmationLink,
          whatsappUrl: (bwaUpload as (p: string, b: string) => string)(normalizedPhone, msgBody)
        });
      } catch (autoErr: unknown) {
        console.warn(`[Upload] Auto-token gen failed for ${d.id}:`, (autoErr as Error).message);
      }
    }

    if (confirmationsReady.length > 0) {
      console.log(`[Upload] ${confirmationsReady.length} WhatsApp confirmation links generated automatically`);
    }
    // ──────────────────────────────────────────────────────────────────────────────

    res.json({
      success: true,
      count: deliveryIds.length,
      saved: results.filter(r => r.saved).length,
      assigned: 0,
      /** Breakdown of what happened per delivery row. */
      summary: { new: newCount, dispatched: dispatchedCount, updated: updatedCount, duplicate: duplicateCount, rejected: rejectedCount },
      results: mergedResults,
      deliveries: savedDeliveries,
      skippedDeliveries,
      confirmationsReady,  // wa.me links for new pending deliveries — staff opens to send WhatsApp
    });
  } catch (err: unknown) {
    const e = err as { message?: string; stack?: string };
    console.error('deliveries/upload error', err);
    console.error('deliveries/upload error stack:', e.stack);
    res.status(500).json({ error: 'upload_error', detail: e.message });
  }
});

// POST /api/deliveries/bulk-assign - Auto-assign multiple deliveries
router.post('/bulk-assign', authenticate, requireRole('admin'), async (req: Request, res: Response): Promise<void> => {
  try {
    const { deliveryIds } = req.body as { deliveryIds?: string[] };

    if (!deliveryIds || !Array.isArray(deliveryIds)) {
      return void res.status(400).json({ error: 'delivery_ids_array_required' });
    }

    const results = await autoAssignDeliveries(deliveryIds) as Array<{ success: boolean }>;

    // Invalidate caches after bulk assignment
    cache.invalidatePrefix('tracking:');
    cache.invalidatePrefix('dashboard:');
    cache.invalidatePrefix('deliveries:list:v2');

    res.json({
      success: true,
      total: deliveryIds.length,
      assigned: results.filter(r => r.success).length,
      failed: results.filter(r => !r.success).length,
      results
    });
  } catch (err: unknown) {
    const e = err as { message?: string };
    console.error('deliveries/bulk-assign error', err);
    res.status(500).json({ error: 'bulk_assign_error', detail: e.message });
  }
});

// GET /api/deliveries/available-drivers - Get available drivers for manual selection
router.get('/available-drivers', authenticate, requireRole('admin'), async (req: Request, res: Response): Promise<void> => {
  try {
    const drivers = await getAvailableDrivers();
    res.json({ drivers, count: (drivers as unknown[]).length });
  } catch (err: unknown) {
    const e = err as { message?: string };
    console.error('deliveries/available-drivers error', err);
    res.status(500).json({ error: 'db_error', detail: e.message });
  }
});

// Define which statuses are considered "terminal" / finished for routing purposes.
// These will normally be excluded from the Delivery Management active list unless
// a client explicitly asks to include them.
const TERMINAL_STATUSES = [
  'delivered',
  'delivered-with-installation',
  'delivered-without-installation',
  'completed',
  'pod-completed',
  'cancelled',
  'returned',
];

// GET /api/deliveries - Get deliveries from database
// By default returns ONLY "active" deliveries (non-terminal), filtered to
// today's deliveries: non-confirmed deliveries always show, while
// scheduled-confirmed deliveries only appear when their confirmedDeliveryDate
// is today or earlier (future-date picks are hidden until that date).
// Pass ?includeFinished=true to include all terminal-status deliveries.
router.get('/', authenticate, async (req: Request, res: Response): Promise<void> => {
  try {
    const includeFinished = req.query.includeFinished === 'true';

    // Build a today-scoped date range using Dubai timezone (UTC+4) so day
    // boundaries are correct regardless of the server's local timezone.
    const dubaiTodayIso = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Dubai', year: 'numeric', month: '2-digit', day: '2-digit'
    }).format(new Date());
    const todayStart = new Date(`${dubaiTodayIso}T00:00:00+04:00`);
    const todayEnd   = new Date(`${dubaiTodayIso}T23:59:59+04:00`);
    // Cache key scoped to today's Dubai date so confirmed-for-future deliveries
    // automatically become visible on their scheduled date.
    const dateKey = dubaiTodayIso;
    const cacheKey = includeFinished
      ? 'deliveries:list:v2:all'
      : `deliveries:list:v2:active:${dateKey}`;

    const deliveries = await cache.getOrFetch(cacheKey, async () => {
      let whereClause: Record<string, unknown>;
      if (includeFinished) {
        whereClause = {};
      } else {
        whereClause = {
          status: { notIn: TERMINAL_STATUSES },
          // Only show confirmed deliveries whose date is today or earlier.
          // Unconfirmed deliveries (pending/scheduled/etc.) always show so
          // admin can dispatch them manually.
          OR: [
            { status: { notIn: ['scheduled-confirmed', 'confirmed'] } },
            { status: { in: ['scheduled-confirmed', 'confirmed'] }, confirmedDeliveryDate: { lte: todayEnd } },
            { status: { in: ['scheduled-confirmed', 'confirmed'] }, confirmedDeliveryDate: null },
          ],
        };
      }

      return prisma.delivery.findMany({
        where: whereClause,
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
          deliveryNumber: true,
          goodsMovementDate: true,
          smsSentAt: true,
          confirmationStatus: true,
          confirmedDeliveryDate: true,
          createdAt: true,
          updatedAt: true,
          assignments: {
            select: {
              driverId: true,
              status: true,
              driver: { select: { fullName: true } }
            },
            take: 1,
            orderBy: { assignedAt: 'desc' }
          }
        },
        orderBy: { createdAt: 'desc' },
        take: 2000
      });
    }, 30000, 120000);

    // Format deliveries for frontend
    const formattedDeliveries = (deliveries as Array<Record<string, unknown>>).map(d => {
      const assignments = d.assignments as Array<{ driverId?: string; status?: string; driver?: { fullName?: string } }> | undefined;
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
        deliveryNumber: d.deliveryNumber ?? null,
        goodsMovementDate: d.goodsMovementDate ?? null,
        smsSentAt: d.smsSentAt ?? null,
        confirmationStatus: d.confirmationStatus,
        confirmedDeliveryDate: d.confirmedDeliveryDate,
        created_at: d.createdAt,
        createdAt: d.createdAt,
        created: d.createdAt,
        updatedAt: d.updatedAt,
        assignedDriverId: assignments?.[0]?.driverId || null,
        driverName: assignments?.[0]?.driver?.fullName || null,
        assignmentStatus: assignments?.[0]?.status || 'unassigned'
      };
    });

    // Deliveries with missing address or phone go to the bottom; otherwise newest first
    sortDeliveriesIncompleteLast(formattedDeliveries);

    res.json({
      deliveries: formattedDeliveries,
      count: formattedDeliveries.length
    });
  } catch (err: unknown) {
    const e = err as { message?: string };
    console.error('GET /api/deliveries error', err);
    res.status(500).json({ error: 'db_error', detail: e.message });
  }
});

// PUT /api/admin/deliveries/:id/assign - Assign delivery to driver (admin + delivery_team)
router.put('/admin/:id/assign', authenticate, requireAnyRole('admin', 'delivery_team', 'logistics_team'), async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params as { id: string };
    const { driverId } = req.body as { driverId?: string };

    if (!driverId) {
      return void res.status(400).json({ error: 'driverId_required' });
    }

    console.log(`[Deliveries] Assigning delivery ${id} to driver ${driverId}`);

    const targetDriver = await prisma.driver.findUnique({
      where: { id: driverId },
      include: { account: { select: { role: true } } }
    });

    if (!targetDriver || !targetDriver.account || targetDriver.account.role !== 'driver') {
      return void res.status(400).json({
        error: 'invalid_driver',
        message: 'Assignments are only allowed for accounts with the driver role.'
      });
    }

    // Verify delivery exists
    const delivery = await prisma.delivery.findUnique({
      where: { id },
      include: { assignments: true }
    }) as {
      id: string;
      assignments?: unknown[];
      items?: string | null;
      metadata?: Record<string, unknown> | null;
      confirmedDeliveryDate?: Date | null;
      assignedDriverId?: string | null;
    } | null;

    if (!delivery) {
      return void res.status(404).json({ error: 'delivery_not_found' });
    }

    // Per-driver capacity check: 1 driver = 1 truck = max TRUCK_MAX_ITEMS_PER_DAY units per day
    {
      const orderItemCount = parseDeliveryItemCount(delivery.items, delivery.metadata);
      // Use the delivery's confirmed date, or default to tomorrow if not yet confirmed
      const targetIso = delivery.confirmedDeliveryDate
        ? new Intl.DateTimeFormat('en-CA', {
            timeZone: 'Asia/Dubai',
            year: 'numeric', month: '2-digit', day: '2-digit'
          }).format(new Date(delivery.confirmedDeliveryDate))
        : addDubaiCalendarDays(getDubaiTodayIso(), 1);

      // Exclude this delivery from driver's current count (handles reassignment without double-counting)
      const driverUsed = await getDriverItemCountForDate(prisma, driverId, targetIso, id);

      if (driverUsed + orderItemCount > TRUCK_MAX_ITEMS_PER_DAY) {
        return void res.status(400).json({
          error: 'driver_capacity_exceeded',
          message: `Driver's truck is full for ${targetIso}: ${driverUsed} units already assigned, this order has ${orderItemCount} units (max ${TRUCK_MAX_ITEMS_PER_DAY} per truck).`,
          driverUsed,
          orderItemCount,
          maxItems: TRUCK_MAX_ITEMS_PER_DAY,
          remaining: Math.max(0, TRUCK_MAX_ITEMS_PER_DAY - driverUsed)
        });
      }
    }

    // Soft-close previous active assignments so history is preserved for reporting/audit
    if (delivery.assignments && delivery.assignments.length > 0) {
      await prisma.deliveryAssignment.updateMany({
        where: { deliveryId: id, status: { in: ['assigned', 'in_progress'] } },
        data: { status: 'reassigned' }
      });
      console.log(`[Deliveries] Soft-closed previous assignments for delivery ${id}`);
    }

    // Create new assignment
    const assignment = await prisma.deliveryAssignment.create({
      data: {
        deliveryId: id,
        driverId: driverId,
        assignedAt: new Date(),
        status: 'assigned'
      },
      include: {
        driver: {
          select: {
            id: true,
            fullName: true,
            email: true,
            phone: true
          }
        }
      }
    }) as {
      deliveryId: string; driverId: string; status: string; assignedAt: Date;
      driver: { fullName: string };
    };

    // Invalidate caches after assignment
    // Use invalidatePrefix so both deliveries:list:v2:active and deliveries:list:v2:all are cleared.
    cache.invalidatePrefix('tracking:');
    cache.invalidatePrefix('dashboard:');
    cache.invalidatePrefix('deliveries:list:v2');

    res.json({
      ok: true,
      assignment: {
        deliveryId: assignment.deliveryId,
        driverId: assignment.driverId,
        driverName: assignment.driver.fullName,
        status: assignment.status,
        assignedAt: assignment.assignedAt
      }
    });
  } catch (err: unknown) {
    const e = err as { message?: string };
    console.error('PUT /api/admin/deliveries/:id/assign error:', err);
    res.status(500).json({ error: 'assignment_failed', detail: e.message });
  }
});

// GET /api/deliveries/admin/driver-capacity?date=YYYY-MM-DD
// Returns per-driver capacity for the given date (or tomorrow if omitted).
// Used by Logistics/Delivery portals to show "N/20 units used" in assignment dropdowns.
router.get('/admin/driver-capacity', authenticate, requireAnyRole('admin', 'delivery_team', 'logistics_team'), async (req: Request, res: Response): Promise<void> => {
  try {
    const rawDate = (req.query as { date?: string }).date;
    let isoDate = rawDate ? String(rawDate).trim().split('T')[0] : null;
    if (!isoDate || !/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) {
      isoDate = addDubaiCalendarDays(getDubaiTodayIso(), 1);
    }

    const allDrivers = await prisma.driver.findMany({
      where: { active: true, account: { role: 'driver' } },
      include: { account: { select: { id: true, role: true } } },
      orderBy: { fullName: 'asc' }
    }) as Array<{ id: string; fullName: string; email?: string; phone?: string }>;

    const result = await Promise.all(allDrivers.map(async (driver: { id: string; fullName: string; email?: string; phone?: string }) => {
      const used = await getDriverItemCountForDate(prisma, driver.id, isoDate!);
      return {
        driverId: driver.id,
        driverName: driver.fullName,
        used,
        remaining: Math.max(0, TRUCK_MAX_ITEMS_PER_DAY - used),
        max: TRUCK_MAX_ITEMS_PER_DAY,
        full: used >= TRUCK_MAX_ITEMS_PER_DAY
      };
    }));

    res.json({ ok: true, date: isoDate, truckMax: TRUCK_MAX_ITEMS_PER_DAY, drivers: result });
  } catch (err: unknown) {
    const e = err as { message?: string };
    console.error('GET /admin/driver-capacity error:', err);
    res.status(500).json({ error: 'capacity_fetch_failed', detail: e.message });
  }
});

// POST /api/deliveries/:id/send-sms - Send confirmation SMS to customer
// Accessible by admin, delivery_team, and logistics_team
router.post('/:id/send-sms', authenticate, requireAnyRole('admin', 'delivery_team', 'logistics_team'), async (req: Request, res: Response): Promise<void> => {
  try {
    let { id: deliveryId } = req.params as { id: string };

    if (!deliveryId) {
      return void res.status(400).json({ error: 'delivery_id_required' });
    }

    // Sanitize delivery ID - remove any invalid characters and decode
    deliveryId = decodeURIComponent(String(deliveryId).trim());

    console.log('[SMS] Attempting to send SMS for delivery ID:', deliveryId);

    // Validate UUID format (standard UUID format: 8-4-4-4-12 hex characters)
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

    let delivery: Record<string, unknown> | null = null;

    if (uuidRegex.test(deliveryId)) {
      // Valid UUID format - use findUnique
      console.log('[SMS] Valid UUID format, using findUnique');
      try {
        delivery = await prisma.delivery.findUnique({
          where: { id: deliveryId }
        });
      } catch (prismaErr: unknown) {
        const pe = prismaErr as { message?: string };
        console.error('[SMS] Prisma findUnique error:', pe.message);
        return void res.status(400).json({
          error: 'invalid_delivery_id',
          message: 'Invalid delivery ID format',
          detail: pe.message
        });
      }
    } else {
      // Not a valid UUID - try searching by poNumber or other fields
      console.log('[SMS] Not a valid UUID, trying fallback search by poNumber');
      try {
        delivery = await prisma.delivery.findFirst({
          where: {
            OR: [
              { poNumber: deliveryId },
              { id: { contains: deliveryId } }
            ]
          }
        });
      } catch (searchErr: unknown) {
        const se = searchErr as { message?: string };
        console.error('[SMS] Fallback search error:', se.message);
      }
    }

    if (!delivery) {
      console.error('[SMS] Delivery not found for ID:', deliveryId);
      return void res.status(404).json({
        error: 'delivery_not_found',
        message: `No delivery found with ID: ${deliveryId}`
      });
    }

    console.log('[SMS] Found delivery:', delivery.id, 'Customer:', delivery.customer);

    if (!delivery.phone && !delivery.email) {
      return void res.status(400).json({ error: 'no_contact_info', message: 'Delivery has no phone number or email address' });
    }

    // Normalize the phone number to E.164 format if present
    const normalizedPhone = delivery.phone
      ? (normalizePhone(delivery.phone as string) || delivery.phone as string)
      : null;
    if (normalizedPhone && normalizedPhone !== delivery.phone) {
      console.log(`[SMS] Phone normalized: "${delivery.phone}" → "${normalizedPhone}"`);
    }

    // Accept optional customer email override from request body
    const reqBody = req.body as { email?: string };
    const customerEmail = reqBody?.email || delivery.email as string || null;

    if (!normalizedPhone) {
      return void res.status(400).json({ error: 'no_phone', message: 'Delivery has no phone number' });
    }

    // Generate token and message body before attempting send.
    // DB is only updated AFTER a successful send so status never reflects
    // a message the customer did not receive.
    const smsService = require('../sms/smsService');
    const token = smsService.generateConfirmationToken() as string;
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    const frontendUrl = process.env.FRONTEND_URL || 'https://electrolux-smart-portal.vercel.app';
    const confirmationLink = `${frontendUrl}/confirm-delivery/${token}`;
    const customerName = (delivery.customer as string) || 'Valued Customer';
    const poRef = delivery.poNumber ? `#${delivery.poNumber}` : '';
    const smsBody = `Dear ${customerName},\n\nYour Electrolux order ${poRef} is ready for delivery.\n\nPlease confirm your preferred delivery date using the link below:\n${confirmationLink}\n\nFor assistance, please contact the Electrolux Delivery Team at +971524408687.\n\nThank you,\nElectrolux Delivery Team`;

    // ── 1. Prepare channel info ──────────────────────────────────────────────
    const isUAE = normalizedPhone.startsWith('+971');
    let sent = false;
    let messageId: string | null = null;
    let d7Status: string | null = null;
    const channel = 'whatsapp'; // always whatsapp during compliance-pending period

    // ── SMS / WhatsApp API TEMPORARILY DISABLED ──────────────────────────────
    // D7 provider compliance approval is pending. All outbound API calls are
    // commented out below. Once approved, restore the block inside the try/catch
    // and remove the wa.me fallback.
    //
    // ORIGINAL SEND CODE (DO NOT DELETE):
    // try {
    //   if (isUAE) {
    //     const WhatsAppAdapter = require('../sms/whatsappAdapter');
    //     const waAdapter = new WhatsAppAdapter(process.env);
    //     const result = await waAdapter.sendMessage({ to: normalizedPhone, body: smsBody });
    //     messageId = result.messageId || null;
    //     d7Status = result.status || null;
    //     sent = true;
    //     console.log('[WhatsApp] Sent to', normalizedPhone, 'MID:', messageId);
    //   } else {
    //     const smsResult = await smsService.smsAdapter.sendSms({
    //       to: normalizedPhone, body: smsBody,
    //       metadata: { deliveryId: delivery.id, type: 'confirmation_request' }
    //     });
    //     messageId = smsResult.messageId || null;
    //     d7Status = smsResult.status || null;
    //     sent = true;
    //     console.log('[SMS] Sent to', normalizedPhone, 'MID:', messageId);
    //   }
    // } catch (sendErr) { ... }
    // ──────────────────────────────────────────────────────────────────────────

    // ── WhatsApp deep-link fallback (staff clicks link to send manually) ─────
    const { buildWhatsAppLink } = require('../sms/waLink');
    const whatsappUrl = buildWhatsAppLink(normalizedPhone, smsBody) as string;
    messageId = `wa-${Date.now()}`;
    d7Status = 'whatsapp_link_generated';
    sent = true;
    console.log('[WhatsApp Link] Generated for', normalizedPhone, ':', whatsappUrl);
    // ──────────────────────────────────────────────────────────────────────────

    // ── 2. Persist token & update delivery status (proceeds because sent=true) ──
    if (!sent) {
      // This branch is unreachable while the wa.me fallback is active.
      // It will become reachable again when the D7 API calls are restored
      // and an actual API failure occurs.
      return void res.status(500).json({
        ok: false,
        error: `${channel}_failed`,
        message: 'Message delivery failed'
      });
    }

    // Persist token and mark delivery as 'scheduled'
    await prisma.delivery.update({
      where: { id: delivery.id },
      data: {
        confirmationToken: token,
        tokenExpiresAt: expiresAt,
        confirmationStatus: 'pending',
        status: 'scheduled',
        smsSentAt: new Date()
      }
    });

    await prisma.smsLog.create({
      data: {
        deliveryId: delivery.id,
        phoneNumber: normalizedPhone,
        messageContent: smsBody,
        smsProvider: 'whatsapp-link',
        externalMessageId: messageId,
        status: 'whatsapp_link_generated',
        sentAt: new Date(),
        metadata: { type: 'confirmation_request', channel, tokenExpiry: expiresAt.toISOString(), isUAE, whatsappUrl }
      }
    }).catch((e: unknown) => console.error('[Log] SMS log error:', (e as { message?: string }).message));

    // ── 3. Build response (includes whatsappUrl for frontend to open) ─────────
    return void res.json({
      ok: true,
      smsSent: true,
      deliveredVia: 'whatsapp-link',
      d7Status,
      message: 'WhatsApp confirmation link ready — please open and send to customer',
      messageId,
      expiresAt: expiresAt.toISOString(),
      confirmationLink,
      whatsappUrl  // frontend opens this to launch WhatsApp with message pre-filled
    });
  } catch (error: unknown) {
    const e = error as { message?: string };
    console.error('POST /api/deliveries/:id/send-sms error:', error);
    return void res.status(500).json({
      error: 'send_sms_failed',
      message: e.message || 'Failed to send SMS. Please check delivery data.'
    });
  }
});

// GET /api/deliveries/:id/pod - Get Proof of Delivery data for a specific delivery
router.get('/:id/pod', authenticate, async (req: Request, res: Response): Promise<void> => {
  try {
    const { id: deliveryId } = req.params as { id: string };

    console.log(`[Deliveries/POD] Fetching POD data for delivery: ${deliveryId}`);

    type PodDelivery = {
      id: string; customer: string; address: string; phone: string; items: unknown;
      status: string; driverSignature?: string; customerSignature?: string;
      photos?: unknown[]; conditionNotes?: string; deliveryNotes?: string;
      deliveredBy?: string; deliveredAt?: string; podCompletedAt?: string;
      createdAt: string; updatedAt: string; metadata?: unknown;
    };

    // Try to find delivery by ID or poNumber
    let delivery: PodDelivery | null = null;
    try {
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (uuidRegex.test(deliveryId)) {
        delivery = await prisma.delivery.findUnique({
          where: { id: deliveryId },
          select: {
            id: true,
            customer: true,
            address: true,
            phone: true,
            items: true,
            status: true,
            driverSignature: true,
            customerSignature: true,
            photos: true,
            conditionNotes: true,
            deliveryNotes: true,
            deliveredBy: true,
            deliveredAt: true,
            podCompletedAt: true,
            createdAt: true,
            updatedAt: true,
            metadata: true
          }
        });
      } else {
        // Try by PO number
        delivery = await prisma.delivery.findFirst({
          where: { poNumber: deliveryId },
          select: {
            id: true,
            customer: true,
            address: true,
            phone: true,
            items: true,
            status: true,
            driverSignature: true,
            customerSignature: true,
            photos: true,
            conditionNotes: true,
            deliveryNotes: true,
            deliveredBy: true,
            deliveredAt: true,
            podCompletedAt: true,
            createdAt: true,
            updatedAt: true,
            metadata: true
          }
        });
      }
    } catch (err: unknown) {
      const e = err as { message?: string };
      console.error(`[Deliveries/POD] Error fetching delivery:`, err);
      return void res.status(500).json({ error: 'database_error', detail: e.message });
    }

    if (!delivery) {
      return void res.status(404).json({ error: 'delivery_not_found' });
    }

    // Check if POD exists
    const hasPOD = !!(delivery.driverSignature || delivery.customerSignature ||
                     (delivery.photos && Array.isArray(delivery.photos) && delivery.photos.length > 0));

    // Return POD data
    res.json({
      ok: true,
      deliveryId: delivery.id,
      customer: delivery.customer,
      address: delivery.address,
      items: delivery.items,
      status: delivery.status,
      hasPOD: hasPOD,
      pod: {
        driverSignature: delivery.driverSignature || null,
        customerSignature: delivery.customerSignature || null,
        photos: delivery.photos || [],
        photoCount: (delivery.photos && Array.isArray(delivery.photos)) ? delivery.photos.length : 0,
        conditionNotes: delivery.conditionNotes || null,
        deliveryNotes: delivery.deliveryNotes || null,
        deliveredBy: delivery.deliveredBy || null,
        deliveredAt: delivery.deliveredAt || null,
        podCompletedAt: delivery.podCompletedAt || null
      },
      metadata: delivery.metadata,
      createdAt: delivery.createdAt,
      updatedAt: delivery.updatedAt
    });

    console.log(`[Deliveries/POD] ✓ POD data retrieved successfully. Has POD: ${hasPOD}, Photos: ${delivery.photos?.length || 0}`);

  } catch (error: unknown) {
    const e = error as { message?: string };
    console.error('[Deliveries/POD] Error:', error);
    res.status(500).json({
      error: 'pod_retrieval_failed',
      detail: e.message
    });
  }
});

// PUT /api/admin/deliveries/:id/reschedule
// Admin-initiated reschedule: validates new date capacity, re-assigns driver, notifies customer.
// Status is set to scheduled-confirmed (not terminal) so the order stays visible and dispatchable.
router.put('/admin/:id/reschedule', authenticate, requireAnyRole('admin', 'delivery_team', 'logistics_team'), async (req: Request, res: Response): Promise<void> => {
  const { id: deliveryId } = req.params as { id: string };
  const { newDeliveryDate, reason } = req.body as { newDeliveryDate?: string; reason?: string };

  if (!newDeliveryDate) {
    res.status(400).json({ error: 'new_delivery_date_required' });
    return;
  }

  // Accept YYYY-MM-DD or ISO datetime; normalise to Dubai calendar date
  const iso = String(newDeliveryDate).trim().split('T')[0];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) {
    res.status(400).json({ error: 'invalid_delivery_date', message: 'Use YYYY-MM-DD format.' });
    return;
  }

  // Must be a non-Sunday within the next 7 eligible days (same rule as customer portal)
  if (getDubaiWeekday(iso) === 0) {
    res.status(400).json({ error: 'invalid_delivery_date', message: 'Sunday deliveries are not available.' });
    return;
  }
  const eligibleDays = getNextSevenEligibleDayIsoStrings();
  if (!eligibleDays.includes(iso)) {
    res.status(400).json({ error: 'invalid_delivery_date', message: 'Date must be within the next 7 eligible delivery days.' });
    return;
  }

  try {
    const existingDelivery = await prisma.delivery.findUnique({
      where: { id: deliveryId },
      select: { id: true, status: true, phone: true, items: true, metadata: true, confirmedDeliveryDate: true, confirmationStatus: true }
    }) as Record<string, unknown> | null;

    if (!existingDelivery) {
      res.status(404).json({ error: 'delivery_not_found' });
      return;
    }

    const prevMeta = existingDelivery.metadata && typeof existingDelivery.metadata === 'object'
      ? (existingDelivery.metadata as Record<string, unknown>) : {};
    const reasonText = (reason || '').trim() || 'Operational requirements';

    // Check fleet capacity for the new date (exclude this delivery from count).
    try {
      await assertSlotAvailable(prisma, deliveryId, iso, existingDelivery.items as string | null, prevMeta);
    } catch (slotErr: unknown) {
      res.status(400).json({ error: 'slot_unavailable', message: (slotErr as Error).message });
      return;
    }

    const { start: newDateStart } = dubaiDayRangeUtc(iso);

    // Update delivery: mark as rescheduled with the new confirmed date.
    // 'rescheduled' is an active (non-terminal) status — the order still needs to be delivered.
    // No re-confirmation SMS is needed; customer is notified via their tracking page.
    const updatedDelivery = await prisma.delivery.update({
      where: { id: deliveryId },
      data: {
        status: 'rescheduled',
        confirmationStatus: 'confirmed',
        confirmedDeliveryDate: newDateStart,
        metadata: {
          ...prevMeta,
          rescheduleReason: reasonText,
          rescheduledAt: new Date().toISOString(),
          rescheduledBy: req.user?.username || req.user?.email || req.user?.sub || 'admin',
          previousStatus: existingDelivery.status,
          previousDeliveryDate: (existingDelivery.confirmedDeliveryDate as Date | null)?.toISOString() ?? null,
        }
      }
    }) as Record<string, unknown>;

    // Release old driver assignments so we can re-assign for the new date.
    await prisma.deliveryAssignment.deleteMany({ where: { deliveryId } });

    // Auto-assign the best driver for the new date (respects 30-item truck cap).
    try {
      await autoAssignDelivery(deliveryId);
    } catch (assignErr: unknown) {
      console.warn('[Deliveries] Reschedule auto-assign failed:', (assignErr as Error).message);
    }

    // Audit event
    await prisma.deliveryEvent.create({
      data: {
        deliveryId,
        eventType: 'admin_rescheduled',
        payload: {
          previousStatus: existingDelivery.status,
          previousDeliveryDate: (existingDelivery.confirmedDeliveryDate as Date | null)?.toISOString() ?? null,
          newDeliveryDate: newDateStart.toISOString(),
          newDeliveryDateDubai: iso,
          reason: reasonText,
          rescheduledBy: req.user?.username || req.user?.email || req.user?.sub || 'admin',
          rescheduledAt: new Date().toISOString(),
        },
        actorType: 'admin',
        actorId: req.user?.sub || null
      }
    }).catch((err: unknown) => {
      console.warn('[Deliveries] Failed to create reschedule event:', (err as Error).message);
    });

    // Notify customer by SMS (fire-and-forget)
    if (existingDelivery.phone) {
      const smsService = require('../sms/smsService');
      smsService.sendRescheduleSms(deliveryId, newDateStart, reasonText).catch((err: unknown) => {
        console.warn('[Deliveries] Reschedule SMS failed:', (err as Error).message);
      });
    }

    cache.invalidatePrefix('tracking:');
    cache.invalidatePrefix('dashboard:');
    cache.invalidatePrefix('deliveries:list:v2');

    res.json({
      ok: true,
      delivery: {
        id: updatedDelivery.id,
        status: updatedDelivery.status,
        confirmedDeliveryDate: updatedDelivery.confirmedDeliveryDate,
        confirmedDeliveryDateDubai: iso,
        rescheduleReason: reasonText,
      }
    });
  } catch (err: unknown) {
    const e = err as { message?: string };
    console.error('[Deliveries] Admin reschedule error:', e.message);
    res.status(500).json({ error: 'reschedule_failed', detail: e.message });
  }
});

export default router;
