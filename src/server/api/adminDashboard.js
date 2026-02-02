const express = require('express');
const router = express.Router();
// GET /api/admin/dashboard
const { authenticate, requireRole } = require('../auth');
const sapService = require('../../../services/sapService');
const prisma = require('../db/prisma');

// GET /api/admin/dashboard
router.get('/', authenticate, requireRole('admin'), async (req, res) => {
  try {
    // Check if Prisma is initialized
    if (!prisma) {
      console.error('[Dashboard] CRITICAL: Prisma client is not initialized');
      console.error('[Dashboard] DATABASE_URL:', process.env.DATABASE_URL ? 'SET (' + process.env.DATABASE_URL.length + ' chars)' : 'NOT SET');
      return res.status(503).json({ 
        error: 'database_not_connected', 
        message: 'Database connection is not available. Please check server configuration.',
        detail: 'Prisma client failed to initialize'
      });
    }

    // Test database connection first
    try {
      await prisma.$queryRaw`SELECT 1`;
      console.log('[Dashboard] Database connection verified');
    } catch (dbError) {
      console.error('[Dashboard] Database connection test failed:', dbError.message);
      console.error('[Dashboard] Error code:', dbError.code);
      return res.status(503).json({ 
        error: 'database_connection_failed', 
        message: 'Failed to connect to database. Please check your connection settings.',
        detail: dbError.message,
        code: dbError.code
      });
    }

    // Fetch from database first (uploaded deliveries), then fallback to SAP
    const [dbDeliveries, driversResp, locationsResp, sapDeliveriesResp, smsResp] = await Promise.allSettled([
      prisma.delivery.findMany({
        include: {
          assignments: {
            include: {
              driver: {
                include: {
                  account: true
                }
              }
            }
          },
          events: {
            orderBy: { createdAt: 'desc' },
            take: 1
          }
        },
        orderBy: { createdAt: 'desc' }
      }).catch(err => {
        console.error('[Dashboard] Prisma query error:', err.message);
        console.error('[Dashboard] Error code:', err.code);
        console.error('[Dashboard] Error stack:', err.stack);
        // Return empty array on error to allow SAP fallback
        return []; 
      }),
      sapService.call('/Drivers', 'get').catch(() => ({ data: { value: [] } })),
      sapService.call('/Locations', 'get').catch(() => ({ data: { value: [] } })),
      sapService.call('/Deliveries', 'get').catch(() => ({ data: { value: [] } })),
      sapService.call('/SMSConfirmations', 'get').catch(() => ({ data: { value: [] } })),
    ]);

    // Combine database deliveries with SAP deliveries (avoid duplicates)
    let deliveries = [];
    
    // Add database deliveries (formatted for compatibility)
    if (dbDeliveries.status === 'fulfilled') {
      deliveries = dbDeliveries.value.map(d => ({
        id: d.id,
        customer: d.customer,
        address: d.address,
        phone: d.phone,
        poNumber: d.poNumber,
        lat: d.lat,
        lng: d.lng,
        status: d.status,
        items: d.items,
        metadata: d.metadata,
        created_at: d.createdAt,
        createdAt: d.createdAt,
        created: d.createdAt,
        assignedDriverId: d.assignments?.[0]?.driverId || null,
        driverName: d.assignments?.[0]?.driver?.fullName || null,
        // Include assignment status
        assignmentStatus: d.assignments?.[0]?.status || 'unassigned'
      }));
    }

    // Add SAP deliveries (if any) that don't exist in database
    if (sapDeliveriesResp.status === 'fulfilled') {
      let sapDeliveries = [];
      if (Array.isArray(sapDeliveriesResp.value.data?.value)) {
        sapDeliveries = sapDeliveriesResp.value.data.value;
      } else if (Array.isArray(sapDeliveriesResp.value.data)) {
        sapDeliveries = sapDeliveriesResp.value.data;
      }
      
      // Only add SAP deliveries that aren't already in database
      const dbDeliveryIds = new Set(deliveries.map(d => d.id));
      const newSapDeliveries = sapDeliveries.filter(d => {
        const sapId = d.id || d.ID;
        return sapId && !dbDeliveryIds.has(sapId);
      });
      deliveries = deliveries.concat(newSapDeliveries);
    }

    const drivers = driversResp.status === 'fulfilled' ? (Array.isArray(driversResp.value.data.value) ? driversResp.value.data.value.length : (Array.isArray(driversResp.value.data) ? driversResp.value.data.length : 0)) : 0;
    const recentLocations = locationsResp.status === 'fulfilled' ? (Array.isArray(locationsResp.value.data.value) ? locationsResp.value.data.value.length : (Array.isArray(locationsResp.value.data) ? locationsResp.value.data.length : 0)) : 0;
    const smsRecent = smsResp.status === 'fulfilled' ? (Array.isArray(smsResp.value.data.value) ? smsResp.value.data.value.length : (Array.isArray(smsResp.value.data) ? smsResp.value.data.length : 0)) : 0;

    const totals = { 
      total: deliveries.length, 
      delivered: 0, 
      cancelled: 0, 
      rescheduled: 0, 
      pending: 0,
      scheduled: 0,
      'scheduled-confirmed': 0,
      'out-for-delivery': 0,
      'delivered-with-installation': 0,
      'delivered-without-installation': 0,
      rejected: 0,
      // Customer response tracking
      customerAccepted: 0,
      customerCancelled: 0,
      customerRescheduled: 0,
      // POD tracking
      withPOD: 0,
      withoutPOD: 0
    };
    for (const d of deliveries) {
      const s = (d.status || '').toLowerCase();
      if (s === 'delivered' || s === 'done' || s === 'completed' || s === 'delivered-with-installation' || s === 'delivered-without-installation') {
        totals.delivered++;
        // Check for POD (Proof of Delivery) - signature or photos
        const hasPOD = (d.driverSignature || d.customerSignature || (d.photos && d.photos.length > 0) || 
                       d.pod || d.proof_of_delivery || d.hasPOD);
        if (hasPOD) {
          totals.withPOD++;
        } else {
          totals.withoutPOD++;
        }
      }
      if (s === 'delivered-with-installation') totals['delivered-with-installation']++;
      if (s === 'delivered-without-installation') totals['delivered-without-installation']++;
      if (s === 'cancelled' || s === 'canceled') totals.cancelled++;
      if (s === 'rejected') totals.rejected++;
      if (s === 'rescheduled') totals.rescheduled++;
      if (s === 'scheduled') totals.scheduled++;
      if (s === 'scheduled-confirmed') {
        totals['scheduled-confirmed']++;
        totals.customerAccepted++; // Customer accepted/confirmed
      }
      if (s === 'out-for-delivery') totals['out-for-delivery']++;
      
      // Track customer responses from status
      if (s === 'cancelled' || s === 'canceled' || s === 'rejected') {
        // Check if cancelled by customer
        if (d.actor_type === 'customer' || d.cancelled_by === 'customer') {
          totals.customerCancelled++;
        }
      }
      if (s === 'rescheduled') {
        // Check if rescheduled by customer
        if (d.actor_type === 'customer' || d.rescheduled_by === 'customer') {
          totals.customerRescheduled++;
        }
      }
      
      if (!['delivered', 'done', 'completed', 'delivered-with-installation', 'delivered-without-installation', 'cancelled', 'canceled', 'rejected', 'rescheduled', 'scheduled', 'scheduled-confirmed', 'out-for-delivery', 'in-progress'].includes(s)) {
        totals.pending++;
      }
    }

    // Recent trends (last 24h) if created_at or updated_at available
    const now = Date.now();
    const last24 = (d) => {
      // Check both created_at and updated_at to catch status changes
      const t = d.updated_at || d.updatedAt || d.created_at || d.createdAt || d.created || null;
      if (!t) return false;
      const dt = new Date(t).getTime();
      return (now - dt) <= 24 * 3600 * 1000;
    };
    const recentCounts = { delivered: 0, cancelled: 0, rescheduled: 0 };
    for (const d of deliveries.filter(last24)) {
      const s = (d.status || '').toLowerCase();
      // Count all delivered variations including with/without installation
      if (['delivered', 'done', 'completed', 'delivered-with-installation', 'delivered-without-installation'].includes(s)) {
        recentCounts.delivered++;
      } else if (['cancelled', 'canceled', 'rejected'].includes(s)) {
        recentCounts.cancelled++;
      } else if (s === 'rescheduled') {
        recentCounts.rescheduled++;
      }
    }

    res.json({ drivers, recentLocations, smsRecent, totals, recentCounts });
  } catch (err) {
    console.error('[Dashboard] admin/dashboard error:', err.message);
    console.error('[Dashboard] Error code:', err.code);
    console.error('[Dashboard] Error stack:', err.stack);
    console.error('[Dashboard] DATABASE_URL status:', process.env.DATABASE_URL ? 'SET' : 'NOT SET');
    
    // Provide more helpful error messages
    if (err.message && err.message.includes('P1001')) {
      return res.status(503).json({ 
        error: 'database_connection_failed', 
        message: 'Cannot reach database server. Please check your connection string.',
        detail: err.message 
      });
    }
    
    if (err.message && err.message.includes('P2021')) {
      return res.status(503).json({ 
        error: 'database_schema_missing', 
        message: 'Database tables are missing. Please run migrations.',
        detail: err.message 
      });
    }
    
    res.status(500).json({ 
      error: 'server_error', 
      message: 'An unexpected error occurred while loading dashboard data.',
      detail: err.message 
    });
  }
});

module.exports = router;
