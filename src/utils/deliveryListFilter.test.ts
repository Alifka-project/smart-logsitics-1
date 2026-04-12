import { describe, it, expect } from 'vitest';
import { isTeamPortalGarbageDelivery } from './deliveryListFilter';

describe('isTeamPortalGarbageDelivery', () => {
  it('flags PO "removed" on top-level poNumber', () => {
    expect(isTeamPortalGarbageDelivery({ poNumber: 'removed', customer: 'ACME' })).toBe(true);
  });

  it('flags removed in metadata.originalRow PO Number (bad Excel mapping)', () => {
    expect(
      isTeamPortalGarbageDelivery({
        poNumber: 'PO-123',
        customer: 'ACME',
        metadata: {
          originalRow: { 'PO Number': 'removed', 'Ship to party': 'ACME' },
        },
      })
    ).toBe(true);
  });

  it('keeps normal PO in originalRow', () => {
    expect(
      isTeamPortalGarbageDelivery({
        poNumber: 'PO-999',
        customer: 'ACME',
        metadata: {
          originalRow: { 'PO Number': 'PO-999' },
        },
      })
    ).toBe(false);
  });

  it('flags placeholder Customer3 without space', () => {
    expect(isTeamPortalGarbageDelivery({ poNumber: 'X', customer: 'Customer3' })).toBe(true);
  });

  it('flags removed in any originalRow cell (wrong column)', () => {
    expect(
      isTeamPortalGarbageDelivery({
        poNumber: 'OK-1',
        customer: 'Real Co',
        metadata: { originalRow: { Route: 'removed', 'PO Number': 'OK-1' } },
      })
    ).toBe(true);
  });
});
