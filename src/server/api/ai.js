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
      'map', 'maps', 'live map', 'driver map', 'tracking map',
      'see map', 'see maps', 'view map', 'view maps',
      'how to see map', 'how to see maps',
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

  // Generic: "last 20 days", "in the last 21 days", etc.
  const lastDaysMatch = q.match(/(?:in the\s+)?last\s+(\d+)\s+day/);
  if (lastDaysMatch) {
    const n = parseInt(lastDaysMatch[1], 10);
    if (Number.isFinite(n) && n > 0 && n <= 365) {
      const to   = endOfDayExclusive(now);
      const from = new Date(to.getTime() - n * 24 * 60 * 60 * 1000);
      from.setHours(0, 0, 0, 0);
      return { from, to, label: `last ${n} days` };
    }
  }

  // Generic: "last 6 hours" etc. (used mainly for driver/delivery-team views)
  const lastHoursMatch = q.match(/(?:in the\s+)?last\s+(\d+)\s+hour/);
  if (lastHoursMatch) {
    const n = parseInt(lastHoursMatch[1], 10);
    if (Number.isFinite(n) && n > 0 && n <= 240) {
      const to   = now;
      const from = new Date(to.getTime() - n * 60 * 60 * 1000);
      return { from, to, label: `last ${n} hours` };
    }
  }

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

  // Last 7 days / last week (explicit phrase)
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

/* Detect insight/analytics queries (e.g. "top customer", "who has the most orders")
   so we can run aggregates and return data in the AI answer instead of "no records". */
function isInsightQuery(query) {
  const q = query.toLowerCase();
  const patterns = [
    /\b(top|best|leading|biggest)\s+(customer|customers|clients?)\b/,
    /\b(customer|customers|client)\s+(with\s+)?(most|highest|top)\s+(orders?|deliveries?)\b/,
    /\bwho\s+(is|are)\s+(the\s+)?(top|best|leading)\s+(customer|customers)\b/,
    /\bmost\s+(orders?|deliveries?)\s+by\s+(customer|client)\b/,
    /\b(customer|client)\s+ranking\b/,
    /\b(top|best)\s+\d*\s*(customer|customers)\b/,
  ];
  return patterns.some(r => r.test(q));
}

/* Detect product/sales analytics queries (e.g. "most selling product", "best selling this month")
   so we can aggregate by product (items) and return chart data. */
function isProductInsightQuery(query) {
  const q = query.toLowerCase();
  const patterns = [
    /\b(most|best|top)\s+(selling\s+)?(product|products|item|items)\b/,
    /\b(what|which)\s+(is|are)\s+(the\s+)?(most|best|top)\s+(selling\s+)?(product|products)\b/,
    /\b(product|item)s?\s+(selling|sold)\s+(this\s+month|last\s+month|this\s+week)/,
    /\b(product|item)\s+ranking\b/,
    /\b(top|best)\s+\d*\s*(product|item)s?\b/,
    /\bsales\s+by\s+(product|item)\b/,
    /\bmost\s+sold\s+(product|item)s?\b/,
  ];
  return patterns.some(r => r.test(q));
}

/* Normalize delivery.items (string or JSON) into product name(s) for aggregation.
   Handles: "Electronics x 30", "Widgets", "Auto Parts - Model X", JSON array with description. */
function parseProductNames(itemsField) {
  const names = [];
  if (itemsField == null || String(itemsField).trim() === '') return names;
  const raw = typeof itemsField === 'string' ? itemsField : JSON.stringify(itemsField);
  let parts = [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      parsed.forEach(p => {
        const d = p && (p.description || p.name || p.item || p.Description || p.Name);
        if (d) names.push(String(d).replace(/\s*x\s*\d+\s*$/i, '').trim());
      });
      return names.filter(Boolean);
    }
  } catch (_) { /* not JSON */ }
  parts = raw.split(/[,;\n]|\s+-\s+/).map(s => String(s).replace(/\s*x\s*\d+\s*$/i, '').trim()).filter(Boolean);
  if (parts.length) return parts;
  const single = raw.replace(/\s*x\s*\d+\s*$/i, '').trim();
  if (single) return [single];
  return names;
}

