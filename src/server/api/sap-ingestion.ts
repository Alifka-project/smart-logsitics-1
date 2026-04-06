import { Router, Request, Response } from 'express';
import { randomUUID } from 'crypto';
import { authenticate, requireRole } from '../auth.js';
import { buildBusinessKey, upsertDeliveryByBusinessKey } from '../services/deliveryDedupService.js';
import prisma from '../db/prisma.js';

const router = Router();

type AuthUser = { sub: string; role?: string; account?: { role?: string } };

/**
 * SAP Data Ingestion Endpoint
 * POST /api/sap/ingest
 *
 * This endpoint receives data from SAP and properly saves it to the database
 * Including all customer details, items, and delivery information
 */
router.post('/ingest', authenticate, requireRole('admin'), async (req: Request, res: Response): Promise<void> => {
  try {
    const { deliveries } = req.body;

    console.log(`[SAP Ingestion] Received ${deliveries?.length || 0} deliveries from SAP`);

    if (!deliveries || !Array.isArray(deliveries)) {
      res.status(400).json({ error: 'deliveries_array_required' }); return;
    }

    if (deliveries.length === 0) {
      res.status(400).json({ error: 'no_deliveries_provided' }); return;
    }

    const results: { id: string; customer: unknown; status: string }[] = [];
    const errors: { index: number; error: string; delivery: string }[] = [];

    for (let i = 0; i < deliveries.length; i++) {
      const delivery = deliveries[i] as Record<string, unknown>;

      try {
        let deliveryId = delivery.id as string | undefined;
        if (!deliveryId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(deliveryId)) {
          deliveryId = randomUUID();
        }

        console.log(`[SAP Ingestion] Processing delivery ${i + 1}/${deliveries.length}: ${deliveryId}`);

        let itemsData: string | null = delivery.items as string | null;
        if (typeof itemsData === 'object' && !Array.isArray(itemsData)) {
          itemsData = JSON.stringify(itemsData);
        } else if (Array.isArray(itemsData)) {
          itemsData = JSON.stringify(itemsData);
        } else if (typeof itemsData !== 'string') {
          itemsData = null;
        }

        const metadata: Record<string, unknown> = {
          sapDeliveryNumber: delivery.sapDeliveryNumber || delivery.deliveryNumber || null,
          sapOrderNumber: delivery.sapOrderNumber || delivery.orderNumber || null,
          sapCustomerNumber: delivery.sapCustomerNumber || delivery.customerNumber || null,
          originalPONumber: delivery._originalPONumber || delivery.poNumber || null,
          originalDeliveryNumber: delivery._originalDeliveryNumber || null,
          originalQuantity: delivery._originalQuantity || delivery.quantity || null,
          originalCity: delivery._originalCity || delivery.city || null,
          originalRoute: delivery._originalRoute || delivery.route || null,
          warehouse: delivery.warehouse || null,
          weight: delivery.weight || null,
          volume: delivery.volume || null,
          specialInstructions: delivery.specialInstructions || null,
          customerPreferences: delivery.customerPreferences || null,
          itemDetails: delivery.itemDetails || null,
          sapSyncedAt: new Date().toISOString(),
          ...(delivery.metadata as Record<string, unknown> || {})
        };

        const poNumberToSave = (delivery._originalPONumber || delivery.poNumber || null) as string | null;
        const originalDeliveryNumber =
          (metadata.originalDeliveryNumber ||
          metadata.sapDeliveryNumber ||
          null) as string | null;

        const businessKey = buildBusinessKey(poNumberToSave, originalDeliveryNumber);

        const incoming = {
          id: deliveryId,
          customer: (delivery.customer || delivery.customerName || delivery.name || null) as string | null,
          address: (delivery.address || delivery.deliveryAddress || null) as string | null,
          phone: (delivery.phone || delivery.customerPhone || delivery.contactNumber || null) as string | null,
          poNumber: poNumberToSave,
          lat: (delivery.lat || delivery.latitude || null) as number | null,
          lng: (delivery.lng || delivery.longitude || null) as number | null,
          status: (delivery.status || 'pending') as string,
          items: itemsData,
          metadata,
          businessKey
        };

        const { delivery: savedDelivery, existed } = await upsertDeliveryByBusinessKey({
          prisma,
          source: 'sap',
          incoming
        });

        await prisma.deliveryEvent.create({
          data: {
            deliveryId: savedDelivery.id as string,
            eventType: existed ? 'sap_reimport' : 'sap_sync',
            payload: {
              source: 'SAP',
              customer: savedDelivery.customer as string | null,
              address: savedDelivery.address as string | null,
              items: itemsData,
              syncedAt: new Date().toISOString(),
              businessKey: ((savedDelivery as Record<string, unknown>).businessKey as string) || businessKey || null,
              deduplicated: !!existed
            },
            actorType: 'system',
            actorId: (req.user as AuthUser)?.sub || null
          }
        }).catch((err: unknown) => {
          const e = err as { message?: string };
          console.warn(`[SAP Ingestion] Failed to create sync event:`, e.message);
        });

        console.log(`[SAP Ingestion] ✓ Successfully saved delivery: ${savedDelivery.customer} at ${((savedDelivery.address as string) || '').substring(0, 50)}`);

        results.push({
          id: savedDelivery.id as string,
          customer: savedDelivery.customer,
          status: 'success'
        });

      } catch (err: unknown) {
        const e = err as { message?: string };
        console.error(`[SAP Ingestion] Error saving delivery ${i + 1}:`, err);
        errors.push({
          index: i,
          error: e.message ?? 'unknown error',
          delivery: (delivery.customer || delivery.name || 'unknown') as string
        });
      }
    }

    console.log(`[SAP Ingestion] ✓ Completed: ${results.length} saved, ${errors.length} errors`);

    res.json({
      success: true,
      saved: results.length,
      failed: errors.length,
      results: results,
      errors: errors.length > 0 ? errors : undefined
    });

  } catch (err: unknown) {
    const e = err as { message?: string };
    console.error('[SAP Ingestion] Fatal error:', err);
    res.status(500).json({ 
      error: 'sap_ingestion_failed', 
      detail: e.message 
    });
  }
});

