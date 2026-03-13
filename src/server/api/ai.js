const express = require('express');
const router  = express.Router();
const prisma  = require('../db/prisma');

/* ─── Navigation map ─────────────────────────────────────────
   Each entry describes a page/feature, the URL to reach it,
   synonyms a user might type, and which roles can see it.
   ──────────────────────────────────────────────────────────── */
const NAVIGATION_MAP = [
  {
    label:       'Dashboard',
    path:        '/admin',
    description: 'Main overview — KPIs, delivery charts and today\'s live stats',
    icon:        'LayoutDashboard',
    keywords:    ['dashboard', 'home', 'overview', 'summary', 'kpi', 'main page', 'start'],
    roles:       ['admin'],
  },
  {
    label:       'Deliveries',
    path:        '/deliveries',
    description: 'Full delivery list — upload files, search, filter and manage orders',
    icon:        'Package',
    keywords:    [
      'deliveries', 'delivery list', 'orders', 'upload', 'shipment',
      'manage deliveries', 'delivery management', 'all deliveries',
      'check delivery status', 'see status', 'view status', 'order status',
    ],
    roles:       ['admin', 'driver', 'delivery_team'],
  },
  {
    label:       'Driver Monitoring',
    path:        '/admin/operations?tab=monitoring',
    description: 'Live map showing real-time GPS locations of all active drivers',
    icon:        'MapPin',
    keywords:    ['monitoring', 'tracking', 'live map', 'gps', 'driver location', 'truck', 'vehicle', 'real-time', 'live tracking', 'where is driver', 'driver tracking', 'track driver', 'truck monitoring', 'fleet'],
    roles:       ['admin'],
  },
  {
    label:       'Delivery Control',
    path:        '/admin/operations?tab=control',
    description: 'Assign drivers to deliveries, update statuses and dispatch orders',
    icon:        'Layers',
    keywords:    ['control', 'assign', 'assignment', 'dispatch', 'manage driver', 'delivery control', 'allocate', 'route'],
    roles:       ['admin'],
  },
  {
    label:       'Delivery Tracking',
    path:        '/admin/operations?tab=delivery-tracking',
    description: 'Track individual deliveries on an interactive map',
    icon:        'Map',
    keywords:    [
      'delivery tracking', 'track delivery', 'track order',
      'delivery map', 'delivery location', 'where is my order',
      'order tracking', 'check delivery status', 'how to check delivery status',
    ],
    roles:       ['admin'],
  },
  {
    label:       'Communication',
    path:        '/admin/operations?tab=communication',
    description: 'Chat and messaging with drivers and the delivery team',
    icon:        'MessageSquare',
    keywords:    ['communication', 'chat', 'message', 'messaging', 'talk', 'contact driver', 'inbox', 'send message'],
    roles:       ['admin', 'delivery_team'],
  },
  {
    label:       'Alerts',
    path:        '/admin/operations?tab=alerts',
    description: 'System alerts — overdue deliveries, unconfirmed SMS, and warnings',
    icon:        'AlertTriangle',
    keywords:    ['alerts', 'alert', 'notifications', 'overdue', 'warning', 'issue', 'problem', 'unconfirmed', 'sms alert'],
    roles:       ['admin'],
  },
  {
    label:       'Reports',
    path:        '/admin/reports',
    description: 'Analytics reports — delivery performance, driver stats, area coverage',
    icon:        'BarChart2',
    keywords:    ['reports', 'report', 'performance', 'analytics', 'statistics', 'charts', 'insights', 'data'],
    roles:       ['admin'],
  },
  {
    label:       'POD Report',
    path:        '/admin/reports/pod',
    description: 'Proof of Delivery reports — signatures, photos and delivery evidence',
    icon:        'BarChart2',
    keywords:    ['pod', 'proof of delivery', 'evidence', 'signature', 'photo proof', 'delivery proof', 'pod report'],
    roles:       ['admin'],
  },
  {
    label:       'Users & Drivers',
    path:        '/admin/users',
    description: 'Manage users — add or edit drivers, delivery team members and admins',
    icon:        'Users',
    keywords:    ['users', 'user management', 'add driver', 'create driver', 'drivers', 'team', 'staff', 'employee', 'accounts', 'add user', 'manage user'],
    roles:       ['admin'],
  },
  {
    label:       'Operations Centre',
    path:        '/admin/operations',
    description: 'Operations hub — monitoring, control, tracking, communication and alerts',
    icon:        'Layers',
    keywords:    ['operations', 'operations centre', 'operations center', 'ops'],
    roles:       ['admin'],
  },
];

