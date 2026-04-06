import { Router, Request, Response } from 'express';
import { randomUUID } from 'crypto';
import { assertSlotAvailable, dubaiDayRangeUtc, getDubaiWeekday, getNextSevenEligibleDayIsoStrings } from '../services/deliveryCapacityService';
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

  // Guard: dispatch statuses require Goods Movement Date to be set on the delivery
  const DISPATCH_STATUSES_GUARD = new Set(['out-for-delivery', 'in-transit', 'in-progress']);
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
  if (body.goodsMovementDate && !(existingDelivery as Record<string, unknown>).goodsMovementDate) {
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

  const updatedDelivery = await prisma.delivery.update({
    where: { id: existingDelivery.id },
    data: updateData
  }) as Record<string, unknown>;

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
router.put('/admin/:id/status', authenticate, requireAnyRole('admin', 'delivery_team'), async (req: Request, res: Response): Promise<void> => {
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

        // Out for delivery (same day as scheduled)
        if (lowerStatus === 'out-for-delivery') {
          const body = `Dear ${customerName},\n\nYour Electrolux order ${poRef} is out for delivery today.\n${trackingLink ? `\nTrack your delivery in real time:\n${trackingLink}\n` : ''}\nFor assistance, please contact the Electrolux Delivery Team at +971524408687.\n\nThank you,\nElectrolux Delivery Team`;

          const smsResult = await smsService.smsAdapter.sendSms({
            to: phone,
            body,
            metadata: { deliveryId: updatedDelivery.id, type: 'status_out_for_delivery' }
          }) as { messageId?: string; status?: string };

          await prisma.smsLog.create({
            data: {
              deliveryId: updatedDelivery.id,
              phoneNumber: phone,
              messageContent: body,
              smsProvider: process.env.SMS_PROVIDER || 'd7',
              externalMessageId: smsResult.messageId,
              status: smsResult.status || 'sent',
              sentAt: new Date(),
              metadata: { type: 'status_out_for_delivery' }
            }
          });
        }

        // Order delay: logistics team cannot dispatch — notify customer to reschedule
        if (lowerStatus === 'order-delay') {
          const body = `Dear ${customerName},\n\nWe regret to inform you that your Electrolux delivery ${poRef} has been delayed and could not be dispatched as scheduled.\n\nOur delivery team will contact you shortly to arrange a new delivery date at your convenience.\n${trackingLink ? `\nYou can also view your order status at:\n${trackingLink}\n` : ''}\nWe apologise for any inconvenience. For assistance, please contact us at +971524408687.\n\nThank you for your patience,\nElectrolux Delivery Team`;

          const smsResult = await smsService.smsAdapter.sendSms({
            to: phone,
            body,
            metadata: { deliveryId: updatedDelivery.id, type: 'status_order_delay' }
          }) as { messageId?: string; status?: string };

          await prisma.smsLog.create({
            data: {
              deliveryId: updatedDelivery.id as string,
              phoneNumber: phone,
              messageContent: body,
              smsProvider: process.env.SMS_PROVIDER || 'd7',
              externalMessageId: smsResult.messageId,
              status: smsResult.status || 'sent',
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

          const smsResult = await smsService.smsAdapter.sendSms({
            to: phone,
            body,
            metadata: { deliveryId: updatedDelivery.id, type: 'status_order_finished' }
          }) as { messageId?: string; status?: string };

          await prisma.smsLog.create({
            data: {
              deliveryId: updatedDelivery.id,
              phoneNumber: phone,
              messageContent: body,
              smsProvider: process.env.SMS_PROVIDER || 'd7',
              externalMessageId: smsResult.messageId,
              status: smsResult.status || 'sent',
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
router.put('/admin/:id/contact', authenticate, requireRole('admin'), async (req: Request, res: Response): Promise<void> => {
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
router.post('/upload', authenticate, async (req: Request, res: Response): Promise<void> => {
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

    const results: Array<{ deliveryId: string; saved: boolean; error?: string; deduplicated?: boolean }> = [];
    const deliveryIds: string[] = [];

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
        }) as { delivery: Record<string, unknown>; existed: boolean; skipped: boolean; conflict?: string; gmdUpdated: boolean };

        if (upsertResult.conflict) {
          console.warn(`[Deliveries/Upload] CONFLICT for delivery ${deliveryId}: ${upsertResult.conflict}`);
          results.push({ deliveryId, saved: false, error: upsertResult.conflict });
          continue;
        }

        const { delivery: savedDelivery, existed } = upsertResult;

        console.log(`[Deliveries/Upload] ✓ Saved delivery ${savedDelivery.id} (existed=${!!existed})`);
        const savedMeta = savedDelivery.metadata as Record<string, unknown> | null;
        if (!savedDelivery.poNumber && !savedMeta?.originalPONumber) {
          console.log(`[Deliveries/Upload] ⚠ Warning: No PO Number found for delivery ${savedDelivery.id}`);
        }

        // Save delivery event for audit
        await prisma.deliveryEvent.create({
          data: {
            deliveryId: savedDelivery.id,
            eventType: existed ? 'duplicate_upload' : 'uploaded',
            payload: {
              customer: delivery.customer || delivery.name,
              address: delivery.address,
              phone: delivery.phone,
              lat: delivery.lat,
              lng: delivery.lng,
              uploadDate: new Date().toISOString(),
              businessKey: savedDelivery.businessKey || businessKey || null,
              deduplicated: !!existed
            },
            actorType: req.user?.role || 'admin',
            actorId: req.user?.sub || null
          }
        }).catch((err: unknown) => {
          // Don't fail if event creation fails
          const e = err as { message?: string };
          console.warn(`[Deliveries] Failed to create event for ${deliveryId}:`, e.message);
        });

        deliveryIds.push(savedDelivery.id as string);
        results.push({ deliveryId: savedDelivery.id as string, saved: true, deduplicated: !!existed });
      } catch (error: unknown) {
        const e = error as { message?: string };
        console.error(`[Deliveries] Error saving delivery ${deliveryId}:`, error);
        results.push({ deliveryId, saved: false, error: e.message });
      }
    }

    // Driver assignment runs after the customer confirms a delivery date (SMS flow), not on raw upload.
    const mergedResults = results.map(result => ({
      ...result,
      assigned: false,
      driverId: null as string | null,
      driverName: null as string | null,
      assignmentError: null as string | null,
      assignmentPendingCustomerConfirm: true
    }));

    // Invalidate caches after bulk upload
    cache.invalidatePrefix('tracking:');
    cache.invalidatePrefix('dashboard:');
    cache.del('deliveries:list:v2');

    console.log(`[Deliveries] Upload complete: ${results.filter(r => r.saved).length} saved (assignment after customer confirms date)`);

    // Fetch the saved deliveries from database to return with full data including UUIDs
    const savedDeliveries = await prisma.delivery.findMany({
      where: { id: { in: deliveryIds } },
      select: {
        id: true,
        customer: true,
        address: true,
        phone: true,
        poNumber: true,
        lat: true,
        lng: true,
        status: true,
        items: true,
        metadata: true,
        createdAt: true,
        updatedAt: true
      }
    });

    console.log(`[Deliveries] Returning ${(savedDeliveries as unknown[]).length} deliveries with database IDs to frontend`);

    res.json({
      success: true,
      count: deliveryIds.length,
      saved: results.filter(r => r.saved).length,
      assigned: 0,
      results: mergedResults,
      deliveries: savedDeliveries  // Return full delivery objects with UUIDs
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
  'rescheduled',
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

    // Build a today-scoped date range for filtering confirmed deliveries.
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);
    // Cache key scoped to today's date so confirmed-for-future deliveries
    // automatically become visible on their scheduled date.
    const dateKey = todayStart.toISOString().split('T')[0];
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
router.put('/admin/:id/assign', authenticate, requireAnyRole('admin', 'delivery_team'), async (req: Request, res: Response): Promise<void> => {
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
    }) as { id: string; assignments?: unknown[] } | null;

    if (!delivery) {
      return void res.status(404).json({ error: 'delivery_not_found' });
    }

    // Remove old assignments for this delivery
    if (delivery.assignments && delivery.assignments.length > 0) {
      await prisma.deliveryAssignment.deleteMany({
        where: { deliveryId: id }
      });
      console.log(`[Deliveries] Removed old assignments for delivery ${id}`);
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

// POST /api/deliveries/:id/send-sms - Send confirmation SMS to customer
// Admin endpoint to trigger SMS when document is uploaded or SAP process completes
router.post('/:id/send-sms', authenticate, requireRole('admin'), async (req: Request, res: Response): Promise<void> => {
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

    // Always generate the confirmation token first — link is always available
    // even when both SMS and email fail.
    const smsService = require('../sms/smsService');
    const token = smsService.generateConfirmationToken() as string;
    // 30 days — customers may receive stock next month
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    const frontendUrl = process.env.FRONTEND_URL || 'https://electrolux-smart-portal.vercel.app';
    const confirmationLink = `${frontendUrl}/confirm-delivery/${token}`;
    const customerName = (delivery.customer as string) || 'Valued Customer';
    const poRef = delivery.poNumber ? `#${delivery.poNumber}` : '';
    const smsBody = `Dear ${customerName},\n\nYour Electrolux order ${poRef} is ready for delivery.\n\nPlease confirm your preferred delivery date using the link below:\n${confirmationLink}\n\nFor assistance, please contact the Electrolux Delivery Team at +971524408687.\n\nThank you,\nElectrolux Delivery Team`;

    // Persist the token to the delivery record immediately
    await prisma.delivery.update({
      where: { id: delivery.id },
      data: {
        confirmationToken: token,
        tokenExpiresAt: expiresAt,
        confirmationStatus: 'pending'
      }
    });

    if (!normalizedPhone) {
      return void res.status(400).json({ error: 'no_phone', message: 'Delivery has no phone number' });
    }

    // ── 1. Send message — WhatsApp for UAE (+971), SMS for all other countries ──
    const isUAE = normalizedPhone.startsWith('+971');
    let sent = false;
    let sendError: string | null = null;
    let messageId: string | null = null;
    let d7Status: string | null = null;
    const channel = isUAE ? 'whatsapp' : 'sms';

    try {
      if (isUAE) {
        const WhatsAppAdapter = require('../sms/whatsappAdapter');
        const waAdapter = new WhatsAppAdapter(process.env);
        const result = await waAdapter.sendMessage({ to: normalizedPhone, body: smsBody }) as { messageId?: string; status?: string };
        messageId = result.messageId || null;
        d7Status = result.status || null;
        sent = true;
        console.log('[WhatsApp] Sent to', normalizedPhone, 'MID:', messageId);
      } else {
        const smsResult = await smsService.smsAdapter.sendSms({
          to: normalizedPhone,
          body: smsBody,
          metadata: { deliveryId: delivery.id, type: 'confirmation_request' }
        }) as { messageId?: string; status?: string };
        messageId = smsResult.messageId || null;
        d7Status = smsResult.status || null;
        sent = true;
        console.log('[SMS] Sent to', normalizedPhone, 'MID:', messageId);
      }

      await prisma.smsLog.create({
        data: {
          deliveryId: delivery.id,
          phoneNumber: normalizedPhone,
          messageContent: smsBody,
          smsProvider: isUAE ? 'd7-whatsapp' : 'd7',
          externalMessageId: messageId,
          status: 'sent',
          sentAt: new Date(),
          metadata: { type: 'confirmation_request', channel, tokenExpiry: expiresAt.toISOString(), d7Status }
        }
      });
    } catch (err: unknown) {
      const e = err as { message?: string; response?: { data?: unknown } };
      console.error(`[${channel.toUpperCase()}] Send failed:`, e.message);
      sendError = e.message || null;
      const d7Detail = e.response?.data ? JSON.stringify(e.response.data) : null;

      await prisma.smsLog.create({
        data: {
          deliveryId: delivery.id,
          phoneNumber: normalizedPhone,
          messageContent: smsBody,
          smsProvider: isUAE ? 'd7-whatsapp' : 'd7',
          status: 'failed',
          failureReason: e.message,
          sentAt: new Date(),
          metadata: { type: 'confirmation_request', channel, tokenExpiry: expiresAt.toISOString(), d7Detail }
        }
      }).catch((e: unknown) => console.error('[Log] Error:', (e as { message?: string }).message));
    }

    // ── 2. Build response ──────────────────────────────────────────────────
    if (!sent) {
      return void res.status(500).json({
        ok: false,
        error: `${channel}_failed`,
        message: sendError || `${channel} send failed`,
        d7Detail: sendError,
        token,
        confirmationLink
      });
    }

    return void res.json({
      ok: true,
      smsSent: true,
      deliveredVia: channel,
      d7Status,
      message: isUAE ? 'WhatsApp message sent successfully' : 'SMS sent successfully',
      token,
      messageId,
      expiresAt: expiresAt.toISOString(),
      confirmationLink
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
router.put('/admin/:id/reschedule', authenticate, requireAnyRole('admin', 'delivery_team'), async (req: Request, res: Response): Promise<void> => {
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

    // Update delivery: keep it active as scheduled-confirmed with new confirmed date.
    const updatedDelivery = await prisma.delivery.update({
      where: { id: deliveryId },
      data: {
        status: 'scheduled-confirmed',
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
