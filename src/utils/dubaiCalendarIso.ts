/** Client-safe Dubai calendar helpers (Asia/Dubai, no DST). */

const DUBAI_TZ = 'Asia/Dubai';

export function getTodayIsoDubai(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: DUBAI_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

export function formatInstantToDubaiIsoDate(ms: number): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: DUBAI_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(ms));
}

/** Add signed calendar days in Dubai (same logic as server addDubaiCalendarDays). */
export function addCalendarDaysDubai(isoDate: string, deltaDays: number): string {
  const ref = new Date(`${isoDate}T12:00:00+04:00`);
  ref.setTime(ref.getTime() + deltaDays * 86400000);
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: DUBAI_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(ref);
}
