const express = require('express');
const router = express.Router();
const { authenticate, requireRole } = require('../auth');
const sapService = require('../../../services/sapService');
const prisma = require('../db/prisma');

// GET /api/admin/reports
router.get('/', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const { startDate, endDate, status, driverId, format } = req.query;

    // Fetch from database first (uploaded deliveries), then fallback to SAP
    const [dbDeliveries, sapDeliveriesResp] = await Promise.allSettled([
      prisma.delivery.findMany({
        include: {
          assignments: {
            include: {
              driver: {
                include: {
                  account: true
                }
              }
            }
          }
        },
        orderBy: { createdAt: 'desc' }
      }).catch(err => {
        console.error('[Reports] Prisma query error:', err);
        return []; // Return empty array on error
      }),
      sapService.call('/Deliveries', 'get').catch(() => ({ data: { value: [] } })),
    ]);

    // Combine database deliveries with SAP deliveries (avoid duplicates)
    let deliveries = [];
    
    // Add database deliveries (formatted for compatibility)
    if (dbDeliveries.status === 'fulfilled') {
      deliveries = dbDeliveries.value.map(d => ({
        id: d.id,
        customer: d.customer,
        address: d.address,
        phone: d.phone,
        lat: d.lat,
        lng: d.lng,
        status: d.status,
        items: d.items,
        metadata: d.metadata,
        // POD data from dedicated fields
        driverSignature: d.driverSignature,
        customerSignature: d.customerSignature,
        photos: d.photos, // Array of base64 images
        conditionNotes: d.conditionNotes,
        deliveryNotes: d.deliveryNotes,
        deliveredBy: d.deliveredBy,
        deliveredAt: d.deliveredAt,
        podCompletedAt: d.podCompletedAt,
        hasPOD: !!(d.driverSignature || d.customerSignature || (d.photos && Array.isArray(d.photos) && d.photos.length > 0)),
        photoCount: (d.photos && Array.isArray(d.photos)) ? d.photos.length : 0,
        // Standard fields
        created_at: d.createdAt,
        createdAt: d.createdAt,
        created: d.createdAt,
        updated_at: d.updatedAt,
        updatedAt: d.updatedAt,
        driver_id: d.assignments?.[0]?.driverId || null,
        driverId: d.assignments?.[0]?.driverId || null,
        assignedDriverId: d.assignments?.[0]?.driverId || null
      }));
    }

    // Add SAP deliveries (if any) that don't exist in database
    if (sapDeliveriesResp.status === 'fulfilled') {
      let sapDeliveries = [];
      if (Array.isArray(sapDeliveriesResp.value.data?.value)) {
        sapDeliveries = sapDeliveriesResp.value.data.value;
      } else if (Array.isArray(sapDeliveriesResp.value.data)) {
        sapDeliveries = sapDeliveriesResp.value.data;
      }
      
      // Only add SAP deliveries that aren't already in database
      const dbDeliveryIds = new Set(deliveries.map(d => d.id));
      const newSapDeliveries = sapDeliveries.filter(d => {
        const sapId = d.id || d.ID;
        return sapId && !dbDeliveryIds.has(sapId);
      });
      deliveries = deliveries.concat(newSapDeliveries);
    }

    // Filter by date range
    if (startDate || endDate) {
      deliveries = deliveries.filter(d => {
        const created = d.created_at || d.createdAt || d.created;
        if (!created) return false;
        const date = new Date(created);
        if (startDate && date < new Date(startDate)) return false;
        if (endDate && date > new Date(endDate)) return false;
        return true;
      });
    }

    // Filter by status
    if (status) {
      deliveries = deliveries.filter(d => {
        const s = (d.status || '').toLowerCase();
        return s === status.toLowerCase();
      });
    }

    // Filter by driver
    if (driverId) {
      deliveries = deliveries.filter(d => {
        return d.driver_id === driverId || d.driverId === driverId;
      });
    }

    // Calculate statistics
    const deliveredDeliveries = deliveries.filter(d => {
      const s = (d.status || '').toLowerCase();
      return ['delivered', 'done', 'completed', 'delivered-with-installation', 'delivered-without-installation'].includes(s);
    });
    
    const stats = {
      total: deliveries.length,
      delivered: deliveredDeliveries.length,
      'delivered-with-installation': deliveries.filter(d => (d.status || '').toLowerCase() === 'delivered-with-installation').length,
      'delivered-without-installation': deliveries.filter(d => (d.status || '').toLowerCase() === 'delivered-without-installation').length,
      cancelled: deliveries.filter(d => ['cancelled', 'canceled'].includes((d.status || '').toLowerCase())).length,
      rejected: deliveries.filter(d => (d.status || '').toLowerCase() === 'rejected').length,
      rescheduled: deliveries.filter(d => (d.status || '').toLowerCase() === 'rescheduled').length,
      scheduled: deliveries.filter(d => (d.status || '').toLowerCase() === 'scheduled').length,
      'scheduled-confirmed': deliveries.filter(d => (d.status || '').toLowerCase() === 'scheduled-confirmed').length,
      'out-for-delivery': deliveries.filter(d => (d.status || '').toLowerCase() === 'out-for-delivery').length,
      pending: deliveries.filter(d => {
        const s = (d.status || '').toLowerCase();
        return !['delivered', 'done', 'completed', 'delivered-with-installation', 'delivered-without-installation', 'cancelled', 'canceled', 'rejected', 'rescheduled', 'scheduled', 'scheduled-confirmed', 'out-for-delivery', 'in-progress'].includes(s);
      }).length,
      // Customer response tracking
      customerAccepted: deliveries.filter(d => (d.status || '').toLowerCase() === 'scheduled-confirmed').length,
      customerCancelled: deliveries.filter(d => {
        const s = (d.status || '').toLowerCase();
        return (s === 'cancelled' || s === 'canceled' || s === 'rejected') && 
               (d.actor_type === 'customer' || d.cancelled_by === 'customer');
      }).length,
      customerRescheduled: deliveries.filter(d => {
        return (d.status || '').toLowerCase() === 'rescheduled' && 
               (d.actor_type === 'customer' || d.rescheduled_by === 'customer');
      }).length,
      // POD tracking
      withPOD: deliveredDeliveries.filter(d => {
        // Check dedicated POD fields first
        if (d.driverSignature || d.customerSignature || (d.photos && Array.isArray(d.photos) && d.photos.length > 0)) {
          return true;
        }
        // Fallback to metadata or legacy fields
        return d.pod || d.proof_of_delivery || d.hasPOD ||
               (d.metadata?.driverSignature) || (d.metadata?.customerSignature) ||
               (d.metadata?.photos && d.metadata?.photos.length > 0);
      }).length,
      withoutPOD: deliveredDeliveries.filter(d => {
        // Check dedicated POD fields first
        const hasDedicatedPOD = d.driverSignature || d.customerSignature || (d.photos && Array.isArray(d.photos) && d.photos.length > 0);
        // Check metadata or legacy fields
        const hasMetadataPOD = d.pod || d.proof_of_delivery || d.hasPOD ||
                              (d.metadata?.driverSignature) || (d.metadata?.customerSignature) ||
                              (d.metadata?.photos && d.metadata?.photos.length > 0);
        return !(hasDedicatedPOD || hasMetadataPOD);
      }).length,
    };

    // Calculate success rate
    stats.successRate = stats.total > 0 ? ((stats.delivered / stats.total) * 100).toFixed(2) : 0;
    stats.cancellationRate = stats.total > 0 ? ((stats.cancelled / stats.total) * 100).toFixed(2) : 0;

    // Daily breakdown
    const dailyBreakdown = {};
    deliveries.forEach(d => {
      const date = (d.created_at || d.createdAt || d.created || new Date()).toString().split('T')[0];
      if (!dailyBreakdown[date]) {
        dailyBreakdown[date] = { date, total: 0, delivered: 0, cancelled: 0, rescheduled: 0, pending: 0 };
      }
      dailyBreakdown[date].total++;
      const s = (d.status || '').toLowerCase();
      if (['delivered', 'done', 'completed', 'delivered-with-installation', 'delivered-without-installation'].includes(s)) dailyBreakdown[date].delivered++;
      else if (['cancelled', 'canceled'].includes(s)) dailyBreakdown[date].cancelled++;
      else if (s === 'rejected') dailyBreakdown[date].cancelled++; // Count rejected with cancelled
      else if (s === 'rescheduled') dailyBreakdown[date].rescheduled++;
      else dailyBreakdown[date].pending++;
    });

    const dailyData = Object.values(dailyBreakdown).sort((a, b) => 
      new Date(a.date) - new Date(b.date)
    );

    // Status distribution
    const statusDistribution = [
      { status: 'Delivered', count: stats.delivered, percentage: stats.total > 0 ? ((stats.delivered / stats.total) * 100).toFixed(1) : 0 },
      { status: 'Out for Delivery', count: stats['out-for-delivery'], percentage: stats.total > 0 ? ((stats['out-for-delivery'] / stats.total) * 100).toFixed(1) : 0 },
      { status: 'Scheduled', count: stats.scheduled, percentage: stats.total > 0 ? ((stats.scheduled / stats.total) * 100).toFixed(1) : 0 },
      { status: 'Scheduled Confirmed', count: stats['scheduled-confirmed'], percentage: stats.total > 0 ? ((stats['scheduled-confirmed'] / stats.total) * 100).toFixed(1) : 0 },
      { status: 'Cancelled/Rejected', count: stats.cancelled + stats.rejected, percentage: stats.total > 0 ? (((stats.cancelled + stats.rejected) / stats.total) * 100).toFixed(1) : 0 },
      { status: 'Rescheduled', count: stats.rescheduled, percentage: stats.total > 0 ? ((stats.rescheduled / stats.total) * 100).toFixed(1) : 0 },
      { status: 'Pending', count: stats.pending, percentage: stats.total > 0 ? ((stats.pending / stats.total) * 100).toFixed(1) : 0 },
    ].filter(s => s.count > 0); // Only show statuses with deliveries

    // If format is CSV, return CSV
    if (format === 'csv') {
      const csvRows = [
        ['ID', 'Customer', 'Address', 'Status', 'Driver ID', 'Customer Response', 'POD Status', 'Photo Count', 'Has Signatures', 'Delivered At', 'Created At', 'Updated At'],
        ...deliveries.map(d => {
          const status = (d.status || '').toLowerCase();
          let customerResponse = 'Pending';
          if (status === 'scheduled-confirmed') customerResponse = 'Accepted';
          else if ((status === 'cancelled' || status === 'canceled' || status === 'rejected') && 
                   (d.actor_type === 'customer' || d.cancelled_by === 'customer')) {
            customerResponse = 'Cancelled';
          } else if (status === 'rescheduled' && (d.actor_type === 'customer' || d.rescheduled_by === 'customer')) {
            customerResponse = 'Rescheduled';
          }
          
          let podStatus = 'No POD';
          let hasSignatures = 'No';
          let photoCount = 0;
          
          if (['delivered', 'done', 'completed', 'delivered-with-installation', 'delivered-without-installation'].includes(status)) {
            // Check dedicated POD fields
            const hasDedicatedPOD = d.driverSignature || d.customerSignature || (d.photos && Array.isArray(d.photos) && d.photos.length > 0);
            const hasMetadataPOD = (d.metadata?.driverSignature) || (d.metadata?.customerSignature) || 
                                  (d.metadata?.photos && d.metadata?.photos.length > 0) ||
                                  d.pod || d.proof_of_delivery || d.hasPOD;
            
            if (hasDedicatedPOD || hasMetadataPOD) {
              podStatus = 'With POD';
            }
            
            // Check for signatures
            if (d.driverSignature && d.customerSignature) {
              hasSignatures = 'Both';
            } else if (d.driverSignature || d.customerSignature) {
              hasSignatures = 'Partial';
            }
            
            // Count photos
            if (d.photos && Array.isArray(d.photos)) {
              photoCount = d.photos.length;
            } else if (d.metadata?.photos && Array.isArray(d.metadata?.photos)) {
              photoCount = d.metadata.photos.length;
            }
          }
          
          return [
            d.id || d.ID || '',
            d.customer || d.Customer || '',
            d.address || d.Address || '',
            d.status || d.Status || '',
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
      return res.send(csv);
    }

    // Return JSON
    res.json({
      stats,
      dailyBreakdown: dailyData,
      statusDistribution,
      deliveries,
      filters: { startDate, endDate, status, driverId },
      generatedAt: new Date().toISOString()
    });
  } catch (err) {
    console.error('admin/reports error', err);
    res.status(500).json({ error: 'report_generation_failed', detail: err.message });
  }
});

// GET /api/admin/reports/pod - Dedicated POD Report
// Shows delivered orders with POD status, images uploaded count, etc.
router.get('/pod', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const { startDate, endDate, podStatus, format } = req.query;
    // podStatus can be: 'with-pod', 'without-pod', 'all'

    console.log('[POD Report] Generating POD report...');

    // Fetch all delivered deliveries from database
    const deliveries = await prisma.delivery.findMany({
      where: {
        status: {
          in: ['delivered', 'completed', 'done', 'delivered-with-installation', 'delivered-without-installation']
        },
        ...(startDate || endDate ? {
          deliveredAt: {
            ...(startDate ? { gte: new Date(startDate) } : {}),
            ...(endDate ? { lte: new Date(endDate) } : {})
          }
        } : {})
      },
      include: {
        assignments: {
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
      orderBy: { deliveredAt: 'desc' }
    });

    console.log(`[POD Report] Found ${deliveries.length} delivered orders`);

    // Process deliveries and categorize by POD status
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
        
        // POD Information
        hasPOD: hasPOD,
        podQuality: podQuality,
        hasDriverSignature: hasDriverSignature,
        hasCustomerSignature: hasCustomerSignature,
        hasPhotos: hasPhotos,
        photoCount: photoCount,
        conditionNotes: d.conditionNotes,
        deliveryNotes: d.deliveryNotes,
        
        // Delivery Information
        deliveredBy: d.deliveredBy,
        deliveredAt: d.deliveredAt,
        podCompletedAt: d.podCompletedAt,
        
        // Driver Information
        driverName: d.assignments?.[0]?.driver?.fullName || d.assignments?.[0]?.driver?.username || null,
        driverPhone: d.assignments?.[0]?.driver?.phone || null,
        
        // Timestamps
        createdAt: d.createdAt,
        updatedAt: d.updatedAt
      };
    });

    // Filter by POD status if specified
    let filteredDeliveries = processedDeliveries;
    if (podStatus === 'with-pod') {
      filteredDeliveries = processedDeliveries.filter(d => d.hasPOD);
    } else if (podStatus === 'without-pod') {
      filteredDeliveries = processedDeliveries.filter(d => !d.hasPOD);
    }

    // Calculate POD statistics
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

    // Group by date for daily breakdown
    const dailyBreakdown = {};
    processedDeliveries.forEach(d => {
      const date = (d.deliveredAt || d.createdAt).toString().split('T')[0];
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
      new Date(a.date) - new Date(b.date)
    );

    // Group by driver
    const driverBreakdown = {};
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

    // If CSV format requested
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
      return res.send(csv);
    }

    // Return JSON format
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

  } catch (err) {
    console.error('[POD Report] Error:', err);
    res.status(500).json({ 
      error: 'pod_report_generation_failed', 
      detail: err.message 
    });
  }
});

module.exports = router;

