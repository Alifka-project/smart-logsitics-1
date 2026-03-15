/**
 * Tests for analytics executor result shapes. Require DB (DATABASE_URL) to run.
 * Run: npm test -- src/server/services/ai/analyticsExecutor.test.js
 */
import { describe, it, expect } from 'vitest';

describe('analyticsExecutor result shape', () => {
  it('countDeliveries returns total, pending, inTransit, delivered, cancelled, period', async () => {
    // First Prisma call can be slow (cold start)
    const { countDeliveries } = await import('./analyticsExecutor.js');
    const result = await countDeliveries({});
    expect(result).toHaveProperty('total');
    expect(result).toHaveProperty('pending');
    expect(result).toHaveProperty('inTransit');
    expect(result).toHaveProperty('delivered');
    expect(result).toHaveProperty('cancelled');
    expect(result).toHaveProperty('period');
    expect(typeof result.total).toBe('number');
    expect(typeof result.pending).toBe('number');
  }, 15000);

  it('getTopCustomers returns rows array and period', async () => {
    const { getTopCustomers } = await import('./analyticsExecutor.js');
    const result = await getTopCustomers({}, 5);
    expect(Array.isArray(result.rows)).toBe(true);
    result.rows.forEach(row => {
      expect(row).toHaveProperty('customer');
      expect(row).toHaveProperty('deliveries');
      expect(typeof row.deliveries).toBe('number');
    });
    expect(result).toHaveProperty('period');
  });

  it('getTopProducts returns rows array and period', async () => {
    const { getTopProducts } = await import('./analyticsExecutor.js');
    const result = await getTopProducts({}, 5);
    expect(Array.isArray(result.rows)).toBe(true);
    result.rows.forEach(row => {
      expect(row).toHaveProperty('name');
      expect(row).toHaveProperty('deliveries');
      expect(typeof row.deliveries).toBe('number');
    });
    expect(result).toHaveProperty('period');
  });

  it('getStatusBreakdown returns table and counts', async () => {
    const { getStatusBreakdown } = await import('./analyticsExecutor.js');
    const result = await getStatusBreakdown({});
    expect(result).toHaveProperty('table');
    expect(Array.isArray(result.table)).toBe(true);
    expect(result.table.some(r => r.status && typeof r.count === 'number')).toBe(true);
    expect(result).toHaveProperty('total');
    expect(result).toHaveProperty('period');
  });
});
