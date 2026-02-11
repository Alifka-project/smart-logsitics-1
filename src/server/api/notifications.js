const express = require('express');
const router = express.Router();
const { authenticate, requireRole } = require('../auth');
const prisma = require('../db/prisma');

const STATUS_LABELS = {
  cancelled: 'Cancelled',
  canceled: 'Cancelled',
  rejected: 'Rejected',
  rescheduled: 'Rescheduled'
};

function normalizeStatus(status) {
  return String(status || '').toLowerCase();
}

router.get('/', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const sinceRaw = req.query.since;
    const limitRaw = req.query.limit;
    const limit = Math.min(parseInt(limitRaw || '20', 10) || 20, 100);

    let since = null;
    if (sinceRaw) {
      const parsed = new Date(sinceRaw);
      if (!Number.isNaN(parsed.getTime())) {
        since = parsed;
      }
    }

    const where = {
      eventType: 'status_updated'
    };

    if (since) {
      where.createdAt = { gt: since };
    }

    const events = await prisma.deliveryEvent.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: {
        delivery: {
          select: {
            id: true,
            customer: true,
            address: true,
            status: true
          }
        }
      }
    });

    const notifications = events
      .map((event) => {
        const payload = event.payload || {};
        const newStatus = normalizeStatus(payload.newStatus || payload.status || event.delivery?.status);
        const label = STATUS_LABELS[newStatus];
        const actorType = String(event.actorType || '').toLowerCase();

        if (!label) return null;
        if (actorType && actorType !== 'customer') return null;

        const customer = event.delivery?.customer || 'Customer';
        const address = event.delivery?.address ? ` - ${event.delivery.address}` : '';

        return {
          id: `delivery-${event.id}`,
          type: 'delivery',
          status: newStatus,
          title: `${label} delivery`,
          message: `${customer}${address}`,
          timestamp: event.createdAt,
          deliveryId: event.delivery?.id || null,
          read: false
        };
      })
      .filter(Boolean);

    const latest = events.length ? events[0].createdAt : null;

    res.json({
      success: true,
      notifications,
      latest
    });
  } catch (error) {
    console.error('Error fetching admin notifications:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
