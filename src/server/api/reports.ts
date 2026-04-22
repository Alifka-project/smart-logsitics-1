import { Router, Request, Response } from 'express';
import { authenticate, requireRole, requireAnyRole } from '../auth.js';
import sapService from '../services/sapService.js';
import prisma from '../db/prisma.js';
import { sortDeliveriesIncompleteLast } from '../utils/deliveryListSort.js';

const router = Router();

type AuthUser = { sub: string; role?: string; account?: { role?: string } };

// GET /api/admin/reports
router.get('/', authenticate, requireRole('admin'), async (req: Request, res: Response): Promise<void> => {
  try {
    const { startDate, endDate, status, driverId, format } = req.query as Record<string, string | undefined>;

    const [dbDeliveries, sapDeliveriesResp] = await Promise.allSettled([
      prisma.delivery.findMany({
        select: {
          id: true,
          customer: true,
          address: true,
          phone: true,
          poNumber: true,
          lat: true,
          lng: true,
          status: true,
          items: true,
          metadata: true,
          driverSignature: true,
          customerSignature: true,
          photos: true,
          conditionNotes: true,
          deliveryNotes: true,
          deliveredBy: true,
          deliveredAt: true,
          podCompletedAt: true,
          createdAt: true,
          updatedAt: true,
          assignments: {
            take: 1,
            orderBy: { assignedAt: 'desc' },
            select: {
              driverId: true,
              status: true,
              driver: {
                select: {
                  fullName: true,
                  username: true,
                  phone: true
                }
              }
            }
          }
        },
        orderBy: { createdAt: 'desc' },
        take: 1000
      }).catch(err => {
        console.error('[Reports] Prisma query error:', err);
        return [];
      }),
      sapService.call('/Deliveries', 'get').catch(() => ({ data: { value: [] } })),
    ]);

    let deliveries: unknown[] = [];

    if (dbDeliveries.status === 'fulfilled') {
      deliveries = (dbDeliveries.value as unknown[]).map((d: unknown) => {
        const dd = d as {
          id: string; customer: string | null; address: string | null; phone: string | null;
          poNumber: string | null; lat: number | null; lng: number | null; status: string;
          items: unknown; metadata: Record<string, unknown> | null;
          driverSignature: string | null; customerSignature: string | null;
          photos: unknown[]; conditionNotes: string | null; deliveryNotes: string | null;
          deliveredBy: string | null; deliveredAt: Date | null; podCompletedAt: Date | null;
          createdAt: Date; updatedAt: Date;
          assignments: { driverId: string | null; status: string; driver?: { fullName?: string; username?: string; phone?: string } | null }[];
        };
        return {
          id: dd.id,
          customer: dd.customer,
          address: dd.address,
          phone: dd.phone,
          poNumber: dd.poNumber || (dd.metadata as Record<string, unknown>)?.originalPONumber || null,
          PONumber: dd.poNumber || (dd.metadata as Record<string, unknown>)?.originalPONumber || null,
          lat: dd.lat,
          lng: dd.lng,
          status: dd.status,
          items: dd.items,
          metadata: dd.metadata,
          driverSignature: dd.driverSignature,
          customerSignature: dd.customerSignature,
          photos: dd.photos,
          conditionNotes: dd.conditionNotes,
          deliveryNotes: dd.deliveryNotes,
          deliveredBy: dd.deliveredBy,
          deliveredAt: dd.deliveredAt,
          podCompletedAt: dd.podCompletedAt,
          hasPOD: !!(dd.driverSignature || dd.customerSignature || (dd.photos && Array.isArray(dd.photos) && dd.photos.length > 0)),
          photoCount: (dd.photos && Array.isArray(dd.photos)) ? dd.photos.length : 0,
          created_at: dd.createdAt,
          createdAt: dd.createdAt,
          created: dd.createdAt,
          updated_at: dd.updatedAt,
          updatedAt: dd.updatedAt,
          driver_id: dd.assignments?.[0]?.driverId || null,
          driverId: dd.assignments?.[0]?.driverId || null,
          assignedDriverId: dd.assignments?.[0]?.driverId || null
        };
      });
    }

    if (sapDeliveriesResp.status === 'fulfilled') {
      let sapDeliveries: unknown[] = [];
      const sapData = (sapDeliveriesResp.value as unknown as { data: unknown }).data as Record<string, unknown>;
      if (Array.isArray(sapData?.value)) {
        sapDeliveries = sapData.value as unknown[];
      } else if (Array.isArray(sapData)) {
        sapDeliveries = sapData as unknown[];
      }

      const dbDeliveryIds = new Set((deliveries as { id: string }[]).map(d => d.id));
      const newSapDeliveries = (sapDeliveries as { id?: string; ID?: string }[]).filter(d => {
        const sapId = d.id || d.ID;
        return sapId && !dbDeliveryIds.has(sapId);
      });
      deliveries = deliveries.concat(newSapDeliveries);
    }

    // Filter by date range
    if (startDate || endDate) {
      deliveries = (deliveries as Record<string, unknown>[]).filter(d => {
        const created = d.created_at || d.createdAt || d.created;
        if (!created) return false;
        const date = new Date(created as string);
        if (startDate && date < new Date(startDate)) return false;
        if (endDate && date > new Date(endDate)) return false;
        return true;
      });
    }

    // Filter by status
    if (status) {
      deliveries = (deliveries as Record<string, unknown>[]).filter(d => {
        const s = ((d.status as string) || '').toLowerCase();
        return s === status.toLowerCase();
      });
    }

    // Filter by driver
    if (driverId) {
      deliveries = (deliveries as Record<string, unknown>[]).filter(d => {
        return d.driver_id === driverId || d.driverId === driverId;
      });
    }

    sortDeliveriesIncompleteLast(deliveries as any[]);

    const deliveriesTyped = deliveries as Record<string, unknown>[];

    const deliveredDeliveries = deliveriesTyped.filter(d => {
      const s = ((d.status as string) || '').toLowerCase();
      return ['delivered', 'done', 'completed', 'delivered-with-installation', 'delivered-without-installation'].includes(s);
    });

    const stats: Record<string, unknown> = {
      total: deliveriesTyped.length,
      delivered: deliveredDeliveries.length,
      'delivered-with-installation': deliveriesTyped.filter(d => ((d.status as string) || '').toLowerCase() === 'delivered-with-installation').length,
      'delivered-without-installation': deliveriesTyped.filter(d => ((d.status as string) || '').toLowerCase() === 'delivered-without-installation').length,
      cancelled: deliveriesTyped.filter(d => ['cancelled', 'canceled'].includes(((d.status as string) || '').toLowerCase())).length,
      rejected: deliveriesTyped.filter(d => ((d.status as string) || '').toLowerCase() === 'rejected').length,
      rescheduled: deliveriesTyped.filter(d => ((d.status as string) || '').toLowerCase() === 'rescheduled').length,
      scheduled: deliveriesTyped.filter(d => ((d.status as string) || '').toLowerCase() === 'scheduled').length,
      'scheduled-confirmed': deliveriesTyped.filter(d => ((d.status as string) || '').toLowerCase() === 'scheduled-confirmed').length,
      'out-for-delivery': deliveriesTyped.filter(d => ((d.status as string) || '').toLowerCase() === 'out-for-delivery').length,
      'pgi-done': deliveriesTyped.filter(d => ((d.status as string) || '').toLowerCase() === 'pgi-done').length,
      'pickup-confirmed': deliveriesTyped.filter(d => ((d.status as string) || '').toLowerCase() === 'pickup-confirmed').length,
      pending: deliveriesTyped.filter(d => {
        const s = ((d.status as string) || '').toLowerCase();
        return !['delivered', 'done', 'completed', 'delivered-with-installation', 'delivered-without-installation', 'cancelled', 'canceled', 'rejected', 'rescheduled', 'scheduled', 'scheduled-confirmed', 'out-for-delivery', 'in-progress', 'pgi-done', 'pickup-confirmed'].includes(s);
      }).length,
      customerAccepted: deliveriesTyped.filter(d => ((d.status as string) || '').toLowerCase() === 'scheduled-confirmed').length,
      customerCancelled: deliveriesTyped.filter(d => {
        const s = ((d.status as string) || '').toLowerCase();
        return (s === 'cancelled' || s === 'canceled' || s === 'rejected') &&
               (d.actor_type === 'customer' || d.cancelled_by === 'customer');
      }).length,
      customerRescheduled: deliveriesTyped.filter(d => {
        return ((d.status as string) || '').toLowerCase() === 'rescheduled' &&
               (d.actor_type === 'customer' || d.rescheduled_by === 'customer');
      }).length,
      withPOD: deliveredDeliveries.filter(d => {
        if (d.driverSignature || d.customerSignature || (d.photos && Array.isArray(d.photos) && (d.photos as unknown[]).length > 0)) {
          return true;
        }
        return d.pod || d.proof_of_delivery || d.hasPOD ||
               (d.metadata as Record<string, unknown>)?.driverSignature ||
               (d.metadata as Record<string, unknown>)?.customerSignature ||
               ((d.metadata as Record<string, unknown>)?.photos && ((d.metadata as Record<string, unknown>).photos as unknown[]).length > 0);
      }).length,
      withoutPOD: deliveredDeliveries.filter(d => {
        const hasDedicatedPOD = d.driverSignature || d.customerSignature || (d.photos && Array.isArray(d.photos) && (d.photos as unknown[]).length > 0);
        const hasMetadataPOD = d.pod || d.proof_of_delivery || d.hasPOD ||
                              (d.metadata as Record<string, unknown>)?.driverSignature ||
                              (d.metadata as Record<string, unknown>)?.customerSignature ||
                              ((d.metadata as Record<string, unknown>)?.photos && ((d.metadata as Record<string, unknown>).photos as unknown[]).length > 0);
        return !(hasDedicatedPOD || hasMetadataPOD);
      }).length,
    };

    const total = stats.total as number;
    const delivered = stats.delivered as number;
    const cancelled = stats.cancelled as number;
    stats.successRate = total > 0 ? ((delivered / total) * 100).toFixed(2) : 0;
    stats.cancellationRate = total > 0 ? ((cancelled / total) * 100).toFixed(2) : 0;

    const dailyBreakdown: Record<string, { date: string; total: number; delivered: number; cancelled: number; rescheduled: number; pending: number }> = {};
    deliveriesTyped.forEach(d => {
      const date = ((d.created_at || d.createdAt || d.created || new Date()).toString()).split('T')[0];
      if (!dailyBreakdown[date]) {
        dailyBreakdown[date] = { date, total: 0, delivered: 0, cancelled: 0, rescheduled: 0, pending: 0 };
      }
      dailyBreakdown[date].total++;
      const s = ((d.status as string) || '').toLowerCase();
      if (['delivered', 'done', 'completed', 'delivered-with-installation', 'delivered-without-installation'].includes(s)) dailyBreakdown[date].delivered++;
      else if (['cancelled', 'canceled'].includes(s)) dailyBreakdown[date].cancelled++;
      else if (s === 'rejected') dailyBreakdown[date].cancelled++;
      else if (s === 'rescheduled') dailyBreakdown[date].rescheduled++;
      else dailyBreakdown[date].pending++;
    });

    const dailyData = Object.values(dailyBreakdown).sort((a, b) =>
      new Date(a.date).getTime() - new Date(b.date).getTime()
    );

    const statusDistribution = [
      { status: 'Delivered', count: stats.delivered as number, percentage: total > 0 ? (((stats.delivered as number) / total) * 100).toFixed(1) : 0 },
      { status: 'Out for Delivery', count: stats['out-for-delivery'] as number, percentage: total > 0 ? (((stats['out-for-delivery'] as number) / total) * 100).toFixed(1) : 0 },
      { status: 'PGI Done', count: stats['pgi-done'] as number, percentage: total > 0 ? (((stats['pgi-done'] as number) / total) * 100).toFixed(1) : 0 },
      { status: 'Pickup Confirmed', count: stats['pickup-confirmed'] as number, percentage: total > 0 ? (((stats['pickup-confirmed'] as number) / total) * 100).toFixed(1) : 0 },
      { status: 'Scheduled', count: stats.scheduled as number, percentage: total > 0 ? (((stats.scheduled as number) / total) * 100).toFixed(1) : 0 },
      { status: 'Scheduled Confirmed', count: stats['scheduled-confirmed'] as number, percentage: total > 0 ? (((stats['scheduled-confirmed'] as number) / total) * 100).toFixed(1) : 0 },
      { status: 'Cancelled/Rejected', count: (stats.cancelled as number) + (stats.rejected as number), percentage: total > 0 ? ((((stats.cancelled as number) + (stats.rejected as number)) / total) * 100).toFixed(1) : 0 },
      { status: 'Rescheduled', count: stats.rescheduled as number, percentage: total > 0 ? (((stats.rescheduled as number) / total) * 100).toFixed(1) : 0 },
      { status: 'Pending', count: stats.pending as number, percentage: total > 0 ? (((stats.pending as number) / total) * 100).toFixed(1) : 0 },
    ].filter(s => s.count > 0);

    if (format === 'csv') {
      const csvRows = [
        ['ID', 'Customer', 'Address', 'Status', 'Driver ID', 'Customer Response', 'POD Status', 'Photo Count', 'Has Signatures', 'Delivered At', 'Created At', 'Updated At'],
        ...deliveriesTyped.map(d => {
          const st = ((d.status as string) || '').toLowerCase();
          let customerResponse = 'Pending';
          if (st === 'scheduled-confirmed') customerResponse = 'Accepted';
          else if ((st === 'cancelled' || st === 'canceled' || st === 'rejected') &&
                   (d.actor_type === 'customer' || d.cancelled_by === 'customer')) {
            customerResponse = 'Cancelled';
          } else if (st === 'rescheduled' && (d.actor_type === 'customer' || d.rescheduled_by === 'customer')) {
            customerResponse = 'Rescheduled';
          }

          let podStatus = 'No POD';
          let hasSignatures = 'No';
          let photoCount = 0;

          if (['delivered', 'done', 'completed', 'delivered-with-installation', 'delivered-without-installation'].includes(st)) {
            const hasDedicatedPOD = d.driverSignature || d.customerSignature || (d.photos && Array.isArray(d.photos) && (d.photos as unknown[]).length > 0);
            const hasMetadataPOD = (d.metadata as Record<string, unknown>)?.driverSignature ||
                                  (d.metadata as Record<string, unknown>)?.customerSignature ||
                                  ((d.metadata as Record<string, unknown>)?.photos && ((d.metadata as Record<string, unknown>).photos as unknown[]).length > 0) ||
                                  d.pod || d.proof_of_delivery || d.hasPOD;

            if (hasDedicatedPOD || hasMetadataPOD) {
              podStatus = 'With POD';
            }

            if (d.driverSignature && d.customerSignature) {
              hasSignatures = 'Both';
            } else if (d.driverSignature || d.customerSignature) {
              hasSignatures = 'Partial';
            }

            if (d.photos && Array.isArray(d.photos)) {
              photoCount = (d.photos as unknown[]).length;
            } else if ((d.metadata as Record<string, unknown>)?.photos && Array.isArray((d.metadata as Record<string, unknown>).photos)) {
              photoCount = ((d.metadata as Record<string, unknown>).photos as unknown[]).length;
            }
          }

          return [
            d.id || (d as Record<string, unknown>).ID || '',
            d.customer || (d as Record<string, unknown>).Customer || '',
            d.address || (d as Record<string, unknown>).Address || '',
            d.status || (d as Record<string, unknown>).Status || '',
            d.driver_id || d.driverId || '',
            customerResponse,
            podStatus,
            photoCount,
            hasSignatures,
            d.deliveredAt || d.delivered_at || '',
            d.created_at || d.createdAt || '',
            d.updated_at || d.updatedAt || ''
          ];
        })
      ];

      const csv = csvRows.map(row =>
        row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',')
      ).join('\n');

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename=deliveries-report-${Date.now()}.csv`);
      res.send(csv); return;
    }

    res.json({
      stats,
      dailyBreakdown: dailyData,
      statusDistribution,
      deliveries,
      filters: { startDate, endDate, status, driverId },
      generatedAt: new Date().toISOString()
    });
  } catch (err: unknown) {
    const e = err as { message?: string };
    console.error('admin/reports error', err);
    res.status(500).json({ error: 'report_generation_failed', detail: e.message });
  }
});

// Helper function to generate HTML report with embedded images
function generateHTMLReportWithImages(
  deliveries: Record<string, unknown>[],
  stats: Record<string, unknown>,
  dailyData: unknown[],
  driverData: unknown[]
): string {
  const timestamp = new Date().toLocaleString();

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>POD Report with Images - ${timestamp}</title>
    <style>
        body { font-family: 'Electrolux Sans', 'DM Sans', 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; margin: 20px; background: #f5f5f5; }
        .header { background: #032145; color: white; padding: 20px; border-radius: 8px; margin-bottom: 20px; }
        .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 15px; margin-bottom: 20px; }
        .stat-card { background: white; padding: 15px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
        .stat-value { font-size: 28px; font-weight: bold; color: #032145; }
        .stat-label { font-size: 14px; color: #666; margin-top: 5px; }
        .delivery { background: white; margin-bottom: 20px; padding: 20px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); page-break-inside: avoid; }
        .delivery-header { border-bottom: 2px solid #032145; padding-bottom: 10px; margin-bottom: 15px; }
        .delivery-id { font-size: 18px; font-weight: bold; color: #032145; }
        .delivery-info { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 10px; margin-bottom: 15px; }
        .info-item { padding: 8px 0; }
        .info-label { font-weight: bold; color: #666; font-size: 12px; }
        .info-value { color: #333; font-size: 14px; margin-top: 3px; }
        .pod-section { margin-top: 20px; padding-top: 20px; border-top: 1px solid #e0e0e0; }
        .pod-title { font-size: 16px; font-weight: bold; margin-bottom: 15px; color: #032145; }
        .signatures { display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 20px; margin-bottom: 20px; }
        .signature-box { text-align: center; }
        .signature-label { font-weight: bold; margin-bottom: 10px; color: #666; }
        .signature-img { max-width: 100%; height: auto; border: 1px solid #ddd; border-radius: 4px; background: white; }
        .photos { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 15px; margin-top: 15px; }
        .photo-item { text-align: center; }
        .photo-img { width: 100%; height: auto; border: 1px solid #ddd; border-radius: 4px; max-width: 300px; }
        .badge { display: inline-block; padding: 4px 12px; border-radius: 12px; font-size: 12px; font-weight: bold; }
        .badge-success { background: #22c55e; color: white; }
        .badge-warning { background: #f59e0b; color: white; }
        .badge-danger { background: #ef4444; color: white; }
        .no-data { color: #999; font-style: italic; }
        @media print { .delivery { page-break-inside: avoid; } }
    </style>
</head>
<body>
    <div class="header">
        <h1>📸 POD Report (Proof of Delivery)</h1>
        <p>Generated: ${timestamp}</p>
    </div>

    <div class="stats">
        <div class="stat-card">
            <div class="stat-value">${stats.totalDelivered || 0}</div>
            <div class="stat-label">Total Delivered</div>
        </div>
        <div class="stat-card">
            <div class="stat-value">${stats.withPOD || 0}</div>
            <div class="stat-label">With POD ✓</div>
        </div>
        <div class="stat-card">
            <div class="stat-value">${stats.withoutPOD || 0}</div>
            <div class="stat-label">Without POD</div>
        </div>
        <div class="stat-card">
            <div class="stat-value">${stats.totalPhotos || 0}</div>
            <div class="stat-label">Total Photos</div>
        </div>
        <div class="stat-card">
            <div class="stat-value">${stats.podCompletionRate || 0}%</div>
            <div class="stat-label">POD Completion Rate</div>
        </div>
    </div>

    <h2 style="color: #032145; margin: 30px 0 20px 0;">Delivery Details</h2>

    ${deliveries.map(d => `
        <div class="delivery">
            <div class="delivery-header">
                <div class="delivery-id">
                    Delivery #${d.id}
                    ${d.hasPOD ? '<span class="badge badge-success">With POD</span>' : '<span class="badge badge-danger">No POD</span>'}
                    ${d.podQuality !== 'None' ? `<span class="badge badge-warning">${d.podQuality}</span>` : ''}
                </div>
            </div>

            <div class="delivery-info">
                <div class="info-item">
                    <div class="info-label">Customer</div>
                    <div class="info-value">${d.customer || 'N/A'}</div>
                </div>
                <div class="info-item">
                    <div class="info-label">PO Number</div>
                    <div class="info-value">${d.poNumber || 'N/A'}</div>
                </div>
                <div class="info-item">
                    <div class="info-label">Address</div>
                    <div class="info-value">${d.address || 'N/A'}</div>
                </div>
                <div class="info-item">
                    <div class="info-label">Phone</div>
                    <div class="info-value">${d.phone || 'N/A'}</div>
                </div>
                <div class="info-item">
                    <div class="info-label">Driver</div>
                    <div class="info-value">${d.driverName || d.deliveredBy || 'N/A'}</div>
                </div>
                <div class="info-item">
                    <div class="info-label">Delivered At</div>
                    <div class="info-value">${d.deliveredAt ? new Date(d.deliveredAt as string).toLocaleString() : 'N/A'}</div>
                </div>
                <div class="info-item">
                    <div class="info-label">Items</div>
                    <div class="info-value">${d.items || 'N/A'}</div>
                </div>
                <div class="info-item">
                    <div class="info-label">Status</div>
                    <div class="info-value">${d.status || 'N/A'}</div>
                </div>
            </div>

            ${d.conditionNotes ? `
                <div class="info-item">
                    <div class="info-label">Notes</div>
                    <div class="info-value">${d.conditionNotes}</div>
                </div>
            ` : ''}

            ${d.hasPOD ? `
                <div class="pod-section">
                    <div class="pod-title">Proof of Delivery</div>

                    ${(d.hasDriverSignature || d.hasCustomerSignature) ? `
                        <div class="signatures">
                            ${d.hasDriverSignature ? `
                                <div class="signature-box">
                                    <div class="signature-label">Driver Signature</div>
                                    <img src="${d.driverSignature || ''}" class="signature-img" alt="Driver Signature" />
                                </div>
                            ` : ''}
                            ${d.hasCustomerSignature ? `
                                <div class="signature-box">
                                    <div class="signature-label">Customer Signature</div>
                                    <img src="${d.customerSignature || ''}" class="signature-img" alt="Customer Signature" />
                                </div>
                            ` : ''}
                        </div>
                    ` : ''}

                    ${(d.photoCount as number) > 0 ? `
                        <div>
                            <div class="signature-label" style="margin-bottom: 10px;">Photos (${d.photoCount})</div>
                            <div class="photos">
                                ${((d.photos as unknown[]) || []).map((photo: unknown, idx: number) => {
                                  const photoData = typeof photo === 'string' ? photo : ((photo as Record<string, unknown>)?.data || photo);
                                  const photoName = typeof photo === 'object' ? (photo as Record<string, unknown>)?.name : `photo-${idx + 1}`;
                                  return `
                                    <div class="photo-item">
                                        <img src="${photoData}" class="photo-img" alt="${photoName || 'Photo'}" />
                                        <div style="font-size: 12px; color: #666; margin-top: 5px;">${photoName || `Photo ${idx + 1}`}</div>
                                    </div>
                                  `;
                                }).join('')}
                            </div>
                        </div>
                    ` : ''}
                </div>
            ` : '<div class="no-data">No POD data available for this delivery</div>'}
        </div>
    `).join('')}

    <div style="margin-top: 40px; padding: 20px; background: white; border-radius: 8px; text-align: center; color: #666;">
        <p>End of Report - Generated by Electrolux Smart Logistics System</p>
    </div>
</body>
</html>`;

  return html;
}

// Shared handler for POD report — callable from both GET (query params) and
// POST (body). POST is used when the client has a long list of filtered IDs
// that would blow past practical URL length limits.
async function handlePodReport(req: Request, res: Response): Promise<void> {
  try {
    // Accept params from either query (GET) or body (POST).
    const src: Record<string, unknown> = req.method === 'POST'
      ? (req.body as Record<string, unknown>) ?? {}
      : (req.query as Record<string, unknown>);

    const startDate   = typeof src.startDate === 'string' ? src.startDate : undefined;
    const endDate     = typeof src.endDate === 'string' ? src.endDate : undefined;
    const podStatus   = typeof src.podStatus === 'string' ? src.podStatus : undefined;
    const format      = typeof src.format === 'string' ? src.format : undefined;
    // ids may arrive as an array (POST body) or a comma-separated string (GET).
    let ids: string[] = [];
    if (Array.isArray(src.ids)) {
      ids = (src.ids as unknown[]).filter((v): v is string => typeof v === 'string' && v.trim().length > 0);
    } else if (typeof src.ids === 'string' && src.ids.trim()) {
      ids = src.ids.split(',').map(s => s.trim()).filter(Boolean);
    }

    console.log(`[POD Report] Generating POD report... ids=${ids.length}, dateRange=${startDate ?? '-'}..${endDate ?? '-'}, podStatus=${podStatus ?? '-'}`);

    let parsedStartDate: Date | undefined;
    let parsedEndDate: Date | undefined;
    if (startDate) {
      parsedStartDate = new Date(startDate);
      parsedStartDate.setHours(0, 0, 0, 0);
    }
    if (endDate) {
      parsedEndDate = new Date(endDate);
      parsedEndDate.setHours(23, 59, 59, 999);
    }

    const deliveries = await prisma.delivery.findMany({
      where: {
        // When ids are provided, narrow to those specific deliveries (client
        // has already applied its visible filters). Otherwise, fall back to
        // all delivered orders in the date window.
        ...(ids.length > 0 ? { id: { in: ids } } : {}),
        status: {
          in: [
            'delivered',
            'delivered-with-installation',
            'delivered-without-installation',
            'completed',
            'done',
            'pod-completed',
            'finished',
          ]
        },
        ...(parsedStartDate || parsedEndDate ? {
          OR: [
            {
              deliveredAt: {
                ...(parsedStartDate ? { gte: parsedStartDate } : {}),
                ...(parsedEndDate ? { lte: parsedEndDate } : {})
              }
            },
            {
              deliveredAt: null,
              createdAt: {
                ...(parsedStartDate ? { gte: parsedStartDate } : {}),
                ...(parsedEndDate ? { lte: parsedEndDate } : {})
              }
            }
          ]
        } : {})
      },
      include: {
        assignments: {
          take: 1,
          orderBy: { assignedAt: 'desc' },
          include: {
            driver: {
              select: {
                id: true,
                fullName: true,
                username: true,
                phone: true
              }
            }
          }
        }
      },
      orderBy: { deliveredAt: 'desc' },
      take: 500
    });

    console.log(`[POD Report] Found ${deliveries.length} delivered orders`);

    const processedDeliveries = deliveries.map(d => {
      const hasPOD = !!(d.driverSignature || d.customerSignature || (d.photos && Array.isArray(d.photos) && d.photos.length > 0));
      const hasDriverSignature = !!d.driverSignature;
      const hasCustomerSignature = !!d.customerSignature;
      const photoCount = (d.photos && Array.isArray(d.photos)) ? d.photos.length : 0;
      const hasPhotos = photoCount > 0;

      let podQuality = 'None';
      if (hasPOD) {
        if (hasDriverSignature && hasCustomerSignature && hasPhotos) {
          podQuality = 'Complete';
        } else if ((hasDriverSignature || hasCustomerSignature) && hasPhotos) {
          podQuality = 'Good';
        } else if (hasDriverSignature || hasCustomerSignature || hasPhotos) {
          podQuality = 'Partial';
        }
      }

      return {
        id: d.id,
        customer: d.customer,
        address: d.address,
        phone: d.phone,
        items: d.items,
        status: d.status,
        poNumber: d.poNumber,
        hasPOD,
        podQuality,
        hasDriverSignature,
        hasCustomerSignature,
        hasPhotos,
        photoCount,
        conditionNotes: d.conditionNotes,
        deliveryNotes: d.deliveryNotes,
        driverSignature: d.driverSignature,
        customerSignature: d.customerSignature,
        photos: d.photos,
        deliveredBy: d.deliveredBy,
        deliveredAt: d.deliveredAt,
        podCompletedAt: d.podCompletedAt,
        driverName: d.assignments?.[0]?.driver?.fullName || d.assignments?.[0]?.driver?.username || null,
        driverPhone: d.assignments?.[0]?.driver?.phone || null,
        createdAt: d.createdAt,
        updatedAt: d.updatedAt
      };
    });

    let filteredDeliveries = processedDeliveries;
    if (podStatus === 'with-pod') {
      filteredDeliveries = processedDeliveries.filter(d => d.hasPOD);
    } else if (podStatus === 'without-pod') {
      filteredDeliveries = processedDeliveries.filter(d => !d.hasPOD);
    }

    const stats = {
      totalDelivered: processedDeliveries.length,
      withPOD: processedDeliveries.filter(d => d.hasPOD).length,
      withoutPOD: processedDeliveries.filter(d => !d.hasPOD).length,
      completePOD: processedDeliveries.filter(d => d.podQuality === 'Complete').length,
      goodPOD: processedDeliveries.filter(d => d.podQuality === 'Good').length,
      partialPOD: processedDeliveries.filter(d => d.podQuality === 'Partial').length,
      withDriverSignature: processedDeliveries.filter(d => d.hasDriverSignature).length,
      withCustomerSignature: processedDeliveries.filter(d => d.hasCustomerSignature).length,
      withPhotos: processedDeliveries.filter(d => d.hasPhotos).length,
      totalPhotos: processedDeliveries.reduce((sum, d) => sum + d.photoCount, 0),
      podCompletionRate: processedDeliveries.length > 0
        ? ((processedDeliveries.filter(d => d.hasPOD).length / processedDeliveries.length) * 100).toFixed(2)
        : 0
    };

    const dailyBreakdown: Record<string, { date: string; total: number; withPOD: number; withoutPOD: number; complete: number; good: number; partial: number; totalPhotos: number }> = {};
    processedDeliveries.forEach(d => {
      const rawDate = (d.deliveredAt || d.createdAt) as Date;
      const date = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Dubai', year: 'numeric', month: '2-digit', day: '2-digit'
      }).format(rawDate instanceof Date ? rawDate : new Date(rawDate));
      if (!dailyBreakdown[date]) {
        dailyBreakdown[date] = {
          date,
          total: 0,
          withPOD: 0,
          withoutPOD: 0,
          complete: 0,
          good: 0,
          partial: 0,
          totalPhotos: 0
        };
      }
      dailyBreakdown[date].total++;
      if (d.hasPOD) dailyBreakdown[date].withPOD++;
      else dailyBreakdown[date].withoutPOD++;
      if (d.podQuality === 'Complete') dailyBreakdown[date].complete++;
      if (d.podQuality === 'Good') dailyBreakdown[date].good++;
      if (d.podQuality === 'Partial') dailyBreakdown[date].partial++;
      dailyBreakdown[date].totalPhotos += d.photoCount;
    });

    const dailyData = Object.values(dailyBreakdown).sort((a, b) =>
      new Date(a.date).getTime() - new Date(b.date).getTime()
    );

    const driverBreakdown: Record<string, { driverName: string; total: number; withPOD: number; withoutPOD: number; totalPhotos: number }> = {};
    processedDeliveries.forEach(d => {
      const driverName = d.driverName || 'Unassigned';
      if (!driverBreakdown[driverName]) {
        driverBreakdown[driverName] = {
          driverName,
          total: 0,
          withPOD: 0,
          withoutPOD: 0,
          totalPhotos: 0
        };
      }
      driverBreakdown[driverName].total++;
      if (d.hasPOD) driverBreakdown[driverName].withPOD++;
      else driverBreakdown[driverName].withoutPOD++;
      driverBreakdown[driverName].totalPhotos += d.photoCount;
    });

    const driverData = Object.values(driverBreakdown).sort((a, b) => b.total - a.total);

    if (format === 'csv') {
      const csvRows = [
        [
          'Delivery ID',
          'PO Number',
          'Customer',
          'Address',
          'Phone',
          'Items',
          'Status',
          'POD Status',
          'POD Quality',
          'Driver Signature',
          'Customer Signature',
          'Photos Count',
          'Has Photos',
          'Condition Notes',
          'Delivered By',
          'Driver Name',
          'Delivered At',
          'POD Completed At',
          'Created At'
        ],
        ...filteredDeliveries.map(d => [
          d.id,
          d.poNumber || '',
          d.customer || '',
          d.address || '',
          d.phone || '',
          d.items || '',
          d.status,
          d.hasPOD ? 'YES' : 'NO',
          d.podQuality,
          d.hasDriverSignature ? 'YES' : 'NO',
          d.hasCustomerSignature ? 'YES' : 'NO',
          d.photoCount,
          d.hasPhotos ? 'YES' : 'NO',
          d.conditionNotes || '',
          d.deliveredBy || '',
          d.driverName || '',
          d.deliveredAt ? new Date(d.deliveredAt).toISOString() : '',
          d.podCompletedAt ? new Date(d.podCompletedAt).toISOString() : '',
          d.createdAt ? new Date(d.createdAt).toISOString() : ''
        ])
      ];

      const csv = csvRows.map(row =>
        row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',')
      ).join('\n');

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename=pod-report-${Date.now()}.csv`);
      res.send(csv); return;
    }

    if (format === 'html') {
      const html = generateHTMLReportWithImages(
        filteredDeliveries as unknown as Record<string, unknown>[],
        stats as unknown as Record<string, unknown>,
        dailyData,
        driverData
      );
      res.setHeader('Content-Type', 'text/html');
      res.setHeader('Content-Disposition', `attachment; filename=pod-report-with-images-${Date.now()}.html`);
      res.send(html); return;
    }

    res.json({
      success: true,
      stats,
      dailyBreakdown: dailyData,
      driverBreakdown: driverData,
      deliveries: filteredDeliveries,
      filters: {
        startDate: startDate || null,
        endDate: endDate || null,
        podStatus: podStatus || 'all'
      },
      generatedAt: new Date().toISOString()
    });

    console.log(`[POD Report] ✓ Report generated: ${filteredDeliveries.length} deliveries, ${stats.withPOD} with POD, ${stats.withoutPOD} without POD`);

  } catch (err: unknown) {
    const e = err as { message?: string };
    console.error('[POD Report] Error:', err);
    res.status(500).json({
      error: 'pod_report_generation_failed',
      detail: e.message
    });
  }
}

// GET /api/admin/reports/pod - Dedicated POD Report (query-param filters)
router.get('/pod', authenticate, requireAnyRole('admin', 'delivery_team'), handlePodReport);

// POST /api/admin/reports/pod - Filter-aware POD Report.
// Use this when the client has many filtered delivery IDs that would exceed
// practical URL length limits. Body: { ids?: string[], startDate?, endDate?, podStatus?, format? }.
router.post('/pod', authenticate, requireAnyRole('admin', 'delivery_team'), handlePodReport);

export default router;
