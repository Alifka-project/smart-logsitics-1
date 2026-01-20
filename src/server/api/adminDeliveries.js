const express = require('express');
const router = express.Router();
const { authenticate, requireRole } = require('../auth');
const prisma = require('../db/prisma');

// GET /api/admin/deliveries/metadata/sample - Shows sample metadata from database
router.get('/metadata/sample', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const deliveries = await prisma.delivery.findMany({
      select: {
        id: true,
        customer: true,
        metadata: true
      },
      take: 10,
      orderBy: { createdAt: 'desc' }
    });

    const sample = deliveries.map(d => ({
      id: d.id,
      customer: d.customer,
      metadata: d.metadata,
      hasPO: d.metadata?.originalPONumber ? true : false
    }));

    res.json({
      success: true,
      message: 'Sample metadata from recent deliveries',
      data: sample,
      totalWithMetadata: deliveries.filter(d => d.metadata?.originalPONumber).length
    });
  } catch (error) {
    console.error('[Admin Deliveries] Metadata sample error:', error);
    res.status(500).json({
      success: false,
      message: 'Error retrieving metadata sample',
      error: error.message
    });
  }
});

module.exports = router;
