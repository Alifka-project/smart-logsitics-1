/**
 * Messages API - Real-time chat between admin and drivers
 */

const express = require('express');
const router = express.Router();
const { authenticate, requireRole } = require('../auth');
const prisma = require('../db/prisma');

/**
 * GET /api/admin/messages/conversations/:driverId
 * Fetch message history with a specific driver (admin or delivery_team)
 */
router.get('/conversations/:driverId', authenticate, async (req, res) => {
  const userRole = req.user?.account?.role || req.user?.role;
  if (userRole !== 'admin' && userRole !== 'delivery_team') {
    return res.status(403).json({ error: 'Forbidden - Admin or Delivery Team access required' });
  }
  try {
    const { driverId } = req.params;
    const adminId = req.user?.sub;
    const limit = Math.min(parseInt(req.query.limit) || 50, 500);
    const offset = parseInt(req.query.offset) || 0;

    if (!adminId) {
      return res.status(401).json({ error: 'Unauthorized - Admin ID required' });
    }

    // Fetch messages between current user and contact (bidirectional)
    // Support multi-role communication by checking BOTH directions:
    // 1. adminId = current user, driverId = contact (outgoing from current user)
    // 2. adminId = contact, driverId = current user (incoming to current user)
    const messages = await prisma.message.findMany({
      where: {
        OR: [
          { adminId, driverId },           // Current user sent to contact
          { adminId: driverId, driverId: adminId }  // Contact sent to current user
        ]
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

    console.log(`[Conversation] Fetched ${messages.length} bidirectional messages between ${adminId} and ${driverId}`);
    if (messages.length > 0) {
      console.log('[Conversation] Sample message:', {
        id: messages[0].id,
        senderRole: messages[0].senderRole,
        fromUser: messages[0].adminId,
        toUser: messages[0].driverId,
        content: messages[0].content?.substring(0, 50)
      });
    }

    // Mark received messages as read (messages where current user is the recipient)
    // Current user is recipient when: adminId = contact AND driverId = current user
    await prisma.message.updateMany({
      where: {
        adminId: driverId,  // Message was sent BY the contact
        driverId: adminId,  // Message was sent TO current user
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
 * Get count of unread messages per driver (admin or delivery_team)
 */
router.get('/unread', authenticate, async (req, res) => {
  const userRole = req.user?.account?.role || req.user?.role;
  if (userRole !== 'admin' && userRole !== 'delivery_team') {
    return res.status(403).json({ error: 'Forbidden - Admin or Delivery Team access required' });
  }
  try {
    const adminId = req.user?.sub || req.user?.id;

    if (!adminId) {
      console.error('No admin ID found in req.user:', JSON.stringify(req.user || {}));
      return res.status(401).json({ error: 'Unauthorized - No admin ID' });
    }

    // Get unread messages where current user is the RECIPIENT
    // For multi-role: check messages where adminId = other user AND driverId = current user
    try {
      // Get all unread messages TO the current user (where they are the recipient)
      const unreadMessages = await prisma.message.findMany({
        where: {
          driverId: adminId,  // Current user is recipient
          isRead: false
        },
        select: {
          adminId: true  // The sender is in adminId field
        }
      });

      const result = {};
      unreadMessages.forEach(msg => {
        const senderId = msg.adminId;  // The person who sent the message
        result[senderId] = (result[senderId] || 0) + 1;
      });

      console.log('[Unread] Counts by sender (TO current user):', result);
      return res.json(result);
    } catch (groupByErr) {
      console.error('Error fetching unread counts:', groupByErr);
      return res.json({});
    }
  } catch (error) {
    console.error('Error fetching unread counts:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/admin/messages/send - Send message to driver (admin or delivery_team)
 */
router.post('/send', authenticate, async (req, res) => {
  const userRole = req.user?.account?.role || req.user?.role;
  if (userRole !== 'admin' && userRole !== 'delivery_team') {
    return res.status(403).json({ error: 'Forbidden - Admin or Delivery Team access required' });
  }
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
        senderRole: userRole, // Use actual role (admin or delivery_team)
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
 * Get list of contacts based on role:
 * - Admin/Delivery Team: return all drivers + admin/delivery_team members
 * - Driver: return admin and delivery_team members
 */
router.get('/contacts', authenticate, async (req, res) => {
  try {
    const userRole = req.user?.account?.role || req.user?.role || 'driver';
    const currentUserId = req.user?.sub;
    
    if (userRole === 'admin' || userRole === 'delivery_team') {
      // Admin/Delivery Team: return all drivers + other admin/delivery_team members
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
              role: true,
              lastLogin: true
            }
          }
        },
        orderBy: {
          fullName: 'asc'
        }
      });
      
      // Also get admin and delivery_team members (for inter-team communication)
      const teamMembers = await prisma.driver.findMany({
        where: {
          id: { not: currentUserId }, // Exclude self
          account: {
            role: { in: ['admin', 'delivery_team'] }
          }
        },
        select: {
          id: true,
          fullName: true,
          username: true,
          account: {
            select: {
              role: true,
              lastLogin: true
            }
          }
        },
        orderBy: {
          fullName: 'asc'
        }
      });
      
      return res.json({ 
        contacts: [...teamMembers, ...drivers],
        drivers,
        teamMembers
      });
    } else {
      // Driver: return admin and delivery_team members
      const contacts = await prisma.driver.findMany({
        where: {
          account: {
            role: { in: ['admin', 'delivery_team'] }
          }
        },
        select: {
          id: true,
          fullName: true,
          username: true,
          account: {
            select: {
              role: true,
              lastLogin: true
            }
          }
        },
        orderBy: {
          fullName: 'asc'
        }
      });
      
      return res.json({ contacts });
    }
  } catch (error) {
    console.error('Error fetching contacts:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * DELETE /api/admin/messages/conversation/:driverId
 * Clear message history with a driver (admin or delivery_team)
 */
router.delete('/conversation/:driverId', authenticate, async (req, res) => {
  const userRole = req.user?.account?.role || req.user?.role;
  if (userRole !== 'admin' && userRole !== 'delivery_team') {
    return res.status(403).json({ error: 'Forbidden - Admin or Delivery Team access required' });
  }
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
 * Driver sending message to admin or delivery_team
 */
router.post('/driver/send', authenticate, requireRole('driver'), async (req, res) => {
  try {
    const { content, recipientId } = req.body; // Add recipientId parameter
    const driverId = req.user?.sub;

    if (!driverId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    if (!content || !content.trim()) {
      return res.status(400).json({ error: 'Message content is required' });
    }

    let adminId;
    
    // If recipientId is provided, use it (driver selected specific admin/delivery_team member)
    if (recipientId) {
      // Verify recipient exists and has appropriate role
      const recipient = await prisma.driver.findUnique({
        where: { id: recipientId },
        include: { account: true }
      });
      
      if (!recipient || !['admin', 'delivery_team'].includes(recipient.account?.role)) {
        return res.status(400).json({ error: 'Invalid recipient - must be admin or delivery team member' });
      }
      
      adminId = recipientId;
      console.log('[Driver Message] Sending to selected recipient:', adminId, 'role:', recipient.account.role);
    } else {
      // No recipient specified - find existing conversation or default admin
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
        // Reply to the most recent conversation
        adminId = existingConversation.adminId;
        console.log('[Driver Message] Replying to existing conversation with:', adminId);
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
 * Fetch all messages for the logged-in driver (from all contacts)
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
        admin: { 
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
        }
      },
      orderBy: { createdAt: 'desc' },
      take: 100
    });

    // Mark messages FROM admin/delivery_team as read (not driver's own sent messages)
    await prisma.message.updateMany({
      where: {
        driverId,
        isRead: false,
        senderRole: { in: ['admin', 'delivery_team'] } // Only mark received messages as read
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
 * GET /api/driver/messages/:contactId
 * Fetch messages for driver with a specific contact (admin or delivery_team member)
 */
router.get('/driver/:contactId', authenticate, requireRole('driver'), async (req, res) => {
  try {
    const driverId = req.user?.sub;
    const { contactId } = req.params;

    if (!driverId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // Fetch messages between driver and this contact
    const messages = await prisma.message.findMany({
      where: {
        driverId,
        adminId: contactId // Contact is stored in adminId field
      },
      include: {
        admin: { 
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
        },
        driver: {
          select: {
            id: true,
            fullName: true,
            username: true
          }
        }
      },
      orderBy: { createdAt: 'asc' },
      take: 100
    });

    // Mark messages FROM contact as read
    await prisma.message.updateMany({
      where: {
        driverId,
        adminId: contactId,
        isRead: false,
        senderRole: { in: ['admin', 'delivery_team'] }
      },
      data: { isRead: true }
    });

    res.json({ success: true, messages });
  } catch (error) {
    console.error('Error fetching driver conversation:', error);
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

    // Count unread messages FROM admin/delivery_team TO driver (not messages sent BY driver)
    const unreadMessages = await prisma.message.count({
      where: {
        driverId,
        isRead: false,
        senderRole: { in: ['admin', 'delivery_team'] } // Only messages from admin/delivery_team, not driver's own messages
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
    const adminId = req.user?.sub;
    if (!adminId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    const limitRaw = req.query.limit;
    const limit = Math.min(parseInt(limitRaw, 10) || 100, 500);

    const messages = await prisma.message.findMany({
      where: { adminId },
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: {
        driver: {
          select: { id: true, username: true, fullName: true }
        },
        admin: {
          select: { id: true, username: true, fullName: true }
        }
      }
    });

    res.json({
      success: true,
      messages: messages.map((m) => ({
        id: m.id,
        content: m.content,
        senderRole: m.senderRole,
        isRead: m.isRead,
        createdAt: m.createdAt,
        driver: m.driver,
        admin: m.admin
      }))
    });
  } catch (err) {
    console.error('GET /api/admin/messages/history/all', err);
    res.status(500).json({ error: 'db_error', detail: err.message });
  }
});

module.exports = router;

