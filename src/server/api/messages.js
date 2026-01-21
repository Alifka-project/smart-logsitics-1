/**
 * Messages API - Real-time chat between admin and drivers
 */

const express = require('express');
const router = express.Router();
const { authenticate, requireRole } = require('../auth');
const prisma = require('../db/prisma');

/**
 * GET /api/admin/messages/conversations/:driverId
 * Fetch message history with a specific driver
 */
router.get('/conversations/:driverId', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const { driverId } = req.params;
    const adminId = req.user?.sub;
    const limit = Math.min(parseInt(req.query.limit) || 50, 500);
    const offset = parseInt(req.query.offset) || 0;

    if (!adminId) {
      return res.status(401).json({ error: 'Unauthorized - Admin ID required' });
    }

    // Fetch messages between admin and this driver
    const messages = await prisma.message.findMany({
      where: {
        OR: [
          { adminId, driverId },
          { adminId: driverId, driverId: adminId }
        ]
      },
      include: {
        admin: { select: { id: true, fullName: true, username: true } },
        driver: { select: { id: true, fullName: true, username: true } }
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset
    });

    // Mark messages as read for the admin
    await prisma.message.updateMany({
      where: {
        driverId,
        adminId,
        isRead: false
      },
      data: { isRead: true }
    });

    res.json({
      messages: messages.reverse(),
      total: await prisma.message.count({
        where: {
          OR: [
            { adminId, driverId },
            { adminId: driverId, driverId: adminId }
          ]
        }
      })
    });
  } catch (error) {
    console.error('Error fetching messages:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/admin/messages/unread
 * Get count of unread messages per driver
 */
router.get('/unread', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const adminId = req.user?.sub;

    if (!adminId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const unreadCounts = await prisma.message.groupBy({
      by: ['driverId'],
      where: {
        adminId,
        isRead: false
      },
      _count: true
    });

    const result = {};
    unreadCounts.forEach(item => {
      result[item.driverId] = item._count;
    });

    res.json(result);
  } catch (error) {
    console.error('Error fetching unread counts:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/admin/messages/send - Send message to driver
 */
router.post('/send', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const { driverId, content } = req.body;
    const adminId = req.user?.sub;

    if (!adminId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    if (!driverId || !content || !content.trim()) {
      return res.status(400).json({ error: 'Missing required fields: driverId, content' });
    }

    // Verify driver exists
    const driver = await prisma.driver.findUnique({
      where: { id: driverId }
    });

    if (!driver) {
      return res.status(404).json({ error: 'driver_not_found' });
    }

    // Create message
    const message = await prisma.message.create({
      data: {
        adminId,
        driverId,
        content: content.trim(),
        isRead: false
      },
      include: {
        admin: { select: { id: true, fullName: true, username: true } },
        driver: { select: { id: true, fullName: true, username: true } }
      }
    });

    res.json({ 
      success: true, 
      message 
    });
  } catch (err) {
    console.error('POST /api/admin/messages/send', err);
    res.status(500).json({ error: 'db_error', detail: err.message });
  }
});

/**
 * DELETE /api/admin/messages/conversation/:driverId
 * Clear message history with a driver
 */
router.delete('/conversation/:driverId', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const { driverId } = req.params;
    const adminId = req.user?.sub;

    if (!adminId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const result = await prisma.message.deleteMany({
      where: {
        OR: [
          { adminId, driverId },
          { adminId: driverId, driverId: adminId }
        ]
      }
    });

    res.json({ success: true, deletedCount: result.count });
  } catch (error) {
    console.error('Error deleting messages:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/driver/messages/send
 * Driver sending message to admin
 */
router.post('/driver/send', authenticate, requireRole('driver'), async (req, res) => {
  try {
    const { content } = req.body;
    const driverId = req.user?.sub;

    if (!driverId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    if (!content || !content.trim()) {
      return res.status(400).json({ error: 'Message content is required' });
    }

    // Get the admin user (first admin account)
    const adminAccount = await prisma.account.findFirst({
      where: {
        role: 'admin'
      },
      include: {
        driver: true
      }
    });

    if (!adminAccount || !adminAccount.driver) {
      return res.status(404).json({ error: 'No admin found' });
    }

    const adminId = adminAccount.driver.id;

    // Create message from driver to admin
    const message = await prisma.message.create({
      data: {
        adminId: adminId,
        driverId,
        content: content.trim(),
        isRead: false
      },
      include: {
        admin: { select: { id: true, fullName: true, username: true } },
        driver: { select: { id: true, fullName: true, username: true } }
      }
    });

    res.json({ success: true, message });
  } catch (error) {
    console.error('Error sending message:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/driver/messages
 * Fetch messages for the logged-in driver
 */
router.get('/driver', authenticate, requireRole('driver'), async (req, res) => {
  try {
    const driverId = req.user?.sub;

    if (!driverId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const messages = await prisma.message.findMany({
      where: {
        driverId
      },
      include: {
        admin: { select: { id: true, fullName: true, username: true } }
      },
      orderBy: { createdAt: 'desc' },
      take: 100
    });

    // Mark messages as read
    await prisma.message.updateMany({
      where: {
        driverId,
        isRead: false
      },
      data: { isRead: true }
    });

    res.json({ success: true, messages: messages.reverse() });
  } catch (error) {
    console.error('Error fetching driver messages:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/messages/driver/notifications/count
 * Get unread notification count for driver
 */
router.get('/driver/notifications/count', authenticate, requireRole('driver'), async (req, res) => {
  try {
    const driverId = req.user?.sub;
    if (!driverId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // Count unread messages
    const unreadMessages = await prisma.message.count({
      where: {
        driverId,
        isRead: false
      }
    });

    res.json({
      success: true,
      count: unreadMessages
    });
  } catch (error) {
    console.error('Error fetching notification count:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;// GET /api/admin/messages/unread-count - Get unread message count
router.get('/unread/count', authenticate, requireRole('admin'), async (req, res) => {
  try {
    // TODO: Count unread messages from drivers
    const count = 0;
    
    // Future implementation:
    // const count = await prisma.message.count({
    //   where: {
    //     fromRole: 'driver',
    //     read: false
    //   }
    // });

    res.json({ count });
  } catch (err) {
    console.error('GET /api/admin/messages/unread-count', err);
    res.status(500).json({ error: 'db_error', detail: err.message });
  }
});

// POST /api/admin/messages/:messageId/read - Mark message as read
router.post('/:messageId/read', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const { messageId } = req.params;

    // TODO: Update message read status
    // Future implementation:
    // await prisma.message.update({
    //   where: { id: messageId },
    //   data: { read: true, readAt: new Date() }
    // });

    res.json({ success: true });
  } catch (err) {
    console.error('POST /api/admin/messages/:messageId/read', err);
    res.status(500).json({ error: 'db_error', detail: err.message });
  }
});

// GET /api/admin/messages/history - Get message history with all drivers
router.get('/history/all', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const { limit = 100 } = req.query;

    // TODO: Get recent messages from all drivers
    const messages = [];
    
    // Future implementation:
    // const messages = await prisma.message.findMany({
    //   orderBy: { createdAt: 'desc' },
    //   take: parseInt(limit),
    //   include: {
    //     driver: {
    //       select: { id: true, username: true, fullName: true }
    //     }
    //   }
    // });

    res.json({ messages });
  } catch (err) {
    console.error('GET /api/admin/messages/history/all', err);
    res.status(500).json({ error: 'db_error', detail: err.message });
  }
});

module.exports = router;

