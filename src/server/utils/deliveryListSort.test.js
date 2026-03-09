/**
 * Unit tests for deliveryListSort – incomplete (missing address or phone) at bottom
 */
import { describe, it, expect } from 'vitest';
import { sortDeliveriesIncompleteLast } from './deliveryListSort';

describe('deliveryListSort', () => {
  it('sorts deliveries with missing address or phone to the bottom', () => {
    const list = [
      { id: '1', address: '', phone: '555', createdAt: '2025-01-03' },
      { id: '2', address: 'Addr 2', phone: '666', createdAt: '2025-01-02' },
      { id: '3', address: 'Addr 3', phone: '', createdAt: '2025-01-01' },
      { id: '4', address: 'Addr 4', phone: '888', createdAt: '2025-01-04' }
    ];
    sortDeliveriesIncompleteLast(list);
    expect(list.map(d => d.id)).toEqual(['4', '2', '1', '3']);
  });

  it('within complete group, newest first; within incomplete, newest first', () => {
    const list = [
      { id: 'a', address: 'A', phone: '1', createdAt: '2025-01-01' },
      { id: 'b', address: 'B', phone: '2', createdAt: '2025-01-03' },
      { id: 'c', address: null, phone: '3', createdAt: '2025-01-02' },
      { id: 'd', address: 'D', phone: null, createdAt: '2025-01-04' }
    ];
    sortDeliveriesIncompleteLast(list);
    expect(list.map(d => d.id)).toEqual(['b', 'a', 'd', 'c']);
  });

  it('handles empty array and null/undefined safely', () => {
    const empty = [];
    sortDeliveriesIncompleteLast(empty);
    expect(empty).toEqual([]);
  });
});
