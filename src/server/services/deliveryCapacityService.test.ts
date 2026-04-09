import { describe, it, expect } from 'vitest';
import {
  parseDeliveryItemCount,
  getNextSevenEligibleDayIsoStrings,
  getDubaiWeekday,
  TRUCK_MAX_ITEMS_PER_DAY
} from './deliveryCapacityService';

describe('parseDeliveryItemCount', () => {
  it('returns 1 for empty', () => {
    expect(parseDeliveryItemCount(null, null)).toBe(1);
  });

  it('sums quantities from JSON array', () => {
    const j = JSON.stringify([
      { Quantity: 2 },
      { quantity: 3 }
    ]);
    expect(parseDeliveryItemCount(j, null)).toBe(5);
  });

  it('uses originalQuantity from metadata when set', () => {
    expect(parseDeliveryItemCount('[]', { originalQuantity: 12 })).toBe(12);
  });
});

describe('parseDeliveryItemCount – Excel column names', () => {
  it('reads Order Quantity from originalRow', () => {
    const meta = { originalRow: { 'Order Quantity': 15 } };
    expect(parseDeliveryItemCount(null, meta)).toBe(15);
  });

  it('reads Confirmed quantity from originalRow when Order Quantity absent', () => {
    const meta = { originalRow: { 'Confirmed quantity': 8 } };
    expect(parseDeliveryItemCount(null, meta)).toBe(8);
  });

  it('originalQuantity takes priority over originalRow', () => {
    const meta = { originalQuantity: 5, originalRow: { 'Order Quantity': 20 } };
    expect(parseDeliveryItemCount(null, meta)).toBe(5);
  });

  it('reads Order Quantity from parsed JSON item rows', () => {
    const j = JSON.stringify([{ 'Order Quantity': 10 }, { 'Order Quantity': 6 }]);
    expect(parseDeliveryItemCount(j, null)).toBe(16);
  });

  it('falls back to 1 when all quantity sources are absent', () => {
    expect(parseDeliveryItemCount(null, { originalRow: {} })).toBe(1);
  });
});

describe('booking window', () => {
  it('returns 7 dates and none are Sunday', () => {
    const days = getNextSevenEligibleDayIsoStrings();
    expect(days).toHaveLength(7);
    for (const d of days) {
      expect(getDubaiWeekday(d)).not.toBe(0);
    }
  });

  it('truck capacity default is exactly 20 (one truck per driver)', () => {
    // Business rule: 1 driver = 1 truck = 20 units. Env TRUCK_MAX_ITEMS_PER_DAY overrides.
    const expected = process.env.TRUCK_MAX_ITEMS_PER_DAY
      ? Number(process.env.TRUCK_MAX_ITEMS_PER_DAY)
      : 20;
    expect(TRUCK_MAX_ITEMS_PER_DAY).toBe(expected);
  });

  it('TRUCK_MAX_ITEMS_PER_DAY is at least 1', () => {
    expect(TRUCK_MAX_ITEMS_PER_DAY).toBeGreaterThanOrEqual(1);
  });
});