/* Score a navigation entry against a query */
function findNavSuggestions(query, userRole) {
  const q = query.toLowerCase();
  return NAVIGATION_MAP
    .filter(n => n.roles.includes(userRole))
    .map(n => {
      let score = 0;
      for (const kw of n.keywords) {
        if (q.includes(kw)) score += kw.split(' ').length * 10; // multi-word matches score higher
      }
      // Also partial word matches (single word keywords)
      if (score === 0) {
        for (const kw of n.keywords) {
          const parts = kw.split(' ');
          for (const p of parts) {
            if (p.length > 3 && q.includes(p)) score += 3;
          }
        }
      }
      return { ...n, score };
    })
    .filter(n => n.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map(({ score: _s, keywords: _k, roles: _r, ...rest }) => rest); // strip scoring internals
}

/* Infer high-level delivery status intent from a natural language query.
   Used so questions like "how many order cancel" or "show pending orders"
   return a filtered table of deliveries for that status. */
function inferStatusFromQuery(query) {
  const q = query.toLowerCase();

  // Cancelled
  if (q.includes('cancelled') || q.includes('canceled') || q.includes('cancel ')) {
    return 'cancelled';
  }

  // Pending
  if (q.includes('pending') || q.includes('not delivered yet') || q.includes('waiting')) {
    return 'pending';
  }

  // In transit / out for delivery
  if (
    q.includes('in transit') ||
    q.includes('on the way') ||
    q.includes('out for delivery') ||
    q.includes('out for deliver')
  ) {
    return 'out-for-delivery';
  }

  // Delivered / completed
  if (
    q.includes('delivered') ||
    q.includes('completed delivery') ||
    q.includes('finished delivery')
  ) {
    return 'delivered';
  }

  return null;
}

/* Infer a createdAt date range from a natural language query.
   We keep this conservative and only handle clear phrases like
   "today", "yesterday", "last 7 days", "last week", "this month",
   "last month", "last 30 days". */
function inferDateRangeFromQuery(query) {
  const q = query.toLowerCase();
  const now = new Date();

  const startOfDay = (d) => {
    const x = new Date(d);
    x.setHours(0, 0, 0, 0);
    return x;
  };
  const endOfDayExclusive = (d) => {
    const x = new Date(d);
    x.setHours(24, 0, 0, 0);
    return x;
  };

  // Today
  if (q.includes(' today')) {
    const from = startOfDay(now);
    const to   = endOfDayExclusive(now);
    return { from, to, label: 'today' };
  }

  // Yesterday
  if (q.includes(' yesterday')) {
    const y    = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const from = startOfDay(y);
    const to   = endOfDayExclusive(y);
    return { from, to, label: 'yesterday' };
  }

  // Last 7 days / last week
  if (q.includes('last 7 days') || q.includes('last seven days') || q.includes('last week')) {
    const to   = endOfDayExclusive(now);
    const from = new Date(to.getTime() - 7 * 24 * 60 * 60 * 1000);
    from.setHours(0, 0, 0, 0);
    return { from, to, label: 'last 7 days' };
  }

  // Last 30 days
  if (q.includes('last 30 days') || q.includes('last thirty days')) {
    const to   = endOfDayExclusive(now);
    const from = new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);
    from.setHours(0, 0, 0, 0);
    return { from, to, label: 'last 30 days' };
  }

  // This month
  if (q.includes('this month') || q.includes('current month')) {
    const from = new Date(now.getFullYear(), now.getMonth(), 1);
    const to   = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    return { from, to, label: 'this month' };
  }

  // Last month
  if (q.includes('last month') || q.includes('previous month')) {
    const from = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const to   = new Date(now.getFullYear(), now.getMonth(), 1);
    return { from, to, label: 'last month' };
  }

  return null;
}

