import { Router, Request, Response } from 'express';
const router = Router();
const { authenticate, requireRole } = require('../auth');
const sapService = require('../services/sapService.js');
const prisma = require('../db/prisma');
const { sortDeliveriesIncompleteLast } = require('../utils/deliveryListSort');

type DeliveryRecord = Record<string, unknown> & {
  customer?: string;
  address?: string;
  status?: string;
  metadata?: Record<string, unknown> & { originalRow?: Record<string, unknown>; _originalRow?: Record<string, unknown> };
  items?: string;
  createdAt?: unknown;
  created_at?: unknown;
  created?: unknown;
  deliveredAt?: unknown;
  delivered_at?: unknown;
  updated_at?: unknown;
  updatedAt?: unknown;
  driverSignature?: unknown;
  customerSignature?: unknown;
  photos?: unknown[];
  pod?: unknown;
  proof_of_delivery?: unknown;
  hasPOD?: unknown;
  confirmationStatus?: string;
  customerConfirmedAt?: unknown;
  actor_type?: string;
  cancelled_by?: string;
  rescheduled_by?: string;
};

/**
 * Compute dashboard analytics from deliveries
 */
function computeAnalytics(deliveries: unknown) {
  const list: DeliveryRecord[] = Array.isArray(deliveries) ? deliveries : [];

  const areaKeywords = [
    'Marina', 'Jumeirah', 'Jebel Ali', 'Business Bay', 'Downtown', 'Deira', 'Bur Dubai',
    'Silicon Oasis', 'Motor City', 'Arabian Ranches', 'The Springs', 'Palm', 'Al Barsha',
    'Al Quoz', 'JLT', 'DIFC', 'Karama', 'Satwa', 'Oud Metha', 'Mirdif', 'Dubai Hills'
  ];

  const customerData: Record<string, {
    customer: string; orders: number; delivered: number; pending: number; cancelled: number;
    totalQuantity: number; lastOrderDate: Date | null; areas: Record<string, number>;
  }> = {};

  list.forEach((d) => {
    const cust = (String(d.customer || '')).trim();
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

    const status = (String(d.status || 'pending')).toLowerCase();
    if (status === 'delivered') {
      custData.delivered++;
    } else if (status === 'pending' || status === 'out-for-delivery') {
      custData.pending++;
    } else if (status === 'cancelled') {
      custData.cancelled++;
    }

    const meta = (d.metadata || {}) as Record<string, unknown>;
    const orig = (meta.originalRow || meta._originalRow || {}) as Record<string, unknown>;
    const qty = parseFloat(String(orig['Confirmed quantity'] || orig['Confirmed Quantity'] || orig['Quantity'] || orig['qty'] || 0));
    if (!isNaN(qty)) {
      custData.totalQuantity += qty;
    }

    const orderDate = new Date((d.createdAt || d.created_at || d.created || Date.now()) as string | number);
    if (!custData.lastOrderDate || orderDate > custData.lastOrderDate) {
      custData.lastOrderDate = orderDate;
    }

    const addr = (String(d.address || '')).toLowerCase();
    const city = (String(orig.City || orig.city || '')).toLowerCase();
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
      const successRate = custData.orders > 0
        ? ((custData.delivered / custData.orders) * 100).toFixed(1)
        : '0.0';

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

  const itemCount: Record<string, { item: string; pnc: string; modelId: string; count: number }> = {};
  list.forEach((d) => {
    const meta = (d.metadata || {}) as Record<string, unknown>;
    const orig = (meta.originalRow || meta._originalRow || {}) as Record<string, unknown>;
    const pnc = String(orig.Material || orig.material || orig['Material Number'] || '').trim();
    const item = String(orig.Description || orig.description || '').trim();
    const modelId = String(orig['MODEL ID'] || orig['Model ID'] || orig['model_id'] || orig.ModelID || '').trim();
    const itemsStr = (String(d.items || '')).trim();
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

  const areaCount: Record<string, number> = {};
  list.forEach((d) => {
    const addr = (String(d.address || '')).toLowerCase();
    const meta = (d.metadata || {}) as Record<string, unknown>;
    const orig = (meta.originalRow || meta._originalRow || {}) as Record<string, unknown>;
    const city = (String(orig.City || '')).toLowerCase();
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

  const monthCount: Record<string, { month: string; label: string; count: number }> = {};
  const now = new Date();
  for (let i = 0; i < 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    monthCount[key] = { month: key, label: d.toLocaleDateString('en-GB', { month: 'short', year: '2-digit' }), count: 0 };
  }
  list.forEach((d) => {
    const t = d.delivered_at || d.deliveredAt || d.created_at || d.createdAt || d.created;
    if (!t) return;
    const dt = new Date(t as string | number);
    const key = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`;
    if (monthCount[key]) {
      monthCount[key].count++;
    }
  });
  const deliveryByMonth = Object.values(monthCount)
    .sort((a, b) => a.month.localeCompare(b.month));

  const weekDays: { date: string; day: string; count: number }[] = [];
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
    const dt = new Date(t as string | number);
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

// Cache for dashboard data
let dashboardCache: unknown = null;
let dashboardCacheTime = 0;
const DASHBOARD_CACHE_TTL = 60000;

// GET /api/admin/dashboard
router.get('/', authenticate, requireRole('admin'), async (req: Request, res: Response): Promise<void> => {
  try {
    const now = Date.now();
    const bypassCache = String((req.query as Record<string, unknown>)?.nocache || (req.query as Record<string, unknown>)?.noCache || '').trim() === '1';
    if (!bypassCache && dashboardCache && (now - dashboardCacheTime) < DASHBOARD_CACHE_TTL) {
      return void res.json(dashboardCache);
    }

    if (!prisma) {
      return void res.status(503).json({
        error: 'database_not_connected',
        message: 'Database connection is not available.',
        detail: 'Prisma client failed to initialize'
      });
    }

    const ninetyDaysAgo = new Date();
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

    const [dbDeliveries, driversResp, locationsResp, sapDeliveriesResp, smsResp] = await Promise.allSettled([
      prisma.delivery.findMany({
        where: {
          createdAt: {
            gte: ninetyDaysAgo
          }
        },
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
          confirmationStatus: true,
          customerConfirmedAt: true,
          confirmedDeliveryDate: true,
          createdAt: true,
          deliveredAt: true,
          driverSignature: true,
          customerSignature: true,
          photos: true,
          assignments: {
            take: 1,
            orderBy: { assignedAt: 'desc' },
            select: {
              driverId: true,
              status: true,
              driver: {
                select: {
                  fullName: true
                }
              }
            }
          },
          events: {
            orderBy: { createdAt: 'desc' },
            take: 1,
            select: {
              eventType: true,
              createdAt: true
            }
          }
        },
        orderBy: { createdAt: 'desc' },
        take: 1000
      }).catch((err: unknown) => {
        const e = err as { message?: string; code?: string; stack?: string };
        console.error('[Dashboard] Prisma query error:', e.message);
        console.error('[Dashboard] Error code:', e.code);
        console.error('[Dashboard] Error stack:', e.stack);
        return [];
      }),
      sapService.call('/Drivers', 'get').catch(() => ({ data: { value: [] } })),
      sapService.call('/Locations', 'get').catch(() => ({ data: { value: [] } })),
      sapService.call('/Deliveries', 'get').catch(() => ({ data: { value: [] } })),
      sapService.call('/SMSConfirmations', 'get').catch(() => ({ data: { value: [] } })),
    ]);

    let deliveries: DeliveryRecord[] = [];

    if ((dbDeliveries as PromiseFulfilledResult<unknown[]>).status === 'fulfilled') {
      const dbValue = (dbDeliveries as PromiseFulfilledResult<Record<string, unknown>[]>).value;
      deliveries = (dbValue.map((d: Record<string, unknown>) => {
        const assignments = d.assignments as Array<{ driverId?: string; status?: string; driver?: { fullName?: string } }> | undefined;
        return {
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
          confirmationStatus: d.confirmationStatus,
          customerConfirmedAt: d.customerConfirmedAt,
          confirmedDeliveryDate: d.confirmedDeliveryDate,
          created_at: d.createdAt,
          createdAt: d.createdAt,
          created: d.createdAt,
          delivered_at: d.deliveredAt,
          deliveredAt: d.deliveredAt,
          assignedDriverId: assignments?.[0]?.driverId || null,
          driverName: assignments?.[0]?.driver?.fullName || null,
          driverSignature: d.driverSignature,
          customerSignature: d.customerSignature,
          photos: d.photos as unknown[],
          assignmentStatus: assignments?.[0]?.status || 'unassigned'
        };
      }) as unknown as DeliveryRecord[]);
    }

    if ((sapDeliveriesResp as PromiseSettledResult<unknown>).status === 'fulfilled') {
      const sapValue = (sapDeliveriesResp as PromiseFulfilledResult<{ data?: { value?: unknown[]; } | unknown[] }>).value;
      let sapDeliveries: DeliveryRecord[] = [];
      if (Array.isArray((sapValue.data as { value?: unknown[] })?.value)) {
        sapDeliveries = (sapValue.data as { value: DeliveryRecord[] }).value;
      } else if (Array.isArray(sapValue.data)) {
        sapDeliveries = sapValue.data as DeliveryRecord[];
      }

      const dbDeliveryIds = new Set(deliveries.map((d) => d.id));
      const newSapDeliveries = sapDeliveries.filter((d) => {
        const sapId = (d as Record<string, unknown>).id || (d as Record<string, unknown>).ID;
        return sapId && !dbDeliveryIds.has(sapId as string);
      }).slice(0, 500);
      deliveries = deliveries.concat(newSapDeliveries);
    }

    sortDeliveriesIncompleteLast(deliveries);

    const driversResp_ = driversResp as PromiseSettledResult<{ data?: { value?: unknown[] } | unknown[] }>;
    const locationsResp_ = locationsResp as PromiseSettledResult<{ data?: { value?: unknown[] } | unknown[] }>;
    const smsResp_ = smsResp as PromiseSettledResult<{ data?: { value?: unknown[] } | unknown[] }>;

    const drivers = driversResp_.status === 'fulfilled' ? (Array.isArray((driversResp_.value.data as { value?: unknown[] })?.value) ? (driversResp_.value.data as { value: unknown[] }).value.length : (Array.isArray(driversResp_.value.data) ? (driversResp_.value.data as unknown[]).length : 0)) : 0;
    const recentLocations = locationsResp_.status === 'fulfilled' ? (Array.isArray((locationsResp_.value.data as { value?: unknown[] })?.value) ? (locationsResp_.value.data as { value: unknown[] }).value.length : (Array.isArray(locationsResp_.value.data) ? (locationsResp_.value.data as unknown[]).length : 0)) : 0;
    const smsRecent = smsResp_.status === 'fulfilled' ? (Array.isArray((smsResp_.value.data as { value?: unknown[] })?.value) ? (smsResp_.value.data as { value: unknown[] }).value.length : (Array.isArray(smsResp_.value.data) ? (smsResp_.value.data as unknown[]).length : 0)) : 0;

    const totals: Record<string, number> = {
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
      customerAccepted: 0,
      customerCancelled: 0,
      customerRescheduled: 0,
      withPOD: 0,
      withoutPOD: 0
    };
    for (const d of deliveries) {
      const s = (String(d.status || '')).toLowerCase();
      if (s === 'delivered' || s === 'done' || s === 'completed' || s === 'delivered-with-installation' || s === 'delivered-without-installation') {
        totals.delivered++;
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
        totals.customerAccepted++;
      }

      const isConfirmedByCustomer =
        String(d.confirmationStatus || '').toLowerCase() === 'confirmed' || !!d.customerConfirmedAt;
      if (isConfirmedByCustomer && s !== 'scheduled-confirmed') {
        totals.customerAccepted++;
      }
      if (s === 'out-for-delivery') totals['out-for-delivery']++;

      if (s === 'cancelled' || s === 'canceled' || s === 'rejected') {
        if (d.actor_type === 'customer' || d.cancelled_by === 'customer') {
          totals.customerCancelled++;
        }
      }
      if (s === 'rescheduled') {
        if (d.actor_type === 'customer' || d.rescheduled_by === 'customer') {
          totals.customerRescheduled++;
        }
      }

      if (!['delivered', 'done', 'completed', 'delivered-with-installation', 'delivered-without-installation', 'cancelled', 'canceled', 'rejected', 'rescheduled', 'scheduled', 'scheduled-confirmed', 'out-for-delivery', 'in-progress'].includes(s)) {
        totals.pending++;
      }
    }

    const nowMs = Date.now();
    const last24 = (d: DeliveryRecord) => {
      const t = d.updated_at || d.updatedAt || d.created_at || d.createdAt || d.created || null;
      if (!t) return false;
      const dt = new Date(t as string | number).getTime();
      return (nowMs - dt) <= 24 * 3600 * 1000;
    };
    const recentCounts = { delivered: 0, cancelled: 0, rescheduled: 0 };
    for (const d of deliveries.filter(last24)) {
      const s = (String(d.status || '')).toLowerCase();
      if (['delivered', 'done', 'completed', 'delivered-with-installation', 'delivered-without-installation'].includes(s)) {
        recentCounts.delivered++;
      } else if (['cancelled', 'canceled', 'rejected'].includes(s)) {
        recentCounts.cancelled++;
      } else if (s === 'rescheduled') {
        recentCounts.rescheduled++;
      }
    }

    const analytics = computeAnalytics(deliveries);

    const responseData = { drivers, recentLocations, smsRecent, totals, recentCounts, analytics };

    dashboardCache = responseData;
    dashboardCacheTime = Date.now();

    res.json(responseData);
  } catch (err: unknown) {
    const e = err as { message?: string; code?: string; stack?: string };
    console.error('[Dashboard] admin/dashboard error:', e.message);
    console.error('[Dashboard] Error code:', e.code);
    console.error('[Dashboard] Error stack:', e.stack);
    console.error('[Dashboard] DATABASE_URL status:', process.env.DATABASE_URL ? 'SET' : 'NOT SET');

    if (e.message && e.message.includes('P1001')) {
      return void res.status(503).json({
        error: 'database_connection_failed',
        message: 'Cannot reach database server. Please check your connection string.',
        detail: e.message
      });
    }

    if (e.message && e.message.includes('P2021')) {
      return void res.status(503).json({
        error: 'database_schema_missing',
        message: 'Database tables are missing. Please run migrations.',
        detail: e.message
      });
    }

    res.status(500).json({
      error: 'server_error',
      message: 'An unexpected error occurred while loading dashboard data.',
      detail: e.message
    });
  }
});

export default router;
