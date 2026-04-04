/**
 * UAE Public Holidays — Dubai delivery calendar.
 *
 * Islamic holidays are announced 1–2 days before by the UAE authorities and
 * shift each Gregorian year (lunar calendar). The dates below are the best
 * available estimates; update annually with the official UAE government
 * bulletin: https://u.ae/en/information-and-services/public-holidays-and-religious-affairs
 *
 * Fixed secular holidays (New Year, National Day, Commemoration Day) are
 * determined in advance. Islamic holidays are marked "approx."
 */

export const DUBAI_PUBLIC_HOLIDAYS = new Set<string>([
  // ── 2025 ──────────────────────────────────────────────────────────────────
  '2025-01-01', // New Year's Day
  '2025-03-30', // Eid Al Fitr — Day 1 (approx.)
  '2025-03-31', // Eid Al Fitr — Day 2 (approx.)
  '2025-04-01', // Eid Al Fitr — Day 3 (approx.)
  '2025-06-05', // Arafat Day / Eid Al Adha Eve (approx.)
  '2025-06-06', // Eid Al Adha — Day 1 (approx.)
  '2025-06-07', // Eid Al Adha — Day 2 (approx.)
  '2025-06-08', // Eid Al Adha — Day 3 (approx.; Sunday — already a day off)
  '2025-06-26', // Islamic New Year / Al Hijri New Year (approx.)
  '2025-09-04', // Prophet's Birthday / Al Mawlid (approx.)
  '2025-12-01', // Commemoration Day (Martyr's Day)
  '2025-12-02', // UAE National Day
  '2025-12-03', // UAE National Day — Day 2

  // ── 2026 ──────────────────────────────────────────────────────────────────
  '2026-01-01', // New Year's Day
  '2026-03-19', // Eid Al Fitr — Day 1 (approx.)
  '2026-03-20', // Eid Al Fitr — Day 2 (approx.)
  '2026-03-21', // Eid Al Fitr — Day 3 (approx.)
  '2026-05-26', // Arafat Day / Eid Al Adha Eve (approx.)
  '2026-05-27', // Eid Al Adha — Day 1 (approx.)
  '2026-05-28', // Eid Al Adha — Day 2 (approx.)
  '2026-05-29', // Eid Al Adha — Day 3 (approx.)
  '2026-06-15', // Islamic New Year (approx.)
  '2026-08-24', // Prophet's Birthday (approx.)
  '2026-12-01', // Commemoration Day
  '2026-12-02', // UAE National Day
  '2026-12-03', // UAE National Day — Day 2

  // ── 2027 (partial — fixed holidays only; update when Islamic dates confirmed) ──
  '2027-01-01', // New Year's Day
  '2027-12-01', // Commemoration Day
  '2027-12-02', // UAE National Day
  '2027-12-03', // UAE National Day — Day 2
]);

/**
 * Returns true if the given ISO date string (YYYY-MM-DD) is a UAE public holiday.
 * Does NOT account for Sundays — check getDubaiWeekday() separately.
 */
export function isDubaiPublicHoliday(isoDate: string): boolean {
  return DUBAI_PUBLIC_HOLIDAYS.has(isoDate);
}

/**
 * Returns true if the ISO date is a non-working day in Dubai:
 * Sunday (weekday === 0) OR a UAE public holiday.
 *
 * @param isoDate  YYYY-MM-DD string
 * @param weekday  0=Sun, 1=Mon … 6=Sat (from getDubaiWeekday or getUTCDay)
 */
export function isDubaiNonWorkingDay(isoDate: string, weekday: number): boolean {
  return weekday === 0 || isDubaiPublicHoliday(isoDate);
}
