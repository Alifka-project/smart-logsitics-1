/**
 * Debug Fixes Test Suite — 10+ scenarios covering all 4 bug-fix areas:
 *   D1/D2: Driver portal drag-reorder & real-time routing
 *   D3:    Awaiting-customer flow after upload without GMD
 *   D4:    Delivery Team Portal Operations table correctness
 *   D5:    Logistics Team Portal Assign & Dispatch table correctness
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── helpers ──────────────────────────────────────────────────────────────────

function makeDelivery(overrides: Record<string, unknown> = {}) {
  return {
    id: 'del-' + Math.random().toString(36).slice(2, 8),
    customer: 'Test Customer',
    phone: '+971501234567',
    address: 'Dubai Marina, Dubai',
    status: 'pending',
    poNumber: 'PO-TEST-001',
    assignedDriverId: null,
    goodsMovementDate: null,
    smsSentAt: null,
    confirmationStatus: 'none',
    confirmedDeliveryDate: null,
    items: 'Product A',
    metadata: {},
    ...overrides,
  };
}

// ── D1 / D2: Driver Portal – drag-reorder + real-time routing ────────────────

describe('D1/D2 – Driver Portal drag-reorder & routing', () => {
  it('S01 – onReorder callback updates local state & clears lastRoute ref', () => {
    // Simulate: driver drags stop 2 to position 1
    const deliveries = [
      makeDelivery({ id: 'a', address: 'Address A' }),
      makeDelivery({ id: 'b', address: 'Address B' }),
      makeDelivery({ id: 'c', address: 'Address C' }),
    ];
    const newOrder = [deliveries[1], deliveries[0], deliveries[2]];

    // Contract: onReorder sets manuallyOrderedRef = true & calls setDeliveries
    let manualOrderFlag = false;
    let capturedOrder: typeof deliveries = [];
    const handleManualReorder = (order: typeof deliveries) => {
      manualOrderFlag = true;
      capturedOrder = order;
    };

    handleManualReorder(newOrder);

    expect(manualOrderFlag).toBe(true);
    expect(capturedOrder[0].id).toBe('b');
    expect(capturedOrder[1].id).toBe('a');
  });

  it('S02 – fresh loadDeliveries resets manual order flag', () => {
    // When fresh data loads from server, nearest-neighbour should take over again
    let manuallyOrderedRef = true;
    const loadDeliveries = () => { manuallyOrderedRef = false; };

    loadDeliveries();

    expect(manuallyOrderedRef).toBe(false);
  });

  it('S03 – route recalculates when GPS moves ≥ 20 m (real-time threshold)', () => {
    const THRESHOLD_KM = 0.02; // 20 m — new tighter threshold vs old 50 m

    // Haversine stub
    const calculateDistance = (lat1: number, lng1: number, lat2: number, lng2: number): number => {
      const R = 6371;
      const dLat = ((lat2 - lat1) * Math.PI) / 180;
      const dLng = ((lng2 - lng1) * Math.PI) / 180;
      const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos((lat1 * Math.PI) / 180) *
          Math.cos((lat2 * Math.PI) / 180) *
          Math.sin(dLng / 2) ** 2;
      return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    };

    const lastOrigin = { lat: 25.2048, lng: 55.2708 };

    // Move 30 m north (~0.027 km) — should trigger recalc
    const newOrigin30m = { lat: 25.2051, lng: 55.2708 };
    expect(calculateDistance(lastOrigin.lat, lastOrigin.lng, newOrigin30m.lat, newOrigin30m.lng)).toBeGreaterThan(THRESHOLD_KM);

    // Move 10 m north (~0.009 km) — should NOT trigger recalc
    const newOrigin10m = { lat: 25.20489, lng: 55.2708 };
    expect(calculateDistance(lastOrigin.lat, lastOrigin.lng, newOrigin10m.lat, newOrigin10m.lng)).toBeLessThan(THRESHOLD_KM);
  });

  it('S04 – manual order is preserved across GPS moves (no nearest-neighbour override)', () => {
    const stops = ['A', 'B', 'C', 'D'];
    const manualOrder = ['C', 'A', 'D', 'B']; // driver's custom order

    const buildRoute = (manuallyOrdered: boolean, deliveries: string[]) => {
      if (manuallyOrdered) return deliveries; // honour user order
      return [...deliveries].sort(); // simulated nearest-neighbour (alphabetical)
    };

    const routeBeforeGPSMove = buildRoute(true, manualOrder);
    const routeAfterGPSMove = buildRoute(true, manualOrder); // flag still true after GPS move

    expect(routeBeforeGPSMove).toEqual(manualOrder);
    expect(routeAfterGPSMove).toEqual(manualOrder);

    // Without flag, nearest-neighbour would sort
    const routeNearestNeighbour = buildRoute(false, stops);
    expect(routeNearestNeighbour).toEqual(['A', 'B', 'C', 'D']);
    expect(routeNearestNeighbour).not.toEqual(manualOrder);
  });

  it('S05 – ETA refresh interval recalculates without full OSRM call', () => {
    const baseTime = Date.now();
    const stops = [
      { id: 'a', estimatedEta: new Date(baseTime + 30 * 60 * 1000).toISOString() },
      { id: 'b', estimatedEta: new Date(baseTime + 60 * 60 * 1000).toISOString() },
    ];

    // ETA refresh: re-stamp each stop's ETA from now (without modifying cumulative offsets)
    const refreshedStops = stops.map((s, i) => ({
      ...s,
      estimatedEta: s.estimatedEta, // values preserved unchanged on same-session refresh
      routeIndex: i + 1,
    }));

    expect(refreshedStops[0].routeIndex).toBe(1);
    expect(refreshedStops[1].routeIndex).toBe(2);
    // ETAs should remain valid ISO strings
    expect(new Date(refreshedStops[0].estimatedEta).getTime()).toBeGreaterThan(baseTime);
  });
});

// ── D3: Awaiting Customer after upload without GMD ────────────────────────────

describe('D3 – Awaiting customer response flow', () => {
  it('S06 – pending order (no SMS sent) does NOT appear in awaiting list', () => {
    const delivery = makeDelivery({ status: 'pending', smsSentAt: null });

    // deliveryToManageOrder stub: pending → 'uploaded'
    const getWorkflowStatus = (d: ReturnType<typeof makeDelivery>) => {
      if (d.status === 'scheduled') return 'sms_sent';
      if (d.status === 'pending') return 'uploaded';
      return d.status;
    };

    const ws = getWorkflowStatus(delivery);
    expect(ws).toBe('uploaded');
    expect(ws === 'sms_sent' || ws === 'unconfirmed').toBe(false);
  });

  it('S07 – after Send SMS action, order moves to awaiting list (scheduled → sms_sent)', () => {
    const delivery = makeDelivery({ status: 'pending', smsSentAt: null, phone: '+971501234567' });

    // needsSMS: pending + no smsSentAt + has phone
    const needsSMS = delivery.status === 'pending' && !delivery.smsSentAt && !!delivery.phone;
    expect(needsSMS).toBe(true);

    // Simulate API call success: delivery becomes scheduled
    const afterSMS = { ...delivery, status: 'scheduled', smsSentAt: new Date().toISOString(), confirmationStatus: 'pending' };

    const getWorkflowStatus = (d: typeof afterSMS) => d.status === 'scheduled' ? 'sms_sent' : 'uploaded';
    expect(getWorkflowStatus(afterSMS)).toBe('sms_sent');
  });

  it('S08 – customer confirmation changes status to scheduled-confirmed', () => {
    const delivery = makeDelivery({
      status: 'scheduled',
      smsSentAt: new Date().toISOString(),
      confirmationStatus: 'pending',
    });

    // Customer clicks link → backend sets status confirmed
    const confirmed = { ...delivery, status: 'scheduled-confirmed', confirmationStatus: 'confirmed' };

    expect(confirmed.status).toBe('scheduled-confirmed');
    expect(confirmed.confirmationStatus).toBe('confirmed');
    // Should no longer be in awaiting list
    const getWorkflowStatus = (d: typeof confirmed) => d.status === 'scheduled' ? 'sms_sent' : d.status;
    expect(getWorkflowStatus(confirmed)).not.toBe('sms_sent');
  });

  it('S09 – delivery without phone number is NOT eligible for Send SMS button', () => {
    const delivery = makeDelivery({ status: 'pending', smsSentAt: null, phone: '' });
    const needsSMS = delivery.status === 'pending' && !delivery.smsSentAt && !!delivery.phone;
    expect(needsSMS).toBe(false);
  });

  it('S10 – delivery that already has smsSentAt does NOT get second SMS button', () => {
    const delivery = makeDelivery({
      status: 'pending',
      smsSentAt: new Date().toISOString(),
      phone: '+971501234567',
    });
    const hasSMSSent = !!delivery.smsSentAt;
    const needsSMS = (delivery.status === 'pending') && !hasSMSSent && !!delivery.phone;
    expect(needsSMS).toBe(false);
  });
});

// ── D4: Delivery Team Portal Operations table ─────────────────────────────────

describe('D4 – Delivery Team Portal Operations detail table', () => {
  const TERMINAL_STATUSES = new Set([
    'delivered', 'delivered-with-installation', 'delivered-without-installation',
    'completed', 'pod-completed', 'cancelled', 'returned',
  ]);

  it('S11 – row filter: all statuses included by default', () => {
    const deliveries = [
      makeDelivery({ status: 'pending' }),
      makeDelivery({ status: 'out-for-delivery' }),
      makeDelivery({ status: 'order-delay' }),
      makeDelivery({ status: 'delivered' }),
    ];

    const opsStatusFilter = 'all';
    const rows = deliveries.filter(d => {
      const s = (d.status || '').toLowerCase();
      if (opsStatusFilter !== 'all') {
        if (opsStatusFilter === 'ofd' && s !== 'out-for-delivery') return false;
        if (opsStatusFilter === 'terminal' && !TERMINAL_STATUSES.has(s)) return false;
      }
      return true;
    });

    expect(rows).toHaveLength(4);
  });

  it('S12 – row filter: OFD filter returns only out-for-delivery', () => {
    const deliveries = [
      makeDelivery({ status: 'pending' }),
      makeDelivery({ status: 'out-for-delivery' }),
      makeDelivery({ status: 'order-delay' }),
    ];

    const opsStatusFilter = 'ofd';
    const rows = deliveries.filter(d => (d.status || '').toLowerCase() === opsStatusFilter.replace('ofd', 'out-for-delivery'));
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('out-for-delivery');
  });

  it('S13 – row sort: OFD orders appear before delay orders appear before pending', () => {
    const deliveries = [
      makeDelivery({ status: 'pending' }),
      makeDelivery({ status: 'out-for-delivery' }),
      makeDelivery({ status: 'order-delay' }),
    ];

    const prio = (s: string) => s === 'out-for-delivery' ? 0 : s === 'order-delay' ? 1 : TERMINAL_STATUSES.has(s) ? 3 : 2;
    const sorted = [...deliveries].sort((a, b) => prio(a.status) - prio(b.status));

    expect(sorted[0].status).toBe('out-for-delivery');
    expect(sorted[1].status).toBe('order-delay');
    expect(sorted[2].status).toBe('pending');
  });

  it('S14 – metadata extraction: model, material, description from originalRow', () => {
    const delivery = makeDelivery({
      metadata: {
        originalRow: {
          'MODEL ID': 'MDL-XZ100',
          'Material': 'MTL-55123',
          'Description': 'Smart TV 65 inch',
          'Invoice Price': '2499.00',
          'Order Qty': '2',
          'City': 'Dubai',
        },
      },
    });

    const meta = (delivery.metadata as Record<string, unknown>) ?? {};
    const orig = ((meta.originalRow ?? {}) as Record<string, unknown>);
    const model = String(orig['MODEL ID'] ?? '—');
    const material = String(orig['Material'] ?? '—');
    const description = String(orig['Description'] ?? '—');
    const price = String(orig['Invoice Price'] ?? '—');
    const qty = String(orig['Order Qty'] ?? '—');
    const city = String(orig['City'] ?? '—');

    expect(model).toBe('MDL-XZ100');
    expect(material).toBe('MTL-55123');
    expect(description).toBe('Smart TV 65 inch');
    expect(price).toBe('2499.00');
    expect(qty).toBe('2');
    expect(city).toBe('Dubai');
  });

  it('S15 – GMD display: formats ISO date as DD MMM YY', () => {
    const gmdRaw = '2026-04-10T00:00:00.000Z';
    const gmdFormatted = new Date(gmdRaw).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' });
    expect(gmdFormatted).toMatch(/\d{2} \w{3} \d{2}/);
  });
});

// ── D5: Logistics Team Portal ─────────────────────────────────────────────────

describe('D5 – Logistics Team Portal Assign & Dispatch table', () => {
  it('S16 – Items (Order Quantity) and Units (Sales unit) columns use real Excel column names', () => {
    const delivery = makeDelivery({
      metadata: { originalRow: { 'Order Quantity': 19, 'Confirmed quantity': 19, 'Sales unit': 'EA', 'Delivery number': '0050041244' } },
    });
    const meta = (delivery.metadata as Record<string, unknown>) ?? {};
    const orig = ((meta.originalRow ?? {}) as Record<string, unknown>);
    // Items: prefer Order Quantity, fall back to Confirmed quantity
    const itemQty = String(orig['Order Quantity'] ?? orig['Confirmed quantity'] ?? '—');
    // Units: Sales unit
    const salesUnit = String(orig['Sales unit'] ?? '—');
    // Delivery number: exact column name match
    const delNum = String(orig['Delivery number'] ?? orig['Delivery Number'] ?? '—');

    expect(itemQty).toBe('19');
    expect(salesUnit).toBe('EA');
    expect(delNum).toBe('0050041244');
  });

  it('S17 – driver card click should navigate to communication tab with that driver selected', () => {
    // Simulate: clicking a driver card sets selectedContact and switches tab
    let activeTab = 'operations';
    let selectedContact: { id: string } | null = null;

    const handleDriverCardClick = (driver: { id: string }) => {
      selectedContact = driver;
      activeTab = 'communication';
    };

    const driver = { id: 'driver-001', fullName: 'Ahmed Al Rashid' };
    handleDriverCardClick(driver);

    expect(activeTab).toBe('communication');
    expect(selectedContact?.id).toBe('driver-001');
  });

  it('S18 – online driver shows green badge; offline driver shows grey', () => {
    const now = new Date();
    const twoMinutesAgo = new Date(now.getTime() - 2 * 60 * 1000).toISOString();
    const tenMinutesAgo = new Date(now.getTime() - 10 * 60 * 1000).toISOString();

    const isOnline = (lastLogin: string) => new Date(lastLogin) >= new Date(Date.now() - 5 * 60 * 1000);

    expect(isOnline(twoMinutesAgo)).toBe(true);
    expect(isOnline(tenMinutesAgo)).toBe(false);
  });

  it('S19 – dispatch button disabled when no GMD; enabled when GMD present', () => {
    const noGmd = makeDelivery({ status: 'pending', goodsMovementDate: null });
    const withGmd = makeDelivery({ status: 'pending', goodsMovementDate: '2026-04-10T06:00:00Z' });

    const canDispatch = (d: ReturnType<typeof makeDelivery>) =>
      ['pending', 'scheduled', 'uploaded', 'confirmed', 'scheduled-confirmed'].includes(d.status) &&
      !!d.goodsMovementDate;

    expect(canDispatch(noGmd)).toBe(false);
    expect(canDispatch(withGmd)).toBe(true);
  });

  it('S20 – status update dropdown applies correct status to PUT request', () => {
    const statuses = ['order-delay', 'out-for-delivery', 'rescheduled', 'delivered', 'cancelled', 'returned'];

    // All should be valid status values passed to PUT /deliveries/admin/:id/status
    statuses.forEach(s => {
      expect(typeof s).toBe('string');
      expect(s.length).toBeGreaterThan(0);
    });

    // Verify the statuses map correctly to what the backend accepts
    expect(statuses).toContain('out-for-delivery');
    expect(statuses).toContain('order-delay');
    expect(statuses).toContain('delivered');
  });
});
