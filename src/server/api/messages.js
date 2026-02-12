/**
 * Messages API - Flexible messaging system
 * - All roles can chat with admins
 * - Admins can chat with anyone (including other admins)
 * - Supported roles: admin, driver, delivery_team, sales_ops, manager
 */

const express = require('express');
const router = express.Router();
const { authenticate, requireRole } = require('../auth');
const prisma = require('../db/prisma');

// Supported roles in the system
const ROLES = {
  ADMIN: 'admin',
  DRIVER: 'driver',
  DELIVERY_TEAM: 'delivery_team',
  SALES_OPS: 'sales_ops',
  MANAGER: 'manager'
};

/**
 * Helper: Get user role
 */
async function getUserRole(userId) {
  const account = await prisma.account.findFirst({
    where: { driverId: userId },
    select: { role: true }
  });
  return account?.role || 'driver';
}

/**
 * Helper: Check if user can send message to recipient
 * Rules:
 * - Admin can send to anyone (including other admins)
 * - All other roles can only send to admins
 */
async function canSendMessage(senderId, receiverId) {
  const senderRole = await getUserRole(senderId);
  const receiverRole = await getUserRole(receiverId);
  
  // Admin can send to anyone (including other admins)
  if (senderRole === ROLES.ADMIN) {
    return true;
  }
  
  // All other roles (driver, delivery_team, sales_ops, manager) can only send to admins
  if (receiverRole === ROLES.ADMIN) {
    return true;
  }
  
  return false;
}

/**
 * GET /api/messages/conversations/:userId
 * Fetch message history between current user and another user
 */
