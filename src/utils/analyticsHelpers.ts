/**
 * Analytics helper utilities for share %, concentration, and insight generation.
 * Used by Admin Dashboard tabs: Top Customers, By Area, By Product.
 */

/** Compute share percentage for a value against total */
export function sharePct(value: number, total: number): number {
  if (total <= 0) return 0;
  return parseFloat(((value / total) * 100).toFixed(1));
}

/** Top N share: sum of top N values as % of total */
export function topNSharePct<T>(items: T[], valueFn: (x: T) => number, n: number): number {
  const total = items.reduce((s, x) => s + valueFn(x), 0);
  if (total <= 0) return 0;
  const topSum = items.slice(0, n).reduce((s, x) => s + valueFn(x), 0);
  return sharePct(topSum, total);
}

/** Herfindahl-style concentration: sum of squared shares (0–1). Higher = more concentrated */
export function concentrationLevel(items: { count?: number }[], total?: number): 'High' | 'Medium' | 'Low' {
  const t = total ?? items.reduce((s, x) => s + (x.count ?? 0), 0);
  if (t <= 0 || items.length === 0) return 'Low';
  const h = items.reduce((s, x) => {
    const sh = (x.count ?? 0) / t;
    return s + sh * sh;
  }, 0);
  if (h >= 0.25) return 'High';
  if (h >= 0.1) return 'Medium';
  return 'Low';
}

/** Pareto cumulative share line data */
export function paretoCumulative<T>(items: T[], valueFn: (x: T) => number): { cumSum: number; cumPct: number }[] {
  const total = items.reduce((s, x) => s + valueFn(x), 0);
  if (total <= 0) return items.map(() => ({ cumSum: 0, cumPct: 0 }));
  let cum = 0;
  return items.map(x => {
    cum += valueFn(x);
    return { cumSum: cum, cumPct: sharePct(cum, total) };
  });
}
