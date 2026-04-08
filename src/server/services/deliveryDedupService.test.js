import { describe, it, expect } from 'vitest';
import { buildBusinessKey } from './deliveryDedupService';

describe('deliveryDedupService - buildBusinessKey', () => {
  it('builds a normalized business key from PO and original delivery number', () => {
    const key = buildBusinessKey(' po-123 ', ' del-9 ');
    expect(key).toBe('PO-123::DEL-9');
  });

  it('returns null when PO is missing', () => {
    const key = buildBusinessKey(null, 'DEL-9');
    expect(key).toBeNull();
  });

  it('returns null when original delivery number is missing', () => {
    const key = buildBusinessKey('PO-123', '');
    expect(key).toBeNull();
  });
});

