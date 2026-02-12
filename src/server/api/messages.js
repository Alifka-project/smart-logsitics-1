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
    // Both admin and driver messages use the same adminId/driverId pair
    // The senderRole field indicates who sent each message
    const messages = await prisma.message.findMany({
      where: {
        adminId,
        driverId
      },
      select: {
        id: true,
        content: true,
        senderRole: true,
        isRead: true,
        createdAt: true,
        adminId: true,
        driverId: true,
        admin: { select: { id: true, fullName: true, username: true } },
        driver: { select: { id: true, fullName: true, username: true } }
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset
    });

    console.log(`[Admin Conversation] Fetched ${messages.length} messages for driver ${driverId}`);
    if (messages.length > 0) {
      console.log('[Admin Conversation] Sample message:', {
        id: messages[0].id,
        senderRole: messages[0].senderRole,
        content: messages[0].content?.substring(0, 50)
      });
    }

    // Mark messages FROM driver as read (not admin's own sent messages)
    await prisma.message.updateMany({
      where: {
        driverId,
        adminId,
        isRead: false,
        senderRole: 'driver' // Only mark received messages as read
      },
      data: { isRead: true }
    });

    res.json({
      messages: messages.reverse(),
      total: await prisma.message.count({
        where: {
          adminId,
          driverId
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
    const adminId = req.user?.sub || req.user?.id;

    if (!adminId) {
      console.error('No admin ID found in req.user:', JSON.stringify(req.user || {}));
      return res.status(401).json({ error: 'Unauthorized - No admin ID' });
    }

    // Try to get unread counts using groupBy
    // ONLY count messages FROM drivers (senderRole: 'driver'), not admin's own sent messages
    try {
      const unreadCounts = await prisma.message.groupBy({
        by: ['driverId'],
        where: {
          adminId,
          isRead: false,
          senderRole: 'driver' // ONLY messages FROM driver TO admin
        },
        _count: {
          _all: true
        }
      });

      const result = {};
      unreadCounts.forEach(item => {
        result[item.driverId] = item._count?._all || 0;
      });

      console.log('[Admin Unread] Counts by driver (FROM drivers only):', result);
      return res.json(result);
    } catch (groupByErr) {
      // Fallback: use simple findMany if groupBy fails
      console.log('groupBy failed, using findMany fallback:', groupByErr.message);
      const messages = await prisma.message.findMany({
        where: {
          adminId,
          isRead: false,
          senderRole: 'driver' // ONLY messages FROM driver TO admin
        },
        select: { driverId: true }
      });

      const result = {};
      messages.forEach(msg => {
        result[msg.driverId] = (result[msg.driverId] || 0) + 1;
      });

      console.log('[Admin Unread Fallback] Counts by driver (FROM drivers only):', result);
      return res.json(result);
    }
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
        senderRole: 'admin',
        isRead: false
      },
      include: {
        admin: { select: { id: true, fullName: true, username: true } },
        driver: { select: { id: true, fullName: true, username: true } }
      }
    });

    console.log('[Message Created] Admin→Driver:', {
      messageId: message.id,
      from: adminId,
      to: driverId,
      senderRole: 'admin',
      contentPreview: content.substring(0, 30)
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
 * GET /api/messages/contacts
 * Get list of contacts (drivers for admin, admin for driver)
 */
router.get('/contacts', authenticate, async (req, res) => {
  try {
    const userRole = req.user?.account?.role || req.user?.role || 'driver';
    
    if (userRole === 'admin') {
      // Admin: return all drivers
      const drivers = await prisma.driver.findMany({
        where: {
          account: {
            role: 'driver'
          }
        },
        select: {
          id: true,
          fullName: true,
          username: true,
          account: {
            select: {
              role: true
            }
          }
        }
      });
      
      return res.json({ contacts: drivers });
    } else {
      // Driver: return admins
      const admins = await prisma.driver.findMany({
        where: {
          account: {
            role: 'admin'
          }
        },
        select: {
          id: true,
          fullName: true,
          username: true,
          account: {
            select: {
              role: true
            }
          }
        }
      });
      
      return res.json({ contacts: admins });
    }
  } catch (error) {
    console.error('Error fetching contacts:', error);
    res.status(500).json({ error: error.message });
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
        adminId,
        driverId
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

    // Find which admin to reply to:
    // 1. Check if there's an existing conversation with any admin
    // 2. If yes, reply to that admin
    // 3. If no, use the first admin account
    let adminId;
    
    const existingConversation = await prisma.message.findFirst({
      where: {
        driverId
      },
      orderBy: {
        createdAt: 'desc'
      },
      select: {
        adminId: true
      }
    });

    if (existingConversation) {
      // Reply to the admin who has an existing conversation
      adminId = existingConversation.adminId;
      console.log('[Driver Message] Replying to existing conversation with admin:', adminId);
    } else {
      // No existing conversation, find first admin
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

      adminId = adminAccount.driver.id;
      console.log('[Driver Message] Starting new conversation with admin:', adminId);
    }

    // Create message from driver to admin
    const message = await prisma.message.create({
      data: {
        adminId: adminId,
        driverId,
        content: content.trim(),
        senderRole: 'driver',
        isRead: false
      },
      include: {
        admin: { select: { id: true, fullName: true, username: true } },
        driver: { select: { id: true, fullName: true, username: true } }
      }
    });

    console.log('[Message Created] Driver→Admin:', {
      messageId: message.id,
      from: driverId,
      to: adminId,
      senderRole: 'driver',
      contentPreview: content.substring(0, 30)
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

    // Mark messages FROM admin as read (not driver's own sent messages)
    await prisma.message.updateMany({
      where: {
        driverId,
        isRead: false,
        senderRole: 'admin' // Only mark received messages as read
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
 * Only counts messages RECEIVED from admin, not messages SENT by driver
 */
router.get('/driver/notifications/count', authenticate, requireRole('driver'), async (req, res) => {
  try {
    const driverId = req.user?.sub;
    if (!driverId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // Count unread messages FROM admin TO driver (not messages sent BY driver)
    const unreadMessages = await prisma.message.count({
      where: {
        driverId,
        isRead: false,
        senderRole: 'admin' // Only messages from admin, not driver's own messages
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

// GET /api/admin/messages/unread-count - Get unread message count for admin
router.get('/unread/count', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const adminId = req.user?.sub;
    if (!adminId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // Count unread messages FROM drivers TO admin (not messages sent BY admin)
    const count = await prisma.message.count({
      where: {
        adminId,
        isRead: false,
        senderRole: 'driver' // Only messages from drivers, not admin's own messages
      }
    });

    res.json({ 
      success: true,
      count 
    });
  } catch (err) {
    console.error('GET /api/admin/messages/unread-count', err);
    res.status(500).json({ error: 'db_error', detail: err.message });
  }
});

// POST /api/admin/messages/:messageId/read - Mark message as read
router.post('/:messageId/read', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const { messageId } = req.params;
    const adminId = req.user?.sub;

    if (!adminId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // Update message read status
    const message = await prisma.message.update({
      where: { id: messageId },
      data: { 
        isRead: true
      }
    });

    res.json({ 
      success: true,
      message 
    });
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

