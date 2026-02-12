/**
 * Messages API - Multi-role messaging system
 * Uses existing schema (admin_id, driver_id, sender_role) to support:
 * - 5 roles: admin, driver, delivery_team, sales_ops, manager
 * - Admin-to-admin chat capability
 * - All roles can chat with admins
 * - Drivers can only chat with admins
 */

const express = require('express');
const router = express.Router();
const { authenticate, requireRole } = require('../auth');
const prisma = require('../db/prisma');

// Supported roles
const ROLES = {
  ADMIN: 'admin',
  DRIVER: 'driver',
  DELIVERY_TEAM: 'delivery_team',
  SALES_OPS: 'sales_ops',
  MANAGER: 'manager'
};

/**
 * Helper: Get user role from database
 */
async function getUserRole(userId) {
  const account = await prisma.account.findFirst({
    where: { driverId: userId },
    select: { role: true }
  });
  return account?.role || 'driver';
}

/**
 * Helper: Get conversation IDs for two users
 * For admin-to-admin: use alphabetical order to ensure consistency
 * For admin-to-other: admin is adminId, other is driverId
 */
function getConversationIds(user1Id, user1Role, user2Id, user2Role) {
  // Both admins: use alphabetical order
  if (user1Role === ROLES.ADMIN && user2Role === ROLES.ADMIN) {
    if (user1Id < user2Id) {
      return { adminId: user1Id, driverId: user2Id };
    } else {
      return { adminId: user2Id, driverId: user1Id };
    }
  }
  
  // One admin, one other role
  if (user1Role === ROLES.ADMIN) {
    return { adminId: user1Id, driverId: user2Id };
  } else if (user2Role === ROLES.ADMIN) {
    return { adminId: user2Id, driverId: user1Id };
  }
  
  // Neither is admin (shouldn't happen based on rules, but handle it)
  return { adminId: user1Id, driverId: user2Id };
}

/**
 * GET /api/messages/unread
 * Get count of unread messages grouped by sender
 * Works for ALL roles
 */
