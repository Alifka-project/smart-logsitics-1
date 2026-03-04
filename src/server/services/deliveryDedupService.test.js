import { describe, it, expect } from 'vitest';
import { buildBusinessKey } from './deliveryDedupService';

describe('deliveryDedupService - buildBusinessKey', () => {
  it('builds a normalized business key from PO and original delivery number', () => {
    const key = buildBusinessKey({
      poNumber: ' po-123 ',
      originalDeliveryNumber: ' del-9 '
    });
    expect(key).toBe('PO-123::DEL-9');
  });

  it('returns null when PO is missing', () => {
    const key = buildBusinessKey({
      poNumber: null,
      originalDeliveryNumber: 'DEL-9'
    });
    expect(key).toBeNull();
  });

  it('returns null when original delivery number is missing', () => {
    const key = buildBusinessKey({
      poNumber: 'PO-123',
      originalDeliveryNumber: ''
    });
    expect(key).toBeNull();
  });
});

