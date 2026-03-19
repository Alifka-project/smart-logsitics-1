import { Router, Request, Response } from 'express';
import { authenticate, requireRole } from '../auth.js';
import prisma from '../db/prisma.js';
import cache from '../cache.js';

const router = Router();

type AuthUser = { sub: string; role?: string; account?: { role?: string } };

/**
 * GET /api/admin/messages/conversations/:driverId
 * Fetch message history with a specific driver (admin or delivery_team)
 */
router.get('/conversations/:driverId', authenticate, async (req: Request, res: Response): Promise<void> => {
  const userRole = (req.user as AuthUser)?.account?.role || (req.user as AuthUser)?.role;
  if (userRole !== 'admin' && userRole !== 'delivery_team') {
    res.status(403).json({ error: 'Forbidden - Admin or Delivery Team access required' }); return;
  }
  try {
    const driverId = req.params.driverId as string;
    const adminId = (req.user as AuthUser)?.sub;
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 500);
    const offset = parseInt(req.query.offset as string) || 0;

    if (!adminId) {
      res.status(401).json({ error: 'Unauthorized - Admin ID required' }); return;
    }

    const messages = await (prisma.message as any).findMany({
      where: {
        OR: [
          { adminId, driverId },
          { adminId: driverId, driverId: adminId }
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
        senderRole: (messages[0] as any).senderRole,
        fromUser: messages[0].adminId,
        toUser: messages[0].driverId,
        content: messages[0].content?.substring(0, 50)
      });
    }

    await (prisma.message as any).updateMany({
      where: {
        OR: [
          {
            adminId,
            driverId,
            senderRole: 'driver',
            isRead: false
          },
          {
            adminId: driverId,
            driverId: adminId,
            senderRole: { in: ['admin', 'delivery_team'] },
            isRead: false
          }
        ]
      },
      data: { isRead: true }
    });

    res.json({
      messages: messages.reverse(),
      total: messages.length
    });
  } catch (error: unknown) {
    const e = error as { message?: string };
    console.error('Error fetching messages:', error);
    res.status(500).json({ error: e.message });
  }
});

/**
 * GET /api/admin/messages/unread
 * Get count of unread messages per contact (admin or delivery_team)
 */
router.get('/unread', authenticate, async (req: Request, res: Response): Promise<void> => {
  const userRole = (req.user as AuthUser)?.account?.role || (req.user as AuthUser)?.role;
  if (userRole !== 'admin' && userRole !== 'delivery_team') {
    res.status(403).json({ error: 'Forbidden - Admin or Delivery Team access required' }); return;
  }
  try {
    const adminId = (req.user as AuthUser)?.sub || (req.user as AuthUser & { id?: string })?.id;

    if (!adminId) {
      console.error('No admin ID found in req.user:', JSON.stringify(req.user || {}));
      res.status(401).json({ error: 'Unauthorized - No admin ID' }); return;
    }

    try {
      const [fromDrivers, fromStaff] = await Promise.all([
        (prisma.message as any).groupBy({
          by: ['driverId'],
          where: {
            adminId,
            isRead: false,
            senderRole: 'driver'
          },
          _count: { id: true }
        }),
        (prisma.message as any).groupBy({
          by: ['adminId'],
          where: {
            driverId: adminId,
            isRead: false,
            senderRole: { in: ['admin', 'delivery_team'] }
          },
          _count: { id: true }
        })
      ]);

      const result: Record<string, number> = {};

      fromDrivers.forEach(group => {
        if (!group.driverId) return;
        result[group.driverId] = (result[group.driverId] || 0) + group._count.id;
      });

      fromStaff.forEach(group => {
        if (!group.adminId) return;
        result[group.adminId] = (result[group.adminId] || 0) + group._count.id;
      });

      res.json(result); return;
    } catch (groupByErr: unknown) {
      console.error('Error fetching unread counts:', groupByErr);
      res.json({}); return;
    }
  } catch (error: unknown) {
    const e = error as { message?: string };
    console.error('Error fetching unread counts:', error);
    res.status(500).json({ error: e.message });
  }
});

/**
 * POST /api/admin/messages/send - Send message to driver (admin or delivery_team)
 */
