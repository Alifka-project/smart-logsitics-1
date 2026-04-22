"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const { requireAnyRole } = require('../auth');
const router = (0, express_1.Router)();
const prisma = require('../db/prisma').default;
const { classifyQuery, INTENTS, DIMENSIONS } = require('../services/ai/classifyQuery');
const { countDeliveries, getTopCustomers, getTopProducts, getStatusBreakdown, getDeliveryTrend } = require('../services/ai/analyticsExecutor');
const { searchDeliveries, searchDrivers } = require('../services/ai/searchExecutor');
const { findNavigationTarget } = require('../services/ai/navigationMap');
const { summarizeInsight } = require('../services/ai/summarizeInsight');
/* ─── POST /api/ai/search ──────────────────────────────────────
   Flow: classify → execute (analytics | lookup | navigation) → summarize (optional) → response
   Response shape: success, intent, answer, plan, kpis, table, chart, insights, results, drivers, totalCount, navSuggestions, insightOnly, insight (backward compat)
   ──────────────────────────────────────────────────────────── */
// Restrict analytics search to admin and delivery_team roles only.
// Drivers do not have access to aggregate business intelligence data.
router.post('/search', requireAnyRole('admin', 'delivery_team', 'logistics_team'), async (req, res) => {
    const body = req.body;
    const { query } = body || {};
    const rawQuery = query?.trim() || '';
    if (!rawQuery) {
        return void res.json({
            success: true,
            intent: null,
            answer: '',
            plan: null,
            kpis: null,
            table: null,
            chart: null,
            insights: [],
            results: [],
            drivers: [],
            totalCount: 0,
            navSuggestions: [],
            insightOnly: false,
            insight: null,
        });
    }
    try {
        const user = req.user;
        const userRole = user?.role || 'driver';
        const driverId = user?.sub;
        const plan = classifyQuery(rawQuery);
        const filters = plan.filters || {};
        const dateRange = filters.dateRange;
        const navSuggestions = findNavigationTarget(rawQuery, userRole);
        let answer = '';
        let kpis = null;
        let table = null;
        let chart = null;
        let insights = [];
        let results = [];
        let drivers = [];
        let totalCount = 0;
        let insightOnly = false;
        let insight = null;
        if (plan.intent === INTENTS.NAVIGATION) {
            if (navSuggestions.length > 0) {
                const first = navSuggestions[0];
                answer = `Open "${first.label}" to ${first.path.includes('pod') ? 'view Proof of Delivery reports' : 'see that section'}. Path: ${first.path}`;
            }
            else {
                answer = 'No matching page found. Try "POD report", "Reports", or "Deliveries".';
            }
            return void res.json({
                success: true,
                intent: plan.intent,
                answer,
                plan,
                kpis: null,
                table: null,
                chart: null,
                insights: [],
                results: [],
                drivers: [],
                totalCount: 0,
                navSuggestions,
                insightOnly: true,
                insight: null,
            });
        }
        if (plan.intent === INTENTS.COUNT) {
            const counts = await countDeliveries(filters);
            const period = counts.period ? `For ${counts.period}, ` : '';
            const statusLabel = filters.status === 'pending' ? 'pending' : filters.status === 'out-for-delivery' ? 'in transit' : filters.status === 'delivered' ? 'delivered' : filters.status === 'cancelled' ? 'cancelled' : 'total';
            if (filters.status) {
                const n = counts[filters.status === 'out-for-delivery' ? 'inTransit' : filters.status] ?? counts.total;
                answer = `${period}there ${n === 1 ? 'is' : 'are'} ${n} ${statusLabel} delivery${n !== 1 ? 'ies' : ''}.`;
            }
            else {
                answer = `${period}there are ${counts.total} total deliveries (${counts.pending} pending, ${counts.inTransit} in transit, ${counts.delivered} delivered, ${counts.cancelled} cancelled).`;
            }
            kpis = { total: counts.total, pending: counts.pending, inTransit: counts.inTransit, delivered: counts.delivered, cancelled: counts.cancelled };
            table = [
                { status: 'Pending', count: counts.pending },
                { status: 'In transit', count: counts.inTransit },
                { status: 'Delivered', count: counts.delivered },
                { status: 'Cancelled', count: counts.cancelled },
            ];
            chart = { type: 'bar', xKey: 'status', yKey: 'count', data: table };
            insightOnly = true;
            if (userRole === 'admin') {
                insights = await summarizeInsight({ intent: plan.intent, plan, data: counts, answer });
            }
            return void res.json({
                success: true,
                intent: plan.intent,
                answer,
                plan,
                kpis,
                table,
                chart,
                insights,
                results: [],
                drivers: [],
                totalCount: counts.total,
                navSuggestions,
                insightOnly,
                insight: { type: 'count', chartData: table, period: counts.period },
            });
        }
        if (plan.intent === INTENTS.RANKING && plan.dimension === DIMENSIONS.CUSTOMER && userRole === 'admin') {
            const { rows, period } = await getTopCustomers(filters, plan.topN || 10);
            if (rows.length === 0) {
                answer = period ? `For ${period}, there are no deliveries with customer data.` : 'No delivery data with customer information found.';
            }
            else {
                const first = rows[0];
                const periodStr = period ? `For ${period}, ` : '';
                answer = `${periodStr}the top customer is ${first.customer} with ${first.deliveries} delivery${first.deliveries !== 1 ? 'ies' : ''}.`;
                if (rows.length > 1) {
                    const rest = rows.slice(1, 5).map((r, i) => `${i + 2}. ${r.customer} (${r.deliveries})`).join('; ');
                    answer += ` Next: ${rest}.`;
                }
                kpis = { leader: first.customer, leaderCount: first.deliveries };
                table = rows.map(r => ({ customer: r.customer, deliveries: r.deliveries }));
                const chartData = table.map(r => ({ name: r.customer, count: r.deliveries }));
                chart = { type: 'bar', xKey: 'customer', yKey: 'deliveries', data: chartData };
                insight = { type: 'top_customers', chartData, period };
                insightOnly = true;
                insights = await summarizeInsight({ intent: plan.intent, plan, data: { rows, period }, answer });
            }
            return void res.json({
                success: true,
                intent: plan.intent,
                answer,
                plan,
                kpis,
                table,
                chart,
                insights,
                results: [],
                drivers: [],
                totalCount: 0,
                navSuggestions,
                insightOnly,
                insight,
            });
        }
        if (plan.intent === INTENTS.RANKING && plan.dimension === DIMENSIONS.PRODUCT && userRole === 'admin') {
            const { rows, period } = await getTopProducts(filters, plan.topN || 10);
            if (rows.length === 0) {
                answer = period ? `For ${period}, there are no deliveries with product/item data.` : 'No product data found in deliveries.';
            }
            else {
                const first = rows[0];
                const periodStr = period ? `For ${period}, ` : '';
                answer = `${periodStr}the most delivered product is "${first.name}" with ${first.deliveries} delivery${first.deliveries !== 1 ? 'ies' : ''}. See the chart for the full breakdown.`;
                kpis = { leader: first.name, leaderCount: first.deliveries };
                table = rows.map(r => ({ name: r.name, deliveries: r.deliveries }));
                const chartData = table.map(r => ({ name: r.name, count: r.deliveries }));
                chart = { type: 'bar', xKey: 'name', yKey: 'deliveries', data: chartData };
                insight = { type: 'top_products', chartData, period };
                insightOnly = true;
                insights = await summarizeInsight({ intent: plan.intent, plan, data: { rows, period }, answer });
            }
            return void res.json({
                success: true,
                intent: plan.intent,
                answer,
                plan,
                kpis,
                table,
                chart,
                insights,
                results: [],
                drivers: [],
                totalCount: 0,
                navSuggestions,
                insightOnly,
                insight,
            });
        }
        if (plan.intent === INTENTS.TREND && userRole === 'admin') {
            const breakdown = await getStatusBreakdown(filters);
            const periodStr = breakdown.period ? `For ${breakdown.period}, ` : '';
            answer = `${periodStr}deliveries: ${breakdown.delivered} delivered, ${breakdown.cancelled} cancelled, ${breakdown.pending} pending, ${breakdown.inTransit} in transit (${breakdown.total} total).`;
            table = breakdown.table;
            chart = { type: 'bar', xKey: 'status', yKey: 'count', data: table };
            insightOnly = true;
            insight = { type: 'status_breakdown', chartData: table, period: breakdown.period };
            insights = await summarizeInsight({ intent: plan.intent, plan, data: breakdown, answer });
            return void res.json({
                success: true,
                intent: plan.intent,
                answer,
                plan,
                kpis: { total: breakdown.total, delivered: breakdown.delivered, cancelled: breakdown.cancelled },
                table,
                chart,
                insights,
                results: [],
                drivers: [],
                totalCount: breakdown.total,
                navSuggestions,
                insightOnly,
                insight,
            });
        }
        /* Lookup: text search */
        const deliveryResult = await searchDeliveries(rawQuery, filters, { limit: 10, driverId: userRole === 'admin' ? null : driverId });
        results = deliveryResult.rows;
        totalCount = deliveryResult.total;
        if (userRole === 'admin') {
            const driverResult = await searchDrivers(rawQuery, { limit: 5 });
            drivers = driverResult.rows;
        }
        if (results.length > 0 || drivers.length > 0) {
            answer = `Found ${totalCount} deliver${totalCount !== 1 ? 'ies' : 'y'}${drivers.length ? ` and ${drivers.length} driver${drivers.length !== 1 ? 's' : ''}` : ''} matching "${rawQuery}".`;
        }
        else {
            const counts = await countDeliveries({ dateRange: filters.dateRange || null });
            const period = counts.period ? `For ${counts.period}, ` : 'Currently ';
            answer = `${period}there are ${counts.pending} pending, ${counts.inTransit} in transit, ${counts.delivered} delivered and ${counts.cancelled} cancelled orders (${counts.total} total).`;
            if (navSuggestions.length > 0) {
                answer += ` To explore, try opening "${navSuggestions[0].label}".`;
            }
            else {
                answer += ` No records found matching "${rawQuery}".`;
            }
        }
        return void res.json({
            success: true,
            intent: plan.intent,
            answer,
            plan,
            kpis: null,
            table: null,
            chart: null,
            insights: [],
            results,
            drivers,
            totalCount,
            navSuggestions,
            insightOnly: false,
            insight: null,
        });
    }
    catch (err) {
        const e = err;
        console.error('[AI Search] Error:', e.message);
        res.status(500).json({
            success: false,
            error: e.message,
            answer: 'Search failed. Please try again.',
            results: [],
            drivers: [],
        });
    }
});
/* ─── GET /api/ai/navbar-stats ──────────────────────────────── */
router.get('/navbar-stats', async (req, res) => {
    try {
        const user = req.user;
        const userRole = user?.role || 'driver';
        const driverId = user?.sub;
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        if (userRole === 'admin') {
            const [total, pending, inTransit, deliveredToday, activeDrivers] = await Promise.all([
                prisma.delivery.count(),
                prisma.delivery.count({ where: { status: 'pending' } }),
                prisma.delivery.count({ where: { status: { in: ['out-for-delivery', 'pgi-done', 'pickup-confirmed'] } } }),
                prisma.delivery.count({ where: { status: 'delivered', deliveredAt: { gte: today } } }),
                prisma.driver.count({ where: { active: true } }),
            ]);
            return void res.json({ role: 'admin', total, pending, inTransit, deliveredToday, activeDrivers });
        }
        if (userRole === 'driver' || userRole === 'delivery_team') {
            const [assigned, deliveredToday] = await Promise.all([
                prisma.deliveryAssignment.count({
                    where: { driverId, delivery: { status: { notIn: ['delivered', 'cancelled'] } } },
                }),
                prisma.deliveryAssignment.count({
                    where: { driverId, delivery: { status: 'delivered', deliveredAt: { gte: today } } },
                }),
            ]);
            return void res.json({ role: userRole, assigned, deliveredToday });
        }
        res.json({});
    }
    catch (err) {
        const e = err;
        console.error('[Navbar Stats] Error:', e.message);
        res.status(500).json({ error: e.message });
    }
});
/* ─── POST /api/ai/optimize (stub) ─────────────────────────── */
router.post('/optimize', async (_req, res) => {
    res.status(501).json({ error: 'not_implemented' });
});
exports.default = router;