router.get('/conversations/:userId', authenticate, async (req, res) => {
  try {
    const { userId } = req.params;
    const currentUserId = req.user?.sub;
    const limit = Math.min(parseInt(req.query.limit) || 50, 500);
    const offset = parseInt(req.query.offset) || 0;

    if (!currentUserId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // Fetch messages between these two users (both directions)
    const messages = await prisma.message.findMany({
      where: {
        OR: [
          { senderId: currentUserId, receiverId: userId },
          { senderId: userId, receiverId: currentUserId }
        ]
      },
      select: {
        id: true,
        content: true,
        isRead: true,
        createdAt: true,
        senderId: true,
        receiverId: true,
        sender: { select: { id: true, fullName: true, username: true } },
        receiver: { select: { id: true, fullName: true, username: true } }
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset
    });

    console.log(`[Conversation] Fetched ${messages.length} messages between ${currentUserId} and ${userId}`);

    // Mark messages received by current user as read
    await prisma.message.updateMany({
      where: {
        senderId: userId,
        receiverId: currentUserId,
        isRead: false
      },
      data: { isRead: true }
    });

    res.json({
      messages: messages.reverse(),
      total: await prisma.message.count({
        where: {
          OR: [
            { senderId: currentUserId, receiverId: userId },
            { senderId: userId, receiverId: currentUserId }
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
 * GET /api/messages/unread
 * Get count of unread messages per sender (for current user)
 */
router.get('/unread', authenticate, async (req, res) => {
  try {
    const currentUserId = req.user?.sub;

    if (!currentUserId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // Get unread messages sent TO current user (grouped by sender)
    const unreadCounts = await prisma.message.groupBy({
      by: ['senderId'],
      where: {
        receiverId: currentUserId,
        isRead: false
      },
      _count: {
        _all: true
      }
    });

    const result = {};
    unreadCounts.forEach(item => {
      result[item.senderId] = item._count?._all || 0;
    });

    console.log(`[Unread] User ${currentUserId} has unread messages:`, result);
    return res.json(result);
  } catch (error) {
    console.error('Error fetching unread counts:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/messages/send
 * Send message to another user
 */
router.post('/send', authenticate, async (req, res) => {
  try {
    const { receiverId, content } = req.body;
    const senderId = req.user?.sub;

    if (!senderId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    if (!receiverId || !content || !content.trim()) {
      return res.status(400).json({ error: 'Missing required fields: receiverId, content' });
    }

    // Check if sender can message this receiver
    const canSend = await canSendMessage(senderId, receiverId);
    if (!canSend) {
      return res.status(403).json({ error: 'You are not allowed to send messages to this user' });
    }

    // Verify receiver exists
    const receiver = await prisma.driver.findUnique({
      where: { id: receiverId }
    });

    if (!receiver) {
      return res.status(404).json({ error: 'Receiver not found' });
    }

    // Create message
    const message = await prisma.message.create({
      data: {
        senderId,
        receiverId,
        content: content.trim(),
        isRead: false
      },
      include: {
        sender: { select: { id: true, fullName: true, username: true } },
        receiver: { select: { id: true, fullName: true, username: true } }
      }
    });

    const senderRole = await getUserRole(senderId);
    const receiverRole = await getUserRole(receiverId);
    
    console.log(`[Message Created] ${senderRole}→${receiverRole}:`, {
      messageId: message.id,
      from: senderId,
      to: receiverId,
      contentPreview: content.substring(0, 30)
    });

    res.json({ 
      success: true, 
      message 
    });
  } catch (err) {
    console.error('POST /api/messages/send', err);
    res.status(500).json({ error: 'db_error', detail: err.message });
  }
});

/**
 * GET /api/messages/contacts
 * Get list of users that current user can chat with
 * - Admin: everyone (including other admins)
 * - All other roles: only admins
 */
router.get('/contacts', authenticate, async (req, res) => {
  try {
    const currentUserId = req.user?.sub;

    if (!currentUserId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const currentUserRole = await getUserRole(currentUserId);

    let contacts = [];

    if (currentUserRole === ROLES.ADMIN) {
      // Admin can see all users (including other admins)
      contacts = await prisma.driver.findMany({
        where: {
          id: { not: currentUserId }, // Exclude self
          active: true
        },
        select: {
          id: true,
          username: true,
          fullName: true,
          email: true,
          profilePicture: true,
          account: {
            select: {
              role: true
            }
          }
        },
        orderBy: [
          {
            account: {
              role: 'asc'
            }
          },
          {
            fullName: 'asc'
          }
        ]
      });
    } else {
      // All other roles (driver, delivery_team, sales_ops, manager) can only see admins
      const adminAccounts = await prisma.account.findMany({
        where: {
          role: ROLES.ADMIN
        },
        include: {
          driver: {
            select: {
              id: true,
              username: true,
              fullName: true,
              email: true,
              profilePicture: true
            }
          }
        }
      });

      contacts = adminAccounts
        .filter(acc => acc.driver && acc.driver.id !== currentUserId)
        .map(acc => ({
          ...acc.driver,
          account: { role: ROLES.ADMIN }
        }));
    }

    // Get unread count for each contact
    const contactsWithUnread = await Promise.all(
      contacts.map(async (contact) => {
        const unreadCount = await prisma.message.count({
          where: {
            senderId: contact.id,
            receiverId: currentUserId,
            isRead: false
          }
        });

        return {
          ...contact,
          unreadCount
        };
      })
    );

    res.json({
      success: true,
      contacts: contactsWithUnread
    });
  } catch (error) {
    console.error('Error fetching contacts:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/messages/notifications/count
 * Get total unread message count for current user
 */
router.get('/notifications/count', authenticate, async (req, res) => {
  try {
    const currentUserId = req.user?.sub;
    if (!currentUserId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const unreadCount = await prisma.message.count({
      where: {
        receiverId: currentUserId,
        isRead: false
      }
    });

    console.log(`[Notifications] User ${currentUserId} has ${unreadCount} unread messages`);

    res.json({
      success: true,
      count: unreadCount
    });
  } catch (error) {
    console.error('Error fetching notification count:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * DELETE /api/messages/conversation/:userId
 * Clear message history with a user
 */
router.delete('/conversation/:userId', authenticate, async (req, res) => {
  try {
    const { userId } = req.params;
    const currentUserId = req.user?.sub;

    if (!currentUserId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const result = await prisma.message.deleteMany({
      where: {
        OR: [
          { senderId: currentUserId, receiverId: userId },
          { senderId: userId, receiverId: currentUserId }
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
 * POST /api/messages/:messageId/read
 * Mark message as read
 */
router.post('/:messageId/read', authenticate, async (req, res) => {
  try {
    const { messageId } = req.params;
    const currentUserId = req.user?.sub;

    if (!currentUserId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // Only allow marking messages received by current user as read
    const message = await prisma.message.update({
      where: { 
        id: messageId,
        receiverId: currentUserId
      },
      data: { 
        isRead: true
      }
    });

    res.json({ 
      success: true,
      message 
    });
  } catch (err) {
    console.error('POST /api/messages/:messageId/read', err);
    res.status(404).json({ error: 'Message not found or unauthorized' });
  }
});

module.exports = router;
