const express = require('express');
const router = express.Router();
const prisma = require('../db/prisma');

/* ─── POST /api/ai/search ─────────────────────────────────────
   AI-powered global search: queries DB then calls OpenAI for
   a natural-language summary and ranked results.
   ──────────────────────────────────────────────────────────── */
router.post('/search', async (req, res) => {
  const { query } = req.body || {};
  if (!query?.trim()) return res.json({ answer: '', results: [], drivers: [] });

  try {
    const user     = req.user;
    const userRole = user?.role || 'driver';
    const driverId = user?.sub;
    const q        = query.trim();

    const deliveryWhere = {
      OR: [
        { customer:  { contains: q, mode: 'insensitive' } },
        { address:   { contains: q, mode: 'insensitive' } },
        { status:    { contains: q, mode: 'insensitive' } },
        { poNumber:  { contains: q, mode: 'insensitive' } },
        { items:     { contains: q, mode: 'insensitive' } },
      ],
    };

    const deliverySelect = {
      id: true, customer: true, address: true,
      status: true, poNumber: true, createdAt: true, phone: true,
    };

    let deliveries = [];
    let drivers    = [];
    let totalCount = 0;

    if (userRole === 'admin') {
      [deliveries, drivers, totalCount] = await Promise.all([
        prisma.delivery.findMany({
          where: deliveryWhere,
          take: 10,
          orderBy: { createdAt: 'desc' },
          select: deliverySelect,
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
          select: {
            id: true, fullName: true, username: true,
            email: true, active: true, phone: true,
          },
        }),
        prisma.delivery.count({ where: deliveryWhere }),
      ]);
    } else {
      // Driver / Delivery Team: only their assigned deliveries
      const assignedWhere = {
        assignments: { some: { driverId } },
        ...deliveryWhere,
      };
      [deliveries, totalCount] = await Promise.all([
        prisma.delivery.findMany({
          where: assignedWhere,
          take: 10,
          orderBy: { createdAt: 'desc' },
          select: deliverySelect,
        }),
        prisma.delivery.count({ where: assignedWhere }),
      ]);
    }

    // Build a compact context snapshot for the AI
    const ctx = {
      role: userRole,
      query: q,
      totalMatchingDeliveries: totalCount,
      deliveries: deliveries.slice(0, 5).map(d => ({
        customer: d.customer,
        address:  d.address,
        status:   d.status,
        po:       d.poNumber,
      })),
      drivers: drivers.slice(0, 3).map(d => ({
        name:   d.fullName || d.username,
        email:  d.email,
        active: d.active,
      })),
    };

    // Default answer (used if OpenAI call fails or key missing)
    let answer =
      totalCount > 0
        ? `Found ${totalCount} deliver${totalCount !== 1 ? 'ies' : 'y'}${drivers.length ? ` and ${drivers.length} driver${drivers.length !== 1 ? 's' : ''}` : ''} matching "${q}".`
        : `No records found matching "${q}".`;

    const openaiKey = process.env.OPENAI_API_KEY;
    if (openaiKey) {
      try {
        const aiRes = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${openaiKey}`,
          },
          body: JSON.stringify({
            model: 'gpt-4o-mini',
            messages: [
              {
                role: 'system',
                content:
                  'You are an AI assistant for a Dubai logistics management system called Electrolux Logistics. ' +
                  'Answer queries about deliveries, drivers and operations in 1-2 concise sentences. ' +
                  'Be direct and helpful. Include key numbers if relevant. ' +
                  'Mention actionable next steps when appropriate.',
              },
              {
                role: 'user',
                content: `Search query: "${q}"\n\nContext: ${JSON.stringify(ctx)}\n\nProvide a brief, helpful summary.`,
              },
            ],
            max_tokens: 140,
            temperature: 0.3,
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

    res.json({ answer, results: deliveries, drivers, totalCount });
  } catch (err) {
    console.error('[AI Search] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/* ─── GET /api/ai/navbar-stats ────────────────────────────────
   Returns live delivery/driver counts for the top navbar chips.
   Lightweight — intentionally no heavy joins.
   ──────────────────────────────────────────────────────────── */
router.get('/navbar-stats', async (req, res) => {
  try {
    const user     = req.user;
    const userRole = user?.role || 'driver';
    const driverId = user?.sub;

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    if (userRole === 'admin') {
      const [total, pending, inTransit, deliveredToday, activeDrivers] = await Promise.all([
        prisma.delivery.count(),
        prisma.delivery.count({ where: { status: 'pending' } }),
        prisma.delivery.count({ where: { status: 'out-for-delivery' } }),
        prisma.delivery.count({
          where: { status: 'delivered', deliveredAt: { gte: today } },
        }),
        prisma.driver.count({ where: { active: true } }),
      ]);
      return res.json({ role: 'admin', total, pending, inTransit, deliveredToday, activeDrivers });
    }

    if (userRole === 'driver' || userRole === 'delivery_team') {
      const [assigned, deliveredToday] = await Promise.all([
        prisma.deliveryAssignment.count({
          where: {
            driverId,
            delivery: { status: { notIn: ['delivered', 'cancelled'] } },
          },
        }),
        prisma.deliveryAssignment.count({
          where: {
            driverId,
            delivery: { status: 'delivered', deliveredAt: { gte: today } },
          },
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

/* ─── POST /api/ai/optimize (stub) ──────────────────────────── */
router.post('/optimize', async (_req, res) => {
  res.status(501).json({ error: 'not_implemented' });
});

module.exports = router;
