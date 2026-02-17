const express = require('express');
const router = express.Router();
// GET /api/admin/dashboard
const { authenticate, requireRole } = require('../auth');
const sapService = require('../../../services/sapService');
const prisma = require('../db/prisma');

/**
 * Compute dashboard analytics from deliveries
 */
function computeAnalytics(deliveries) {
  const list = Array.isArray(deliveries) ? deliveries : [];

  // 1. Top 10 customers by order count with comprehensive metrics
  // Source: customer field (maps from "Ship to party" in delivery format)
  const customerData = {};
  const areaKeywords = [
    'Marina', 'Jumeirah', 'Jebel Ali', 'Business Bay', 'Downtown', 'Deira', 'Bur Dubai',
    'Silicon Oasis', 'Motor City', 'Arabian Ranches', 'The Springs', 'Palm', 'Al Barsha',
    'Al Quoz', 'JLT', 'DIFC', 'Karama', 'Satwa', 'Oud Metha', 'Mirdif', 'Dubai Hills'
  ];
  
  list.forEach((d) => {
    const cust = (d.customer || '').trim();
    if (!cust) return;
    
    if (!customerData[cust]) {
      customerData[cust] = {
        customer: cust,
        orders: 0,
        delivered: 0,
        pending: 0,
        cancelled: 0,
        totalQuantity: 0,
        lastOrderDate: null,
        areas: {}
      };
    }
    
    const custData = customerData[cust];
    custData.orders++;
    
    // Count by status
    const status = (d.status || 'pending').toLowerCase();
    if (status === 'delivered') {
      custData.delivered++;
    } else if (status === 'pending' || status === 'out-for-delivery') {
      custData.pending++;
    } else if (status === 'cancelled') {
      custData.cancelled++;
    }
    
    // Total quantity from metadata
    const meta = d.metadata || {};
    const orig = meta.originalRow || meta._originalRow || {};
    const qty = parseFloat(orig['Confirmed quantity'] || orig['Confirmed Quantity'] || orig['Quantity'] || orig['qty'] || 0);
    if (!isNaN(qty)) {
      custData.totalQuantity += qty;
    }
    
    // Track last order date
    const orderDate = new Date(d.createdAt || d.created_at || d.created || Date.now());
    if (!custData.lastOrderDate || orderDate > custData.lastOrderDate) {
      custData.lastOrderDate = orderDate;
    }
    
    // Track delivery areas
    const addr = (d.address || '').toLowerCase();
    const city = (orig.City || orig.city || '').toLowerCase();
    const searchStr = addr + ' ' + city;
    let area = 'Other';
    for (const kw of areaKeywords) {
      if (searchStr.includes(kw.toLowerCase())) {
        area = kw;
        break;
      }
    }
    custData.areas[area] = (custData.areas[area] || 0) + 1;
  });
  
  const topCustomers = Object.values(customerData)
    .map((custData) => {
      // Calculate success rate
      const successRate = custData.orders > 0 
        ? ((custData.delivered / custData.orders) * 100).toFixed(1)
        : '0.0';
      
      // Find primary area (most frequent)
      let primaryArea = 'N/A';
      let maxAreaCount = 0;
      Object.entries(custData.areas).forEach(([area, count]) => {
        if (count > maxAreaCount) {
          maxAreaCount = count;
          primaryArea = area;
        }
      });
      
      return {
        customer: custData.customer,
        orders: custData.orders,
        delivered: custData.delivered,
        pending: custData.pending,
        cancelled: custData.cancelled,
        successRate: parseFloat(successRate),
        totalQuantity: Math.round(custData.totalQuantity),
        lastOrderDate: custData.lastOrderDate ? custData.lastOrderDate.toISOString() : null,
        primaryArea: primaryArea
      };
    })
    .sort((a, b) => b.orders - a.orders)
    .slice(0, 10);

  // 2. Top 10 items with PNC and Model ID
  // Item name = Description, PNC = Material Number, Model ID from delivery metadata
  // Source: metadata.originalRow from uploaded file
  const itemCount = {};
  list.forEach((d) => {
    const meta = d.metadata || {};
    const orig = meta.originalRow || meta._originalRow || {};
    const pnc = String(orig.Material || orig.material || orig['Material Number'] || '').trim();
    const item = String(orig.Description || orig.description || '').trim();
    const modelId = String(orig['MODEL ID'] || orig['Model ID'] || orig['model_id'] || orig.ModelID || '').trim();
    const itemsStr = (d.items || '').trim();
    const itemDisplay = item || (itemsStr ? itemsStr.split(/\s*-\s*/)[0]?.trim() : '') || 'Unspecified';
    const pncDisplay = pnc || '-';
    const modelIdDisplay = modelId || '-';
    const key = `${itemDisplay}::${pncDisplay}::${modelIdDisplay}`;
    if (!itemCount[key]) {
      itemCount[key] = { item: itemDisplay, pnc: pncDisplay, modelId: modelIdDisplay, count: 0 };
    }
    itemCount[key].count++;
  });
  const topItems = Object.values(itemCount)
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  // 3. Delivery area statistics
  // Source: address (Ship to Street, City, Postal code) and metadata.originalRow.City
  const areaCount = {};
  list.forEach((d) => {
    const addr = (d.address || '').toLowerCase();
    const city = ((d.metadata?.originalRow || d.metadata?._originalRow || {}).City || '').toLowerCase();
    const searchStr = addr + ' ' + city;
    let area = 'Other';
    for (const kw of areaKeywords) {
      if (searchStr.includes(kw.toLowerCase())) {
        area = kw;
        break;
      }
    }
    areaCount[area] = (areaCount[area] || 0) + 1;
  });
  const deliveryByArea = Object.entries(areaCount)
    .map(([area, count]) => ({ area, count }))
    .sort((a, b) => b.count - a.count);

  // 4. Monthly delivery statistics (last 12 months)
  const monthCount = {};
  const now = new Date();
  for (let i = 0; i < 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    monthCount[key] = { month: key, label: d.toLocaleDateString('en-GB', { month: 'short', year: '2-digit' }), count: 0 };
  }
  list.forEach((d) => {
    const t = d.delivered_at || d.deliveredAt || d.created_at || d.createdAt || d.created;
    if (!t) return;
    const dt = new Date(t);
    const key = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`;
    if (monthCount[key]) {
      monthCount[key].count++;
    }
  });
  const deliveryByMonth = Object.values(monthCount)
    .sort((a, b) => a.month.localeCompare(b.month));

  // 5. Weekly delivery quantity (last 7 days)
  const weekDays = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    weekDays.push({
      date: key,
      day: d.toLocaleDateString('en-GB', { weekday: 'short' }),
      count: 0
    });
  }
  list.forEach((d) => {
    const t = d.delivered_at || d.deliveredAt || d.created_at || d.createdAt || d.created;
    if (!t) return;
    const dt = new Date(t);
    const key = dt.toISOString().slice(0, 10);
    const found = weekDays.find((w) => w.date === key);
    if (found) found.count++;
  });
  const deliveryByWeek = weekDays;

  return {
    topCustomers,
    topItems,
    deliveryByArea,
    deliveryByMonth,
    deliveryByWeek
  };
}

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
        delivered_at: d.deliveredAt,
        deliveredAt: d.deliveredAt,
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

    // Analytics: Top 10 customers, Top 10 items, delivery area, monthly, weekly
    const analytics = computeAnalytics(deliveries);

    res.json({ drivers, recentLocations, smsRecent, totals, recentCounts, analytics });
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
