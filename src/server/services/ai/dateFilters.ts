/**
 * Parse natural language date phrases into { from, to, label } for Prisma filters.
 * Used by classifyQuery and analytics executor.
 */

export interface DateRange {
  from: Date;
  to: Date;
  label: string;
}

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function endOfDayExclusive(d: Date): Date {
  const x = new Date(d);
  x.setHours(24, 0, 0, 0);
  return x;
}

/**
 * Infer date range from query string.
 * Returns { from, to, label } or null.
 */
function inferDateRangeFromQuery(query: string): DateRange | null {
  const q = String(query || '').toLowerCase();
  const now = new Date();

  const lastDaysMatch = q.match(/(?:in the\s+)?last\s+(\d+)\s+day/);
  if (lastDaysMatch) {
    const n = parseInt(lastDaysMatch[1], 10);
    if (Number.isFinite(n) && n > 0 && n <= 365) {
      const to = endOfDayExclusive(now);
      const from = new Date(to.getTime() - n * 24 * 60 * 60 * 1000);
      from.setHours(0, 0, 0, 0);
      return { from, to, label: `last ${n} days` };
    }
  }

  const lastHoursMatch = q.match(/(?:in the\s+)?last\s+(\d+)\s+hour/);
  if (lastHoursMatch) {
    const n = parseInt(lastHoursMatch[1], 10);
    if (Number.isFinite(n) && n > 0 && n <= 240) {
      const to = now;
      const from = new Date(to.getTime() - n * 60 * 60 * 1000);
      return { from, to, label: `last ${n} hours` };
    }
  }

  if (q.includes('today')) {
    return { from: startOfDay(now), to: endOfDayExclusive(now), label: 'today' };
  }
  if (q.includes('yesterday')) {
    const y = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    return { from: startOfDay(y), to: endOfDayExclusive(y), label: 'yesterday' };
  }
  if (q.includes('last 7 days') || q.includes('last seven days') || q.includes('last week')) {
    const to = endOfDayExclusive(now);
    const from = new Date(to.getTime() - 7 * 24 * 60 * 60 * 1000);
    from.setHours(0, 0, 0, 0);
    return { from, to, label: 'last 7 days' };
  }
  if (q.includes('this week')) {
    const day = now.getDay();
    const start = new Date(now);
    start.setDate(now.getDate() - (day === 0 ? 6 : day - 1));
    const from = startOfDay(start);
    const to = endOfDayExclusive(now);
    return { from, to, label: 'this week' };
  }
  if (q.includes('last 30 days') || q.includes('last thirty days')) {
    const to = endOfDayExclusive(now);
    const from = new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);
    from.setHours(0, 0, 0, 0);
    return { from, to, label: 'last 30 days' };
  }
  if (q.includes('this month') || q.includes('current month')) {
    const from = new Date(now.getFullYear(), now.getMonth(), 1);
    const to = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    return { from, to, label: 'this month' };
  }
  if (q.includes('last month') || q.includes('previous month')) {
    const from = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const to = new Date(now.getFullYear(), now.getMonth(), 1);
    return { from, to, label: 'last month' };
  }

  return null;
}

export { inferDateRangeFromQuery, startOfDay, endOfDayExclusive };