/* ─── POST /api/ai/search ────────────────────────────────────── */
router.post('/search', async (req, res) => {
  const { query } = req.body || {};
  if (!query?.trim()) return res.json({ answer: '', results: [], drivers: [], navSuggestions: [] });

  try {
    const user      = req.user;
    const userRole  = user?.role || 'driver';
    const driverId  = user?.sub;
    const q         = query.trim();
    const statusInt = inferStatusFromQuery(q);
    const dateRange = inferDateRangeFromQuery(q);

    /* Navigation suggestions (deterministic keyword match) */
    const navSuggestions = findNavSuggestions(q, userRole);

    const baseDateFilter = dateRange
      ? { createdAt: { gte: dateRange.from, lt: dateRange.to } }
      : {};

    const deliveryWhere = statusInt
      // Status-intent queries: list all deliveries for that status
      ? { status: statusInt, ...baseDateFilter }
      // Generic text search
      : {
          OR: [
            { customer: { contains: q, mode: 'insensitive' } },
            { address:  { contains: q, mode: 'insensitive' } },
            { status:   { contains: q, mode: 'insensitive' } },
            { poNumber: { contains: q, mode: 'insensitive' } },
            { items:    { contains: q, mode: 'insensitive' } },
          ],
          ...baseDateFilter,
        };

    const deliverySelect = {
      id: true, customer: true, address: true,
      status: true, poNumber: true, createdAt: true, phone: true,
    };

    let deliveries = [];
    let drivers    = [];
    let totalCount = 0;

    /* Aggregate stats — always fetched for analytical queries */
    const statsP = userRole === 'admin'
      ? Promise.all([
          prisma.delivery.count({ where: baseDateFilter }),
          prisma.delivery.count({ where: { status: 'pending',          ...baseDateFilter } }),
          prisma.delivery.count({ where: { status: 'out-for-delivery', ...baseDateFilter } }),
          prisma.delivery.count({ where: { status: 'delivered',        ...baseDateFilter } }),
          prisma.delivery.count({ where: { status: 'cancelled',        ...baseDateFilter } }),
          prisma.driver.count({ where: { active: true } }),
          prisma.driver.count(),
        ])
      : Promise.all([
          prisma.deliveryAssignment.count({
            where: { driverId, ...(dateRange ? { delivery: baseDateFilter } : {}) },
          }),
          prisma.deliveryAssignment.count({
            where: {
              driverId,
              delivery: { status: 'pending', ...(dateRange ? baseDateFilter : {}) },
            },
          }),
          prisma.deliveryAssignment.count({
            where: {
              driverId,
              delivery: { status: 'out-for-delivery', ...(dateRange ? baseDateFilter : {}) },
            },
          }),
          prisma.deliveryAssignment.count({
            where: {
              driverId,
              delivery: { status: 'delivered', ...(dateRange ? baseDateFilter : {}) },
            },
          }),
          Promise.resolve(0), Promise.resolve(0), Promise.resolve(0),
        ]);

    /* Text-match records */
    if (userRole === 'admin') {
      [deliveries, drivers, totalCount] = await Promise.all([
        prisma.delivery.findMany({
          where: deliveryWhere, take: 10,
          orderBy: { createdAt: 'desc' }, select: deliverySelect,
        }),
        prisma.driver.findMany({
          where: {
            OR: [
              { fullName: { contains: q, mode: 'insensitive' } },
              { username: { contains: q, mode: 'insensitive' } },
              { email:    { contains: q, mode: 'insensitive' } },
              { phone:    { contains: q, mode: 'insensitive' } },
            ],
          },
          take: 5,
          select: { id: true, fullName: true, username: true, email: true, active: true, phone: true },
        }),
        prisma.delivery.count({ where: deliveryWhere }),
      ]);
    } else {
      const assignedWhere = { assignments: { some: { driverId } }, ...deliveryWhere };
      [deliveries, totalCount] = await Promise.all([
        prisma.delivery.findMany({
          where: assignedWhere, take: 10,
          orderBy: { createdAt: 'desc' }, select: deliverySelect,
        }),
        prisma.delivery.count({ where: assignedWhere }),
      ]);
    }

    const [stTotal, stPending, stInTransit, stDelivered, stCancelled, stActiveDrivers, stTotalDrivers] = await statsP;

    const liveStats = userRole === 'admin'
      ? { totalDeliveries: stTotal, pending: stPending, inTransit: stInTransit, delivered: stDelivered, cancelled: stCancelled, activeDrivers: stActiveDrivers, totalDrivers: stTotalDrivers }
      : { myTotal: stTotal, myPending: stPending, myInTransit: stInTransit, myDelivered: stDelivered };

    /* OpenAI context */
    const ctx = {
      role: userRole,
      query: q,
      liveStats,
      dateRange: dateRange ? dateRange.label : null,
      textMatchCount: totalCount,
      matchingDeliveries: deliveries.slice(0, 5).map(d => ({ customer: d.customer, address: d.address, status: d.status, po: d.poNumber })),
      matchingDrivers: drivers.slice(0, 3).map(d => ({ name: d.fullName || d.username, email: d.email, active: d.active })),
      navigationSuggested: navSuggestions.map(n => ({ label: n.label, path: n.path })),
    };

    /* Fallback answer if OpenAI unavailable
       Priority:
       1) If there are text-matched deliveries/drivers → describe those.
       2) Else if there are live stats → answer analytically from stats
          (respecting dateRange if present).
       3) Else if there are navigation suggestions → mention pages.
       4) Else → generic "no data" message.
    */
    let answer;
    if (totalCount > 0 || drivers.length > 0) {
      answer =
        `Found ${totalCount} deliver${totalCount !== 1 ? 'ies' : 'y'}`
        + (drivers.length ? ` and ${drivers.length} driver${drivers.length !== 1 ? 's' : ''}` : '')
        + ` matching "${q}".`;
    } else if (userRole === 'admin') {
      const guide = navSuggestions[0]
        ? ` To investigate statuses in detail, open “${navSuggestions[0].label}” from the top navigation.`
        : '';
      const period = dateRange ? `For ${dateRange.label}, ` : 'There are currently ';
      answer =
        `${period}${stPending} pending, ${stInTransit} in transit, `
        + `${stDelivered} delivered and ${stCancelled} cancelled orders `
        + `(${stTotal} total, ${stActiveDrivers} active drivers).`
        + guide;
    } else if (userRole !== 'admin') {
      const period = dateRange ? `For ${dateRange.label}, ` : 'You have ';
      answer =
        `${period}${liveStats.myPending} pending, ${liveStats.myInTransit} in transit `
        + `and ${liveStats.myDelivered} delivered deliveries assigned to you `
        + `(${liveStats.myTotal} total).`;
    } else if (navSuggestions.length > 0) {
      answer =
        `I found ${navSuggestions.length} page${navSuggestions.length > 1 ? 's' : ''} `
        + `that match your query. Open the most relevant page to investigate further.`;
    } else {
      answer = `No matching records found for "${q}".`;
    }

    const openaiKey = process.env.OPENAI_API_KEY;
    if (openaiKey) {
      try {
        const aiRes = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${openaiKey}` },
          body: JSON.stringify({
            model: 'gpt-4o-mini',
            messages: [
              {
                role: 'system',
                content:
                  'You are an AI assistant for Electrolux Logistics — a Dubai-based delivery management system.\n' +
                  'You have access to: (1) live system stats in liveStats, (2) text-matched records in matchingDeliveries/matchingDrivers, (3) navigation suggestions in navigationSuggested.\n' +
                  'Rules:\n' +
                  '• For counting/analytical questions ("how many pending", "total deliveries") → use liveStats numbers.\n' +
                  '• For record lookups ("find customer X", "delivery to Marina") → use matchingDeliveries.\n' +
                  '• For navigation questions ("where is tracking", "how to see reports", "how to check delivery status") → explicitly mention the best page name and path using navigationSuggested.\n' +
                  '• When dateRange is present, make clear which period you are talking about (e.g. "For the last 7 days").\n' +
                  '• Always answer in 1-2 concise sentences. Include exact numbers when available. Be direct and actionable, e.g. "For the last 7 days there are 79 pending deliveries. To see details, open Operations → Delivery Tracking."',
              },
              {
                role: 'user',
                content: `Query: "${q}"\n\nData: ${JSON.stringify(ctx)}\n\nAnswer concisely using the most relevant data above.`,
              },
            ],
            max_tokens: 150,
            temperature: 0.25,
          }),
        });
        const aiData = await aiRes.json();
        if (aiData.choices?.[0]?.message?.content) {
          answer = aiData.choices[0].message.content.trim();
        }
      } catch (aiErr) {
        console.error('[AI Search] OpenAI error:', aiErr.message);
      }
    }

    res.json({ answer, results: deliveries, drivers, totalCount, navSuggestions });
  } catch (err) {
    console.error('[AI Search] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/* ─── GET /api/ai/navbar-stats ──────────────────────────────── */
router.get('/navbar-stats', async (req, res) => {
  try {
    const user     = req.user;
    const userRole = user?.role || 'driver';
    const driverId = user?.sub;
    const today    = new Date();
    today.setHours(0, 0, 0, 0);

    if (userRole === 'admin') {
      const [total, pending, inTransit, deliveredToday, activeDrivers] = await Promise.all([
        prisma.delivery.count(),
        prisma.delivery.count({ where: { status: 'pending' } }),
        prisma.delivery.count({ where: { status: 'out-for-delivery' } }),
        prisma.delivery.count({ where: { status: 'delivered', deliveredAt: { gte: today } } }),
        prisma.driver.count({ where: { active: true } }),
      ]);
      return res.json({ role: 'admin', total, pending, inTransit, deliveredToday, activeDrivers });
    }

    if (userRole === 'driver' || userRole === 'delivery_team') {
      const [assigned, deliveredToday] = await Promise.all([
        prisma.deliveryAssignment.count({
          where: { driverId, delivery: { status: { notIn: ['delivered', 'cancelled'] } } },
        }),
        prisma.deliveryAssignment.count({
          where: { driverId, delivery: { status: 'delivered', deliveredAt: { gte: today } } },
        }),
      ]);
      return res.json({ role: userRole, assigned, deliveredToday });
    }

    res.json({});
  } catch (err) {
    console.error('[Navbar Stats] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/* ─── POST /api/ai/optimize (stub) ─────────────────────────── */
router.post('/optimize', async (_req, res) => {
  res.status(501).json({ error: 'not_implemented' });
});

module.exports = router;