/* ─── POST /api/ai/search ────────────────────────────────────── */
router.post('/search', async (req, res) => {
  const { query } = req.body || {};
  if (!query?.trim()) return res.json({ answer: '', results: [], drivers: [], navSuggestions: [], insightOnly: false, insight: null });

  try {
    const user      = req.user;
    const userRole  = user?.role || 'driver';
    const driverId  = user?.sub;
    const q         = query.trim();
    const statusInt = inferStatusFromQuery(q);
    let dateRange   = inferDateRangeFromQuery(q);
    const productIntent = isProductInsightQuery(q);
    const insightIntent = isInsightQuery(q) || productIntent;
    /* Product insights default to "this month" when no date in query */
    if (productIntent && !dateRange) {
      const now = new Date();
      dateRange = {
        from: new Date(now.getFullYear(), now.getMonth(), 1),
        to:   new Date(now.getFullYear(), now.getMonth() + 1, 1),
        label: 'this month',
      };
    }

    /* Navigation suggestions (deterministic keyword match) */
    const navSuggestions = findNavSuggestions(q, userRole);

    const baseDateFilter = dateRange
      ? { createdAt: { gte: dateRange.from, lt: dateRange.to } }
      : {};

    /* For insight queries we don't require text match on deliveries; we'll use aggregates. */
    const deliveryWhere = statusInt
      // Status-intent queries: list all deliveries for that status
      ? { status: statusInt, ...baseDateFilter }
      : insightIntent
        // Insight query: fetch all (with optional date filter) for aggregation; record list can stay empty
        ? baseDateFilter
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

    /* Top customers aggregate — for insight queries (admin only) */
    let topCustomers = [];
    if (userRole === 'admin' && insightIntent) {
      const grouped = await prisma.delivery.groupBy({
        by: ['customer'],
        _count: { id: true },
        where: { customer: { not: null }, ...baseDateFilter },
      });
      topCustomers = grouped
        .map(g => ({ customer: g.customer || 'Unknown', count: g._count.id }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 10);
    }

    /* Top products aggregate — for product/sales insight (admin only) */
    let topProducts = [];
    let insightChartData = null;
    if (userRole === 'admin' && productIntent) {
      const withItems = await prisma.delivery.findMany({
        where: { items: { not: null }, ...baseDateFilter },
        select: { items: true, metadata: true },
      });
      const productCount = {};
      withItems.forEach(d => {
        const meta = d.metadata || {};
        const orig = meta.originalRow || meta._originalRow || {};
        const fromMeta = String(orig.Description || orig.description || '').trim();
        const names = fromMeta ? [fromMeta] : parseProductNames(d.items);
        names.forEach(name => {
          const key = (name || 'Unspecified').trim();
          if (!key) return;
          productCount[key] = (productCount[key] || 0) + 1;
        });
      });
      topProducts = Object.entries(productCount)
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 10);
      if (topProducts.length > 0) {
        insightChartData = {
          type: 'top_products',
          chartData: topProducts.map(p => ({ name: p.name, count: p.count })),
          period: dateRange ? dateRange.label : 'this month',
        };
      }
    } else if (userRole === 'admin' && insightIntent && topCustomers.length > 0) {
      insightChartData = {
        type: 'top_customers',
        chartData: topCustomers.map(c => ({ name: c.customer, count: c.count })),
        period: dateRange ? dateRange.label : null,
      };
    }

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
      topCustomers: topCustomers.length ? topCustomers : undefined,
      topProducts: topProducts.length ? topProducts : undefined,
    };

    /* Fallback answer if OpenAI unavailable
       Priority:
       1) Insight query with topCustomers → answer from aggregate data.
       2) If there are text-matched deliveries/drivers → describe those.
       3) Else if there are live stats → answer analytically from stats
          (respecting dateRange if present).
       4) Else if there are navigation suggestions → mention pages.
       5) Else → generic "no data" message.
    */
    let answer;
    let insightOnly = false;
    if (insightIntent && topCustomers.length > 0 && !productIntent) {
      const period = dateRange ? `For ${dateRange.label}, ` : '';
      const first = topCustomers[0];
      if (topCustomers.length === 1) {
        answer = `${period}The top customer is ${first.customer} with ${first.count} delivery${first.count !== 1 ? 'ies' : ''}.`;
      } else {
        const rest = topCustomers.slice(1, 5).map((t, i) => `${i + 2}. ${t.customer} (${t.count})`).join('; ');
        answer = `${period}The top customer is ${first.customer} with ${first.count} deliveries. Next: ${rest}.`;
      }
      insightOnly = true;
    } else if (productIntent && topProducts.length > 0) {
      const period = dateRange ? `For ${dateRange.label}, ` : '';
      const first = topProducts[0];
      answer = `${period}The most delivered product is "${first.name}" with ${first.count} delivery${first.count !== 1 ? 'ies' : ''}. See the chart below for the full breakdown.`;
      insightOnly = true;
    } else if (totalCount > 0 || drivers.length > 0) {
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
                  'You have access to: (1) live system stats in liveStats, (2) text-matched records in matchingDeliveries/matchingDrivers, (3) navigation suggestions in navigationSuggested, (4) topCustomers for top/best customer questions, (5) topProducts for most selling product / best selling items (name and count per product).\n' +
                  'Rules:\n' +
                  '• For "top customer", "best customer", "who has the most orders/deliveries", "top customers" → use topCustomers. Name the top customer and their delivery count; include date range if present.\n' +
                  '• For "most selling product", "best selling this month", "top products", "what is the most product selling" → use topProducts. Name the top product and its delivery count; mention the period (dateRange). Keep the answer short; the user will also see a chart.\n' +
                  '• For counting/analytical questions ("how many pending", "total deliveries") → use liveStats numbers.\n' +
                  '• For record lookups ("find customer X", "delivery to Marina") → use matchingDeliveries.\n' +
                  '• For navigation questions ("where is tracking", "how to see reports", "how to check delivery status", "how to see maps") → explicitly mention the best page name and path using navigationSuggested.\n' +
                  '  If the query starts with "how", "where" or "show me" and navigationSuggested is not empty, focus on navigation instructions and only mention counts when the user clearly asks "how many".\n' +
                  '• When dateRange is present, make clear which period you are talking about (e.g. "For the last 7 days").\n' +
                  '• Always answer in 1-2 concise sentences. Include exact numbers when available. Be direct and actionable, e.g. "The top customer is ABC Corp with 45 deliveries." or "For the last 7 days there are 79 pending deliveries. To see details, open Operations → Delivery Tracking."',
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
          if (insightIntent && (topCustomers.length > 0 || topProducts.length > 0)) insightOnly = true;
        }
      } catch (aiErr) {
        console.error('[AI Search] OpenAI error:', aiErr.message);
      }
    }

    res.json({ answer, results: deliveries, drivers, totalCount, navSuggestions, insightOnly, insight: insightChartData });
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
