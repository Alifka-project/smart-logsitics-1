// Express router for admin-driver messaging endpoints
const express = require('express');
const router = express.Router();
const { authenticate, requireRole } = require('../auth');
const prisma = require('../db/prisma');

// GET /api/admin/messages/:driverId - Get messages with a specific driver
router.get('/:driverId', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const { driverId } = req.params;
    const { limit = 50, offset = 0 } = req.query;

    // TODO: Create messages table in Prisma schema
    // For now, return empty array with structure
    const messages = [];
    
    // Future implementation:
    // const messages = await prisma.message.findMany({
    //   where: {
    //     OR: [
    //       { driverId, fromRole: 'admin' },
    //       { driverId, fromRole: 'driver' }
    //     ]
    //   },
    //   orderBy: { createdAt: 'desc' },
    //   take: parseInt(limit),
    //   skip: parseInt(offset)
    // });

    res.json({ 
      messages: messages.reverse(), // Show oldest first
      hasMore: false 
    });
  } catch (err) {
    console.error('GET /api/admin/messages/:driverId', err);
    res.status(500).json({ error: 'db_error', detail: err.message });
  }
});

// POST /api/admin/messages/send - Send message to driver
router.post('/send', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const { driverId, message, type = 'text' } = req.body;

    if (!driverId || !message) {
      return res.status(400).json({ error: 'driverId and message required' });
    }

    // Verify driver exists
    const driver = await prisma.driver.findUnique({
      where: { id: driverId }
    });

    if (!driver) {
      return res.status(404).json({ error: 'driver_not_found' });
    }

    // TODO: Save message to database
    // For now, return success
    const savedMessage = {
      id: Date.now().toString(),
      driverId,
      fromRole: 'admin',
      message,
      type,
      read: false,
      createdAt: new Date().toISOString()
    };

    // Future implementation:
    // const savedMessage = await prisma.message.create({
    //   data: {
    //     driverId,
    //     fromRole: 'admin',
    //     message,
    //     type,
    //     read: false
    //   }
    // });

    res.json({ 
      success: true, 
      message: savedMessage 
    });
  } catch (err) {
    console.error('POST /api/admin/messages/send', err);
    res.status(500).json({ error: 'db_error', detail: err.message });
  }
});

// GET /api/admin/messages/unread-count - Get unread message count
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

