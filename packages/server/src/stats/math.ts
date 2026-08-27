// Small pure numeric helpers for the stats module.
// All functions ignore nothing implicitly — callers pass already-cleaned number[].

/** Arithmetic mean. Returns null for an empty array. */
export function mean(xs: number[]): number | null {
  if (xs.length === 0) return null;
  let sum = 0;
  for (const x of xs) sum += x;
  return sum / xs.length;
}

/**
 * Percentile using linear interpolation between closest ranks
 * (the "R type 7" / numpy default method).
 * p is a fraction in [0, 1]. Input need NOT be pre-sorted.
 * Returns null for an empty array.
 */
export function percentile(xs: number[], p: number): number | null {
  if (xs.length === 0) return null;
  if (xs.length === 1) return xs[0];
  const sorted = [...xs].sort((a, b) => a - b);
  const clamped = p < 0 ? 0 : p > 1 ? 1 : p;
  const rank = clamped * (sorted.length - 1);
  const lower = Math.floor(rank);
  const frac = rank - lower;
  if (lower + 1 >= sorted.length) return sorted[lower];
  return sorted[lower] + frac * (sorted[lower + 1] - sorted[lower]);
}

/** Median = 50th percentile (linear interpolation). Null for empty. */
export function median(xs: number[]): number | null {
  return percentile(xs, 0.5);
}

/**
 * Sample standard deviation (denominator n - 1).
 * Returns null for an empty array and 0 for a single element
 * (sample std is undefined for n = 1; we report 0 for a usable numeric).
 */
export function std(xs: number[]): number | null {
  if (xs.length === 0) return null;
  if (xs.length === 1) return 0;
  const m = mean(xs)!;
  let ss = 0;
  for (const x of xs) ss += (x - m) * (x - m);
  return Math.sqrt(ss / (xs.length - 1));
}

/** Quartiles + IQR, using the same linear-interpolation percentile. */
export function quartiles(xs: number[]): { q1: number; q3: number; iqr: number } | null {
  if (xs.length === 0) return null;
  const q1 = percentile(xs, 0.25)!;
  const q3 = percentile(xs, 0.75)!;
  return { q1, q3, iqr: q3 - q1 };
}