router.get('/unread', authenticate, async (req, res) => {
  try {
    const currentUserId = req.user?.sub || req.user?.id;
    if (!currentUserId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const currentUserRole = await getUserRole(currentUserId);
    
    let unreadMessages = [];
    
    if (currentUserRole === ROLES.ADMIN) {
      // Admin: get messages where they are adminId and message is not from admin
      // OR where they are driverId and message IS from admin (admin-to-admin)
      unreadMessages = await prisma.message.findMany({
        where: {
          isRead: false,
          OR: [
            {
              // Messages TO admin (admin is adminId, sender is not admin role)
              adminId: currentUserId,
              senderRole: { not: ROLES.ADMIN }
            },
            {
              // Admin-to-admin messages where current admin is the driverId
              driverId: currentUserId,
              senderRole: ROLES.ADMIN
            }
          ]
        },
        select: {
          id: true,
          adminId: true,
          driverId: true,
          senderRole: true
        }
      });
    } else {
      // Other roles: get messages where they are driverId and sender is admin
      unreadMessages = await prisma.message.findMany({
        where: {
          driverId: currentUserId,
          senderRole: ROLES.ADMIN,
          isRead: false
        },
        select: {
          id: true,
          adminId: true,
          driverId: true,
          senderRole: true
        }
      });
    }

    // Group by sender
    const result = {};
    for (const msg of unreadMessages) {
      // Determine who sent it
      let senderId;
      if (msg.senderRole === ROLES.ADMIN) {
        // Admin sent it
        senderId = msg.adminId;
        // If current user is in driverId position, sender is adminId
        // If current user is in adminId position, sender is driverId
        if (msg.driverId === currentUserId) {
          senderId = msg.adminId;
        } else {
          senderId = msg.driverId;
        }
      } else {
        // Non-admin sent it (they're in driverId position)
        senderId = msg.driverId;
      }
      
      result[senderId] = (result[senderId] || 0) + 1;
    }

    console.log(\`[Unread] User \${currentUserId} (\${currentUserRole}) has unread:\`, result);
    return res.json(result);
  } catch (error) {
    console.error('Error fetching unread counts:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/messages/conversations/:userId
 * Fetch conversation between current user and another user
 * Works for ALL roles
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

    // Get both users' roles
    const currentUserRole = await getUserRole(currentUserId);
    const otherUserRole = await getUserRole(userId);

    // Get conversation IDs
    const { adminId, driverId } = getConversationIds(
      currentUserId, currentUserRole,
      userId, otherUserRole
    );

    // Fetch messages
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

    console.log(\`[Conversation] \${currentUserRole}↔\${otherUserRole}: Fetched \${messages.length} messages\`);

    // Mark unread messages TO current user as read
    let markReadCondition;
    
    if (currentUserRole === ROLES.ADMIN && otherUserRole === ROLES.ADMIN) {
      // Admin-to-admin: mark messages where current user is in driverId position
      markReadCondition = {
        adminId,
        driverId: currentUserId,
        senderRole: ROLES.ADMIN,
        isRead: false
      };
    } else if (currentUserRole === ROLES.ADMIN) {
      // Admin receiving from non-admin
      markReadCondition = {
        adminId: currentUserId,
        driverId: userId,
        senderRole: { not: ROLES.ADMIN },
        isRead: false
      };
    } else {
      // Non-admin receiving from admin
      markReadCondition = {
        driverId: currentUserId,
        senderRole: ROLES.ADMIN,
        isRead: false
      };
    }

    await prisma.message.updateMany({
      where: markReadCondition,
      data: { isRead: true }
    });

    // Transform messages to indicate actual sender
    const transformedMessages = messages.map(msg => {
      // Determine actual sender based on senderRole
      let actualSenderId, actualReceiverId;
      
      if (msg.senderRole === ROLES.ADMIN) {
        // Admin sent it - figure out which one
        if (currentUserRole === ROLES.ADMIN && otherUserRole === ROLES.ADMIN) {
          // Both admins: if message sender_role is admin, check positions
          actualSenderId = (msg.driverId === currentUserId) ? msg.adminId : msg.driverId;
          actualReceiverId = (actualSenderId === msg.adminId) ? msg.driverId : msg.adminId;
        } else {
          actualSenderId = msg.adminId;
          actualReceiverId = msg.driverId;
        }
      } else {
        // Non-admin sent it (they're in driverId position)
        actualSenderId = msg.driverId;
        actualReceiverId = msg.adminId;
      }

      return {
        ...msg,
        senderId: actualSenderId,
        receiverId: actualReceiverId,
        text: msg.content, // Backward compatibility
        timestamp: msg.createdAt
      };
    });

    res.json({
      messages: transformedMessages.reverse(),
      total: await prisma.message.count({ where: { adminId, driverId } })
    });
  } catch (error) {
    console.error('Error fetching conversation:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/messages/send
 * Send message to another user
 * Works for ALL roles
 */
router.post('/send', authenticate, async (req, res) => {
  try {
    const { receiverId, content } = req.body;
    const senderId = req.user?.sub;

    if (!senderId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    if (!receiverId || !content || !content.trim()) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Get both users' roles
    const senderRole = await getUserRole(senderId);
    const receiverRole = await getUserRole(receiverId);

    // Check permission: admins can message anyone, others can only message admins
    if (senderRole !== ROLES.ADMIN && receiverRole !== ROLES.ADMIN) {
      return res.status(403).json({ error: 'You can only send messages to admins' });
    }

    // Verify receiver exists
    const receiver = await prisma.driver.findUnique({
      where: { id: receiverId }
    });
    if (!receiver) {
      return res.status(404).json({ error: 'Receiver not found' });
    }

    // Get conversation IDs
    const { adminId, driverId } = getConversationIds(
      senderId, senderRole,
      receiverId, receiverRole
    );

    // Create message
    const message = await prisma.message.create({
      data: {
        adminId,
        driverId,
        content: content.trim(),
        senderRole,
        isRead: false
      },
      include: {
        admin: { select: { id: true, fullName: true, username: true } },
        driver: { select: { id: true, fullName: true, username: true } }
      }
    });

    console.log(\`[Message] \${senderRole}→\${receiverRole}:\`, {
      messageId: message.id,
      from: senderId,
      to: receiverId
    });

    res.json({ success: true, message });
  } catch (err) {
    console.error('POST /api/messages/send', err);
    res.status(500).json({ error: 'db_error', detail: err.message });
  }
});

/**
 * GET /api/messages/contacts
 * Get list of users current user can chat with
 * - Admin: everyone (including other admins)
 * - Others: only admins
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
      // Admin can see everyone
      contacts = await prisma.driver.findMany({
        where: {
          id: { not: currentUserId },
          active: true
        },
        select: {
          id: true,
          username: true,
          fullName: true,
          email: true,
          profilePicture: true,
          account: {
            select: { role: true }
          }
        },
        orderBy: [
          { account: { role: 'asc' } },
          { fullName: 'asc' }
        ]
      });
    } else {
      // Others can only see admins
      const adminAccounts = await prisma.account.findMany({
        where: { role: ROLES.ADMIN },
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

    // Add unread count for each contact
    const contactsWithUnread = await Promise.all(
      contacts.map(async (contact) => {
        const contactRole = contact.account?.role || 'driver';
        const { adminId, driverId } = getConversationIds(
          currentUserId, currentUserRole,
          contact.id, contactRole
        );

        let unreadCondition;
        if (currentUserRole === ROLES.ADMIN && contactRole === ROLES.ADMIN) {
          // Admin-to-admin: current user in driverId position
          unreadCondition = {
            adminId,
            driverId: currentUserId,
            senderRole: ROLES.ADMIN,
            isRead: false
          };
        } else if (currentUserRole === ROLES.ADMIN) {
          // Admin receiving from non-admin
          unreadCondition = {
            adminId,
            driverId,
            senderRole: { not: ROLES.ADMIN },
            isRead: false
          };
        } else {
          // Non-admin receiving from admin
          unreadCondition = {
            driverId: currentUserId,
            senderRole: ROLES.ADMIN,
            isRead: false
          };
        }

        const unreadCount = await prisma.message.count({ where: unreadCondition });

        return {
          ...contact,
          role: contactRole,
          unreadCount
        };
      })
    );

    res.json({ success: true, contacts: contactsWithUnread });
  } catch (error) {
    console.error('Error fetching contacts:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/messages/driver
 * Driver convenience endpoint - get conversation with first admin
 */
router.get('/driver', authenticate, async (req, res) => {
  try {
    const currentUserId = req.user?.sub;
    if (!currentUserId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // Find first admin
    const adminAccount = await prisma.account.findFirst({
      where: { role: ROLES.ADMIN },
      include: { driver: { select: { id: true } } },
      orderBy: { createdAt: 'asc' }
    });

    if (!adminAccount || !adminAccount.driver) {
      return res.json({ messages: [] });
    }

    const adminId = adminAccount.driver.id;

    // Fetch messages
    const messages = await prisma.message.findMany({
      where: {
        adminId,
        driverId: currentUserId
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
      orderBy: { createdAt: 'asc' },
      take: 100
    });

    // Mark messages FROM admin as read
    await prisma.message.updateMany({
      where: {
        adminId,
        driverId: currentUserId,
        senderRole: ROLES.ADMIN,
        isRead: false
      },
      data: { isRead: true }
    });

    // Transform messages
    const transformedMessages = messages.map(msg => ({
      ...msg,
      senderId: msg.senderRole === ROLES.ADMIN ? msg.adminId : msg.driverId,
      receiverId: msg.senderRole === ROLES.ADMIN ? msg.driverId : msg.adminId,
      text: msg.content,
      timestamp: msg.createdAt
    }));

    res.json({ messages: transformedMessages });
  } catch (error) {
    console.error('Error fetching driver messages:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/messages/driver/send
 * Driver convenience endpoint - send message to admin
 */
router.post('/driver/send', authenticate, async (req, res) => {
  try {
    const { content } = req.body;
    const senderId = req.user?.sub;

    if (!senderId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    if (!content || !content.trim()) {
      return res.status(400).json({ error: 'Missing content' });
    }

    const senderRole = await getUserRole(senderId);

    // Find admin to receive message
    const adminAccount = await prisma.account.findFirst({
      where: { role: ROLES.ADMIN },
      include: { driver: { select: { id: true } } },
      orderBy: { createdAt: 'asc' }
    });

    if (!adminAccount || !adminAccount.driver) {
      return res.status(404).json({ error: 'No admin available' });
    }

    const receiverId = adminAccount.driver.id;

    // Create message
    const message = await prisma.message.create({
      data: {
        adminId: receiverId,
        driverId: senderId,
        content: content.trim(),
        senderRole,
        isRead: false
      },
      include: {
        admin: { select: { id: true, fullName: true, username: true } },
        driver: { select: { id: true, fullName: true, username: true } }
      }
    });

    console.log(\`[Driver Message] \${senderRole}→admin:\`, {
      messageId: message.id,
      from: senderId
    });

    res.json({ success: true, message });
  } catch (err) {
    console.error('POST /api/messages/driver/send', err);
    res.status(500).json({ error: 'db_error', detail: err.message });
  }
});

/**
 * GET /api/messages/driver/notifications/count
 * Get unread count for driver from admins
 */
router.get('/driver/notifications/count', authenticate, async (req, res) => {
  try {
    const currentUserId = req.user?.sub;
    if (!currentUserId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const count = await prisma.message.count({
      where: {
        driverId: currentUserId,
        senderRole: ROLES.ADMIN,
        isRead: false
      }
    });

    res.json({ success: true, count });
  } catch (error) {
    console.error('Error fetching driver notification count:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/messages/notifications/count
 * Get total unread message count
 */
router.get('/notifications/count', authenticate, async (req, res) => {
  try {
    const currentUserId = req.user?.sub;
    if (!currentUserId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const currentUserRole = await getUserRole(currentUserId);
    let count = 0;

    if (currentUserRole === ROLES.ADMIN) {
      count = await prisma.message.count({
        where: {
          isRead: false,
          OR: [
            {
              adminId: currentUserId,
              senderRole: { not: ROLES.ADMIN }
            },
            {
              driverId: currentUserId,
              senderRole: ROLES.ADMIN
            }
          ]
        }
      });
    } else {
      count = await prisma.message.count({
        where: {
          driverId: currentUserId,
          senderRole: ROLES.ADMIN,
          isRead: false
        }
      });
    }

    console.log(\`[Notifications] User \${currentUserId} has \${count} unread\`);
    res.json({ success: true, count });
  } catch (error) {
    console.error('Error fetching notification count:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * DELETE /api/messages/conversation/:userId
 * Clear conversation with a user
 */
router.delete('/conversation/:userId', authenticate, async (req, res) => {
  try {
    const { userId } = req.params;
    const currentUserId = req.user?.sub;

    if (!currentUserId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const currentUserRole = await getUserRole(currentUserId);
    const otherUserRole = await getUserRole(userId);

    const { adminId, driverId } = getConversationIds(
      currentUserId, currentUserRole,
      userId, otherUserRole
    );

    const result = await prisma.message.deleteMany({
      where: { adminId, driverId }
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

    const message = await prisma.message.update({
      where: { id: messageId },
      data: { isRead: true }
    });

    res.json({ success: true, message });
  } catch (err) {
    console.error('POST /api/messages/:messageId/read', err);
    res.status(404).json({ error: 'Message not found' });
  }
});

module.exports = router;