/**
 * Batch update endpoint for SAP status updates
 * PUT /api/sap/status-update
 */
router.put('/status-update', authenticate, requireRole('admin'), async (req: Request, res: Response): Promise<void> => {
  try {
    const { updates } = req.body as { updates: { id: string; status: string; metadata?: Record<string, unknown> }[] };

    if (!updates || !Array.isArray(updates)) {
      res.status(400).json({ error: 'updates_array_required' }); return;
    }

    const results: { id: string; status: string }[] = [];
    const errors: { id: string; error: string }[] = [];

    for (const update of updates) {
      try {
        const { id, status, metadata } = update;

        if (!id || !status) {
          errors.push({ id: id || 'unknown', error: 'missing_id_or_status' });
          continue;
        }

        const updatedDelivery = await prisma.delivery.update({
          where: { id },
          data: {
            status,
            metadata: {
              ...(metadata || {}),
              sapStatusUpdatedAt: new Date().toISOString()
            },
            updatedAt: new Date()
          }
        });

        results.push({ id: updatedDelivery.id, status: 'updated' });

      } catch (err: unknown) {
        const e = err as { message?: string };
        errors.push({ id: update.id, error: e.message ?? 'unknown error' });
      }
    }

    res.json({
      success: true,
      updated: results.length,
      failed: errors.length,
      results,
      errors: errors.length > 0 ? errors : undefined
    });

  } catch (err: unknown) {
    const e = err as { message?: string };
    console.error('[SAP Status Update] Fatal error:', err);
    res.status(500).json({ 
      error: 'sap_status_update_failed', 
      detail: e.message 
    });
  }
});

export default router;
