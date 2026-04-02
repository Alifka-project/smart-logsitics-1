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

describe('booking window', () => {
  it('returns 7 dates and none are Sunday', () => {
    const days = getNextSevenEligibleDayIsoStrings();
    expect(days).toHaveLength(7);
    for (const d of days) {
      expect(getDubaiWeekday(d)).not.toBe(0);
    }
  });

  it('has positive truck capacity default', () => {
    expect(TRUCK_MAX_ITEMS_PER_DAY).toBeGreaterThanOrEqual(1);
  });
});