router.post('/send', authenticate, async (req: Request, res: Response): Promise<void> => {
  const userRole = (req.user as AuthUser)?.account?.role || (req.user as AuthUser)?.role;
  if (userRole !== 'admin' && userRole !== 'delivery_team') {
    res.status(403).json({ error: 'Forbidden - Admin or Delivery Team access required' }); return;
  }
  try {
    const { driverId, content } = req.body;
    const adminId = (req.user as AuthUser)?.sub;

    if (!adminId) {
      res.status(401).json({ error: 'Unauthorized' }); return;
    }

    if (!driverId || !content || !content.trim()) {
      res.status(400).json({ error: 'Missing required fields: driverId, content' }); return;
    }

    const driver = await prisma.driver.findUnique({
      where: { id: driverId }
    });

    if (!driver) {
      res.status(404).json({ error: 'driver_not_found' }); return;
    }

    const message = await (prisma.message as any).create({
      data: {
        adminId,
        driverId,
        content: content.trim(),
        senderRole: userRole,
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
  } catch (err: unknown) {
    const e = err as { message?: string };
    console.error('POST /api/admin/messages/send', err);
    res.status(500).json({ error: 'db_error', detail: e.message });
  }
});

/**
 * GET /api/messages/contacts
 * Get list of contacts based on role:
 * - Admin/Delivery Team: return all drivers + admin/delivery_team members
 * - Driver: return admin and delivery_team members
 */
router.get('/contacts', authenticate, async (req: Request, res: Response): Promise<void> => {
  try {
    const userRole = (req.user as AuthUser)?.account?.role || (req.user as AuthUser)?.role || 'driver';
    const currentUserId = (req.user as AuthUser)?.sub;
    const cacheKey = `contacts:${userRole}:${currentUserId}`;

    const data = await cache.getOrFetch(cacheKey, async () => {
      if (userRole === 'admin' || userRole === 'delivery_team') {
        const drivers = await prisma.driver.findMany({
          where: { account: { role: 'driver' } },
          select: {
            id: true,
            fullName: true,
            username: true,
            account: { select: { role: true, lastLogin: true } }
          },
          orderBy: { fullName: 'asc' }
        });

        const teamMembers = await prisma.driver.findMany({
          where: {
            id: { not: currentUserId },
            account: { role: { in: ['admin', 'delivery_team'] } }
          },
          select: {
            id: true,
            fullName: true,
            username: true,
            account: { select: { role: true, lastLogin: true } }
          },
          orderBy: { fullName: 'asc' }
        });

        return { contacts: [...teamMembers, ...drivers], drivers, teamMembers };
      } else {
        const contacts = await prisma.driver.findMany({
          where: { account: { role: { in: ['admin', 'delivery_team'] } } },
          select: {
            id: true,
            fullName: true,
            username: true,
            account: { select: { role: true, lastLogin: true } }
          },
          orderBy: { fullName: 'asc' }
        });
        return { contacts };
      }
    }, 60000, 300000);

    res.json(data); return;
  } catch (error: unknown) {
    const e = error as { message?: string };
    console.error('Error fetching contacts:', error);
    res.status(500).json({ error: e.message });
  }
});

/**
 * DELETE /api/admin/messages/conversation/:driverId
 * Clear message history with a driver (admin or delivery_team)
 */
router.delete('/conversation/:driverId', authenticate, async (req: Request, res: Response): Promise<void> => {
  const userRole = (req.user as AuthUser)?.account?.role || (req.user as AuthUser)?.role;
  if (userRole !== 'admin' && userRole !== 'delivery_team') {
    res.status(403).json({ error: 'Forbidden - Admin or Delivery Team access required' }); return;
  }
  try {
    const driverId = req.params.driverId as string;
    const adminId = (req.user as AuthUser)?.sub;

    if (!adminId) {
      res.status(401).json({ error: 'Unauthorized' }); return;
    }

    const result = await prisma.message.deleteMany({
      where: {
        adminId,
        driverId
      }
    });

    res.json({ success: true, deletedCount: result.count });
  } catch (error: unknown) {
    const e = error as { message?: string };
    console.error('Error deleting messages:', error);
    res.status(500).json({ error: e.message });
  }
});

/**
 * POST /api/driver/messages/send
 * Driver sending message to admin or delivery_team
 */
router.post('/driver/send', authenticate, requireRole('driver'), async (req: Request, res: Response): Promise<void> => {
  try {
    const { content, recipientId } = req.body;
    const driverId = (req.user as AuthUser)?.sub;

    if (!driverId) {
      res.status(401).json({ error: 'Unauthorized' }); return;
    }

    if (!content || !content.trim()) {
      res.status(400).json({ error: 'Message content is required' }); return;
    }

    let adminId: string | undefined;

    if (recipientId) {
      const recipient = await prisma.driver.findUnique({
        where: { id: recipientId },
        include: { account: true }
      });

      if (!recipient || !['admin', 'delivery_team'].includes(recipient.account?.role ?? '')) {
        res.status(400).json({ error: 'Invalid recipient - must be admin or delivery team member' }); return;
      }

      adminId = recipientId;
      console.log('[Driver Message] Sending to selected recipient:', adminId, 'role:', recipient.account?.role);
    } else {
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
        adminId = existingConversation.adminId ?? undefined;
        console.log('[Driver Message] Replying to existing conversation with:', adminId);
      } else {
        const adminAccount = await prisma.account.findFirst({
          where: {
            role: 'admin'
          },
          include: {
            driver: true
          }
        });

        if (!adminAccount || !adminAccount.driver) {
          res.status(404).json({ error: 'No admin found' }); return;
        }

        adminId = adminAccount.driver.id;
        console.log('[Driver Message] Starting new conversation with admin:', adminId);
      }
    }

    const message = await (prisma.message as any).create({
      data: {
        adminId: adminId as string,
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
  } catch (error: unknown) {
    const e = error as { message?: string };
    console.error('Error sending message:', error);
    res.status(500).json({ error: e.message });
  }
});

/**
 * GET /api/driver/messages
 * Fetch all messages for the logged-in driver (from all contacts)
 */
router.get('/driver', authenticate, requireRole('driver'), async (req: Request, res: Response): Promise<void> => {
  try {
    const driverId = (req.user as AuthUser)?.sub;

    if (!driverId) {
      res.status(401).json({ error: 'Unauthorized' }); return;
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

    await (prisma.message as any).updateMany({
      where: {
        driverId,
        isRead: false,
        senderRole: { in: ['admin', 'delivery_team'] }
      },
      data: { isRead: true }
    });

    res.json({ success: true, messages: messages.reverse() });
  } catch (error: unknown) {
    const e = error as { message?: string };
    console.error('Error fetching driver messages:', error);
    res.status(500).json({ error: e.message });
  }
});

/**
 * GET /api/driver/messages/:contactId
 * Fetch messages for driver with a specific contact (admin or delivery_team member)
 */
router.get('/driver/:contactId', authenticate, requireRole('driver'), async (req: Request, res: Response): Promise<void> => {
  try {
    const driverId = (req.user as AuthUser)?.sub;
    const contactId = req.params.contactId as string;

    if (!driverId) {
      res.status(401).json({ error: 'Unauthorized' }); return;
    }

    const messages = await prisma.message.findMany({
      where: {
        driverId,
        adminId: contactId
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

    await (prisma.message as any).updateMany({
      where: {
        driverId,
        adminId: contactId,
        isRead: false,
        senderRole: { in: ['admin', 'delivery_team'] }
      },
      data: { isRead: true }
    });

    res.json({ success: true, messages });
  } catch (error: unknown) {
    const e = error as { message?: string };
    console.error('Error fetching driver conversation:', error);
    res.status(500).json({ error: e.message });
  }
});

/**
 * GET /api/messages/driver/notifications/count
 * Get unread notification count for driver
 * Only counts messages RECEIVED from admin, not messages SENT by driver
 */
router.get('/driver/notifications/count', authenticate, requireRole('driver'), async (req: Request, res: Response): Promise<void> => {
  try {
    const driverId = (req.user as AuthUser)?.sub;
    if (!driverId) {
      res.status(401).json({ error: 'Unauthorized' }); return;
    }

    const unreadMessages = await (prisma.message as any).count({
      where: {
        driverId,
        isRead: false,
        senderRole: { in: ['admin', 'delivery_team'] }
      }
    });

    res.json({
      success: true,
      count: unreadMessages
    });
  } catch (error: unknown) {
    const e = error as { message?: string };
    console.error('Error fetching notification count:', error);
    res.status(500).json({ error: e.message });
  }
});

// GET /api/admin/messages/unread-count - Get unread message count for admin
router.get('/unread/count', authenticate, requireRole('admin'), async (req: Request, res: Response): Promise<void> => {
  try {
    const adminId = (req.user as AuthUser)?.sub;
    if (!adminId) {
      res.status(401).json({ error: 'Unauthorized' }); return;
    }

    const count = await (prisma.message as any).count({
      where: {
        adminId,
        isRead: false,
        senderRole: 'driver'
      }
    });

    res.json({ 
      success: true,
      count 
    });
  } catch (err: unknown) {
    const e = err as { message?: string };
    console.error('GET /api/admin/messages/unread-count', err);
    res.status(500).json({ error: 'db_error', detail: e.message });
  }
});

// POST /api/admin/messages/:messageId/read - Mark message as read
router.post('/:messageId/read', authenticate, requireRole('admin'), async (req: Request, res: Response): Promise<void> => {
  try {
    const messageId = req.params.messageId as string;
    const adminId = (req.user as AuthUser)?.sub;

    if (!adminId) {
      res.status(401).json({ error: 'Unauthorized' }); return;
    }

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
  } catch (err: unknown) {
    const e = err as { message?: string };
    console.error('POST /api/admin/messages/:messageId/read', err);
    res.status(500).json({ error: 'db_error', detail: e.message });
  }
});

// GET /api/admin/messages/history - Get message history with all drivers
router.get('/history/all', authenticate, requireRole('admin'), async (req: Request, res: Response): Promise<void> => {
  try {
    const adminId = (req.user as AuthUser)?.sub;
    if (!adminId) {
      res.status(401).json({ error: 'Unauthorized' }); return;
    }
    const limitRaw = req.query.limit as string | undefined;
    const limit = Math.min(parseInt(limitRaw ?? '', 10) || 100, 500);

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
        senderRole: (m as any).senderRole,
        isRead: m.isRead,
        createdAt: m.createdAt,
        driver: m.driver,
        admin: m.admin
      }))
    });
  } catch (err: unknown) {
    const e = err as { message?: string };
    console.error('GET /api/admin/messages/history/all', err);
    res.status(500).json({ error: 'db_error', detail: e.message });
  }
});

export default router;
