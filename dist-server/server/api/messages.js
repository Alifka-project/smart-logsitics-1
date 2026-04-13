"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_js_1 = require("../auth.js");
const prisma_js_1 = __importDefault(require("../db/prisma.js"));
const cache_js_1 = __importDefault(require("../cache.js"));
const router = (0, express_1.Router)();
// Ensure attachment columns exist before any message query runs (idempotent)
const schemaReady = (async () => {
    try {
        await prisma_js_1.default.$executeRawUnsafe(`ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "attachment_url" TEXT;`);
        await prisma_js_1.default.$executeRawUnsafe(`ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "attachment_type" VARCHAR(100);`);
        await prisma_js_1.default.$executeRawUnsafe(`ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "attachment_name" VARCHAR(255);`);
        await prisma_js_1.default.$executeRawUnsafe(`ALTER TABLE "messages" ALTER COLUMN "content" SET DEFAULT '';`);
        console.log('[messages] schema migration ok');
    }
    catch (e) {
        console.warn('[messages] schema migration skipped:', e.message);
    }
})();
/**
 * GET /api/admin/messages/conversations/:driverId
 * Fetch message history with a specific driver (admin or delivery_team)
 */
router.get('/conversations/:driverId', auth_js_1.authenticate, async (req, res) => {
    const userRole = req.user?.account?.role || req.user?.role;
    if (userRole !== 'admin' && userRole !== 'delivery_team' && userRole !== 'logistics_team') {
        res.status(403).json({ error: 'Forbidden - Admin, Delivery Team or Logistics Team access required' });
        return;
    }
    try {
        await schemaReady;
        const driverId = req.params.driverId;
        const adminId = req.user?.sub;
        const limit = Math.min(parseInt(req.query.limit) || 50, 500);
        const offset = parseInt(req.query.offset) || 0;
        if (!adminId) {
            res.status(401).json({ error: 'Unauthorized - Admin ID required' });
            return;
        }
        const messages = await prisma_js_1.default.message.findMany({
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
                attachmentUrl: true,
                attachmentType: true,
                attachmentName: true,
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
        await prisma_js_1.default.message.updateMany({
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
                        senderRole: { in: ['admin', 'delivery_team', 'logistics_team'] },
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
    }
    catch (error) {
        const e = error;
        console.error('Error fetching messages:', error);
        res.status(500).json({ error: e.message });
    }
});
/**
 * GET /api/admin/messages/unread
 * Get count of unread messages per contact (admin or delivery_team)
 */
router.get('/unread', auth_js_1.authenticate, async (req, res) => {
    const userRole = req.user?.account?.role || req.user?.role;
    if (userRole !== 'admin' && userRole !== 'delivery_team' && userRole !== 'logistics_team') {
        res.status(403).json({ error: 'Forbidden - Admin, Delivery Team or Logistics Team access required' });
        return;
    }
    try {
        const adminId = req.user?.sub || req.user?.id;
        if (!adminId) {
            console.error('No admin ID found in req.user:', JSON.stringify(req.user || {}));
            res.status(401).json({ error: 'Unauthorized - No admin ID' });
            return;
        }
        try {
            const [fromDrivers, fromStaff] = await Promise.all([
                prisma_js_1.default.message.groupBy({
                    by: ['driverId'],
                    where: {
                        adminId,
                        isRead: false,
                        senderRole: 'driver'
                    },
                    _count: { id: true }
                }),
                prisma_js_1.default.message.groupBy({
                    by: ['adminId'],
                    where: {
                        driverId: adminId,
                        isRead: false,
                        senderRole: { in: ['admin', 'delivery_team', 'logistics_team'] }
                    },
                    _count: { id: true }
                })
            ]);
            const result = {};
            fromDrivers.forEach(group => {
                if (!group.driverId)
                    return;
                result[group.driverId] = (result[group.driverId] || 0) + group._count.id;
            });
            fromStaff.forEach(group => {
                if (!group.adminId)
                    return;
                result[group.adminId] = (result[group.adminId] || 0) + group._count.id;
            });
            res.json(result);
            return;
        }
        catch (groupByErr) {
            console.error('Error fetching unread counts:', groupByErr);
            res.json({});
            return;
        }
    }
    catch (error) {
        const e = error;
        console.error('Error fetching unread counts:', error);
        res.status(500).json({ error: e.message });
    }
});
/**
 * POST /api/admin/messages/send - Send message to driver (admin or delivery_team)
 * Accepts optional attachmentUrl (base64 data URL), attachmentType (MIME), attachmentName
 */
router.post('/send', auth_js_1.authenticate, async (req, res) => {
    const userRole = req.user?.account?.role || req.user?.role;
    if (userRole !== 'admin' && userRole !== 'delivery_team' && userRole !== 'logistics_team') {
        res.status(403).json({ error: 'Forbidden - Admin, Delivery Team or Logistics Team access required' });
        return;
    }
    try {
        await schemaReady;
        const { driverId, content, attachmentUrl, attachmentType, attachmentName } = req.body;
        const adminId = req.user?.sub;
        if (!adminId) {
            res.status(401).json({ error: 'Unauthorized' });
            return;
        }
        const hasText = content && content.trim();
        const hasAttachment = attachmentUrl && attachmentType;
        if (!driverId || (!hasText && !hasAttachment)) {
            res.status(400).json({ error: 'Missing required fields: driverId and content or attachment' });
            return;
        }
        const driver = await prisma_js_1.default.driver.findUnique({
            where: { id: driverId }
        });
        if (!driver) {
            res.status(404).json({ error: 'driver_not_found' });
            return;
        }
        const message = await prisma_js_1.default.message.create({
            data: {
                adminId,
                driverId,
                content: hasText ? content.trim() : '',
                senderRole: userRole,
                isRead: false,
                ...(hasAttachment && {
                    attachmentUrl,
                    attachmentType,
                    attachmentName: attachmentName || null
                })
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
            senderRole: userRole,
            hasAttachment: !!hasAttachment,
            contentPreview: hasText ? content.substring(0, 30) : '(attachment only)'
        });
        res.json({
            success: true,
            message
        });
    }
    catch (err) {
        const e = err;
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
router.get('/contacts', auth_js_1.authenticate, async (req, res) => {
    try {
        const userRole = req.user?.account?.role || req.user?.role || 'driver';
        const currentUserId = req.user?.sub;
        const cacheKey = `contacts:${userRole}:${currentUserId}`;
        const data = await cache_js_1.default.getOrFetch(cacheKey, async () => {
            if (userRole === 'admin' || userRole === 'delivery_team' || userRole === 'logistics_team') {
                const drivers = await prisma_js_1.default.driver.findMany({
                    where: { account: { role: 'driver' } },
                    select: {
                        id: true,
                        fullName: true,
                        username: true,
                        account: { select: { role: true, lastLogin: true } }
                    },
                    orderBy: { fullName: 'asc' }
                });
                const teamMembers = await prisma_js_1.default.driver.findMany({
                    where: {
                        id: { not: currentUserId },
                        account: { role: { in: ['admin', 'delivery_team', 'logistics_team'] } }
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
            }
            else {
                const contacts = await prisma_js_1.default.driver.findMany({
                    where: { account: { role: { in: ['admin', 'delivery_team', 'logistics_team'] } } },
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
        res.json(data);
        return;
    }
    catch (error) {
        const e = error;
        console.error('Error fetching contacts:', error);
        res.status(500).json({ error: e.message });
    }
});
/**
 * DELETE /api/admin/messages/conversation/:driverId
 * Clear message history with a driver (admin or delivery_team)
 */
router.delete('/conversation/:driverId', auth_js_1.authenticate, async (req, res) => {
    const userRole = req.user?.account?.role || req.user?.role;
    if (userRole !== 'admin' && userRole !== 'delivery_team' && userRole !== 'logistics_team') {
        res.status(403).json({ error: 'Forbidden - Admin, Delivery Team or Logistics Team access required' });
        return;
    }
    try {
        const driverId = req.params.driverId;
        const adminId = req.user?.sub;
        if (!adminId) {
            res.status(401).json({ error: 'Unauthorized' });
            return;
        }
        const result = await prisma_js_1.default.message.deleteMany({
            where: {
                adminId,
                driverId
            }
        });
        res.json({ success: true, deletedCount: result.count });
    }
    catch (error) {
        const e = error;
        console.error('Error deleting messages:', error);
        res.status(500).json({ error: e.message });
    }
});
/**
 * POST /api/driver/messages/send
 * Driver sending message to admin or delivery_team
 */
router.post('/driver/send', auth_js_1.authenticate, (0, auth_js_1.requireRole)('driver'), async (req, res) => {
    try {
        await schemaReady;
        const { content, recipientId, attachmentUrl, attachmentType, attachmentName } = req.body;
        const driverId = req.user?.sub;
        if (!driverId) {
            res.status(401).json({ error: 'Unauthorized' });
            return;
        }
        const hasText = content && content.trim();
        const hasAttachment = attachmentUrl && attachmentType;
        if (!hasText && !hasAttachment) {
            res.status(400).json({ error: 'Message content or attachment is required' });
            return;
        }
        let adminId;
        if (recipientId) {
            const recipient = await prisma_js_1.default.driver.findUnique({
                where: { id: recipientId },
                include: { account: true }
            });
            if (!recipient || !['admin', 'delivery_team', 'logistics_team'].includes(recipient.account?.role ?? '')) {
                res.status(400).json({ error: 'Invalid recipient - must be admin, delivery team or logistics team member' });
                return;
            }
            adminId = recipientId;
            console.log('[Driver Message] Sending to selected recipient:', adminId, 'role:', recipient.account?.role);
        }
        else {
            const existingConversation = await prisma_js_1.default.message.findFirst({
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
            }
            else {
                const adminAccount = await prisma_js_1.default.account.findFirst({
                    where: {
                        role: 'admin'
                    },
                    include: {
                        driver: true
                    }
                });
                if (!adminAccount || !adminAccount.driver) {
                    res.status(404).json({ error: 'No admin found' });
                    return;
                }
                adminId = adminAccount.driver.id;
                console.log('[Driver Message] Starting new conversation with admin:', adminId);
            }
        }
        const message = await prisma_js_1.default.message.create({
            data: {
                adminId: adminId,
                driverId,
                content: hasText ? content.trim() : '',
                senderRole: 'driver',
                isRead: false,
                ...(hasAttachment && {
                    attachmentUrl,
                    attachmentType,
                    attachmentName: attachmentName || null
                })
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
            hasAttachment: !!hasAttachment,
            contentPreview: hasText ? content.substring(0, 30) : '(attachment only)'
        });
        res.json({ success: true, message });
    }
    catch (error) {
        const e = error;
        console.error('Error sending message:', error);
        res.status(500).json({ error: e.message });
    }
});
/**
 * GET /api/driver/messages
 * Fetch all messages for the logged-in driver (from all contacts)
 */
router.get('/driver', auth_js_1.authenticate, (0, auth_js_1.requireRole)('driver'), async (req, res) => {
    try {
        await schemaReady;
        const driverId = req.user?.sub;
        if (!driverId) {
            res.status(401).json({ error: 'Unauthorized' });
            return;
        }
        const messages = await prisma_js_1.default.message.findMany({
            where: {
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
                attachmentUrl: true,
                attachmentType: true,
                attachmentName: true,
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
        await prisma_js_1.default.message.updateMany({
            where: {
                driverId,
                isRead: false,
                senderRole: { in: ['admin', 'delivery_team', 'logistics_team'] }
            },
            data: { isRead: true }
        });
        res.json({ success: true, messages: messages.reverse() });
    }
    catch (error) {
        const e = error;
        console.error('Error fetching driver messages:', error);
        res.status(500).json({ error: e.message });
    }
});
/**
 * GET /api/driver/messages/:contactId
 * Fetch messages for driver with a specific contact (admin or delivery_team member)
 */
router.get('/driver/:contactId', auth_js_1.authenticate, (0, auth_js_1.requireRole)('driver'), async (req, res) => {
    try {
        await schemaReady;
        const driverId = req.user?.sub;
        const contactId = req.params.contactId;
        if (!driverId) {
            res.status(401).json({ error: 'Unauthorized' });
            return;
        }
        const messages = await prisma_js_1.default.message.findMany({
            where: {
                driverId,
                adminId: contactId
            },
            select: {
                id: true,
                content: true,
                senderRole: true,
                isRead: true,
                createdAt: true,
                adminId: true,
                driverId: true,
                attachmentUrl: true,
                attachmentType: true,
                attachmentName: true,
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
        await prisma_js_1.default.message.updateMany({
            where: {
                driverId,
                adminId: contactId,
                isRead: false,
                senderRole: { in: ['admin', 'delivery_team', 'logistics_team'] }
            },
            data: { isRead: true }
        });
        res.json({ success: true, messages });
    }
    catch (error) {
        const e = error;
        console.error('Error fetching driver conversation:', error);
        res.status(500).json({ error: e.message });
    }
});
/**
 * GET /api/messages/driver/notifications/count
 * Get unread notification count for driver
 * Only counts messages RECEIVED from admin, not messages SENT by driver
 */
router.get('/driver/notifications/count', auth_js_1.authenticate, (0, auth_js_1.requireRole)('driver'), async (req, res) => {
    try {
        const driverId = req.user?.sub;
        if (!driverId) {
            res.status(401).json({ error: 'Unauthorized' });
            return;
        }
        const unreadMessages = await prisma_js_1.default.message.count({
            where: {
                driverId,
                isRead: false,
                senderRole: { in: ['admin', 'delivery_team', 'logistics_team'] }
            }
        });
        res.json({
            success: true,
            count: unreadMessages
        });
    }
    catch (error) {
        const e = error;
        console.error('Error fetching notification count:', error);
        res.status(500).json({ error: e.message });
    }
});
// GET /api/admin/messages/unread-count - Get unread message count for admin
router.get('/unread/count', auth_js_1.authenticate, (0, auth_js_1.requireRole)('admin'), async (req, res) => {
    try {
        const adminId = req.user?.sub;
        if (!adminId) {
            res.status(401).json({ error: 'Unauthorized' });
            return;
        }
        const count = await prisma_js_1.default.message.count({
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
    }
    catch (err) {
        const e = err;
        console.error('GET /api/admin/messages/unread-count', err);
        res.status(500).json({ error: 'db_error', detail: e.message });
    }
});
// POST /api/admin/messages/:messageId/read - Mark message as read
router.post('/:messageId/read', auth_js_1.authenticate, (0, auth_js_1.requireRole)('admin'), async (req, res) => {
    try {
        const messageId = req.params.messageId;
        const adminId = req.user?.sub;
        if (!adminId) {
            res.status(401).json({ error: 'Unauthorized' });
            return;
        }
        const message = await prisma_js_1.default.message.update({
            where: { id: messageId },
            data: {
                isRead: true
            }
        });
        res.json({
            success: true,
            message
        });
    }
    catch (err) {
        const e = err;
        console.error('POST /api/admin/messages/:messageId/read', err);
        res.status(500).json({ error: 'db_error', detail: e.message });
    }
});
// GET /api/admin/messages/history - Get message history with all drivers
router.get('/history/all', auth_js_1.authenticate, (0, auth_js_1.requireRole)('admin'), async (req, res) => {
    try {
        await schemaReady;
        const adminId = req.user?.sub;
        if (!adminId) {
            res.status(401).json({ error: 'Unauthorized' });
            return;
        }
        const limitRaw = req.query.limit;
        const limit = Math.min(parseInt(limitRaw ?? '', 10) || 100, 500);
        const messages = await prisma_js_1.default.message.findMany({
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
    }
    catch (err) {
        const e = err;
        console.error('GET /api/admin/messages/history/all', err);
        res.status(500).json({ error: 'db_error', detail: e.message });
    }
});
exports.default = router;
