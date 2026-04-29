import { describe, it, expect } from 'vitest';
import { computeETD, formatEtdLabel, shouldShowEtd, __testing__ } from './etd';

/**
 * Date helper: build the UTC instant for a given Dubai wall-clock (UTC+4).
 *   dubai('2026-04-30', '11:00') → Date for 30 Apr 11:00 Dubai = 30 Apr 07:00 UTC.
 */
function dubai(dateIso: string, timeHHmm: string): Date {
  const [y, m, d] = dateIso.split('-').map(Number);
  const [hh, mm] = timeHHmm.split(':').map(Number);
  // Dubai = UTC+4 always (no DST).
  return new Date(Date.UTC(y, m - 1, d, hh - 4, mm, 0, 0));
}

describe('computeETD — pre-pickup statuses return null', () => {
  it('returns null for pending', () => {
    expect(computeETD({ status: 'pending', confirmedDeliveryDate: dubai('2026-04-30', '00:00') })).toBeNull();
  });
  it('returns null for confirmed without picking timestamp', () => {
    expect(computeETD({ status: 'confirmed', confirmedDeliveryDate: dubai('2026-04-30', '00:00') })).toBeNull();
  });
  it('returns null for pgi-done without picking timestamp', () => {
    expect(computeETD({ status: 'pgi-done', confirmedDeliveryDate: dubai('2026-04-30', '00:00') })).toBeNull();
  });
});

describe('computeETD — standard (future-day) flow anchors at 08:00 Dubai', () => {
  it('case 1: pickup yesterday 17:30, delivery tomorrow → tomorrow 08:00', () => {
    const etd = computeETD({
      status: 'pickup-confirmed',
      confirmedDeliveryDate: dubai('2026-04-30', '00:00'),
      metadata: { picking: { confirmedAt: dubai('2026-04-29', '17:30').toISOString() } },
    });
    expect(etd).not.toBeNull();
    expect(etd!.toISOString()).toBe(dubai('2026-04-30', '08:00').toISOString());
  });

  it('pickup today 06:00, delivery today → today 08:00 (truck waits for the morning)', () => {
    const etd = computeETD({
      status: 'pickup-confirmed',
      confirmedDeliveryDate: dubai('2026-04-29', '00:00'),
      metadata: { picking: { confirmedAt: dubai('2026-04-29', '06:00').toISOString() } },
    });
    expect(etd!.toISOString()).toBe(dubai('2026-04-29', '08:00').toISOString());
  });

  it('falls back to goodsMovementDate when confirmedDeliveryDate is missing', () => {
    const etd = computeETD({
      status: 'pickup-confirmed',
      goodsMovementDate: dubai('2026-04-30', '00:00'),
      metadata: { picking: { confirmedAt: dubai('2026-04-29', '17:30').toISOString() } },
    });
    expect(etd!.toISOString()).toBe(dubai('2026-04-30', '08:00').toISOString());
  });
});

describe('computeETD — urgent same-day flow anchors at picking.confirmedAt', () => {
  it('case 3: pickup today 11:00, delivery today → today 11:00', () => {
    const etd = computeETD({
      status: 'out-for-delivery',
      confirmedDeliveryDate: dubai('2026-04-29', '00:00'),
      metadata: { picking: { confirmedAt: dubai('2026-04-29', '11:00').toISOString() } },
    });
    expect(etd!.toISOString()).toBe(dubai('2026-04-29', '11:00').toISOString());
  });

  it('pickup today 14:30, delivery today → today 14:30', () => {
    const etd = computeETD({
      status: 'out-for-delivery',
      confirmedDeliveryDate: dubai('2026-04-29', '00:00'),
      metadata: { picking: { confirmedAt: dubai('2026-04-29', '14:30').toISOString() } },
    });
    expect(etd!.toISOString()).toBe(dubai('2026-04-29', '14:30').toISOString());
  });
});

describe('computeETD — robustness', () => {
  it('returns picking.confirmedAt when there is no delivery date at all', () => {
    const pickup = dubai('2026-04-29', '11:00');
    const etd = computeETD({
      status: 'pickup-confirmed',
      metadata: { picking: { confirmedAt: pickup.toISOString() } },
    });
    expect(etd!.toISOString()).toBe(pickup.toISOString());
  });

  it('handles delivered status (terminal but truck did depart)', () => {
    const etd = computeETD({
      status: 'delivered',
      confirmedDeliveryDate: dubai('2026-04-29', '00:00'),
      metadata: { picking: { confirmedAt: dubai('2026-04-29', '11:00').toISOString() } },
    });
    expect(etd!.toISOString()).toBe(dubai('2026-04-29', '11:00').toISOString());
  });

  it('returns null when metadata is null', () => {
    expect(computeETD({ status: 'pickup-confirmed', metadata: null })).toBeNull();
  });

  it('returns null when picking.confirmedAt is malformed', () => {
    expect(
      computeETD({
        status: 'pickup-confirmed',
        confirmedDeliveryDate: dubai('2026-04-30', '00:00'),
        metadata: { picking: { confirmedAt: 'not-a-date' } },
      })
    ).toBeNull();
  });
});

describe('shouldShowEtd', () => {
  it('false for pre-pickup', () => {
    expect(shouldShowEtd({ status: 'confirmed' })).toBe(false);
  });
  it('true for post-pickup with timestamp', () => {
    expect(
      shouldShowEtd({
        status: 'out-for-delivery',
        confirmedDeliveryDate: dubai('2026-04-29', '00:00'),
        metadata: { picking: { confirmedAt: dubai('2026-04-29', '11:00').toISOString() } },
      })
    ).toBe(true);
  });
});

describe('formatEtdLabel', () => {
  it('today → time only', () => {
    // Construct an ETD that falls on Dubai-today (regardless of when the test runs)
    // by reading today's Dubai date back through the helper.
    const todayParts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Dubai',
      year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(new Date()).split('-');
    const today8am = dubai(todayParts.join('-'), '08:00');
    expect(formatEtdLabel(today8am)).toBe('ETD 08:00');
  });

  it('non-today → date prefix', () => {
    const future = dubai('2026-04-30', '08:00');
    // Skip strict equality check on the test machine's locale formatting,
    // but the structure must be "ETD <date> · <HH:mm>".
    const label = formatEtdLabel(future);
    expect(label).toMatch(/^ETD \d{2} [A-Z][a-z]{2} · \d{2}:\d{2}$/);
  });

  it('ETD 11:00 — case 3 readout', () => {
    // Build an ETD that is "today 11:00 Dubai" relative to the test clock so
    // we exercise the same-day branch deterministically.
    const todayParts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Dubai',
      year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(new Date()).split('-');
    const eleven = dubai(todayParts.join('-'), '11:00');
    expect(formatEtdLabel(eleven)).toBe('ETD 11:00');
  });

  it('invalid input → ETD —', () => {
    expect(formatEtdLabel(new Date('not-a-date'))).toBe('ETD —');
  });
});

describe('helper: dubaiAt8AM', () => {
  it('strips time-of-day to 08:00 Dubai for any input on the same Dubai calendar day', () => {
    const lateNight = new Date('2026-04-29T20:00:00Z'); // = 30 Apr 00:00 Dubai
    const result = __testing__.dubaiAt8AM(lateNight);
    expect(result!.toISOString()).toBe(dubai('2026-04-30', '08:00').toISOString());
  });
});
