import { Router, Request, Response } from 'express';
const router = Router();
const { authenticate, requireRole } = require('../auth');
const prisma = require('../db/prisma');

// GET /api/admin/deliveries/metadata/sample - Shows sample metadata from database
router.get('/metadata/sample', authenticate, requireRole('admin'), async (req: Request, res: Response): Promise<void> => {
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

    const sample = (deliveries as Array<{ id: string; customer: string; metadata: Record<string, unknown> | null }>).map(d => ({
      id: d.id,
      customer: d.customer,
      metadata: d.metadata,
      hasPO: d.metadata?.originalPONumber ? true : false
    }));

    res.json({
      success: true,
      message: 'Sample metadata from recent deliveries',
      data: sample,
      totalWithMetadata: (deliveries as Array<{ metadata: Record<string, unknown> | null }>).filter(d => d.metadata?.originalPONumber).length
    });
  } catch (error: unknown) {
    const e = error as { message?: string };
    console.error('[Admin Deliveries] Metadata sample error:', error);
    res.status(500).json({
      success: false,
      message: 'Error retrieving metadata sample',
      error: e.message
    });
  }
});

export default router;
