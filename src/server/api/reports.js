const express = require('express');
const router = express.Router();
const { authenticate, requireRole } = require('../auth');
const sapService = require('../../../services/sapService');

// GET /api/admin/reports
router.get('/', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const { startDate, endDate, status, driverId, format } = req.query;

    // Fetch deliveries
    const deliveriesResp = await sapService.call('/Deliveries', 'get');
    let deliveries = [];
    if (Array.isArray(deliveriesResp.data?.value)) {
      deliveries = deliveriesResp.data.value;
    } else if (Array.isArray(deliveriesResp.data)) {
      deliveries = deliveriesResp.data;
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
    const stats = {
      total: deliveries.length,
      delivered: deliveries.filter(d => {
        const s = (d.status || '').toLowerCase();
        return ['delivered', 'done', 'completed', 'delivered-with-installation', 'delivered-without-installation'].includes(s);
      }).length,
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
        ['ID', 'Customer', 'Address', 'Status', 'Driver ID', 'Created At', 'Updated At'],
        ...deliveries.map(d => [
          d.id || d.ID || '',
          d.customer || d.Customer || '',
          d.address || d.Address || '',
          d.status || d.Status || '',
          d.driver_id || d.driverId || '',
          d.created_at || d.createdAt || '',
          d.updated_at || d.updatedAt || ''
        ])
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

module.exports = router;

