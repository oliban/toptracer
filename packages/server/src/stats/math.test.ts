import { describe, it, expect } from 'vitest';
import { mean, median, percentile, std, quartiles } from './math.js';

describe('mean', () => {
  it('averages a known array', () => {
    expect(mean([1, 2, 3, 4])).toBe(2.5);
  });
  it('returns null for empty', () => {
    expect(mean([])).toBeNull();
  });
});

describe('percentile (linear interpolation, R type 7)', () => {
  it('returns endpoints at p=0 and p=1', () => {
    const xs = [1, 2, 3, 4, 5];
    expect(percentile(xs, 0)).toBe(1);
    expect(percentile(xs, 1)).toBe(5);
  });
  it('computes p25/p75 for [1..5]', () => {
    // rank = 0.25*4 = 1 -> exactly index 1 = 2 ; 0.75*4 = 3 -> index 3 = 4
    expect(percentile([1, 2, 3, 4, 5], 0.25)).toBe(2);
    expect(percentile([1, 2, 3, 4, 5], 0.75)).toBe(4);
  });
  it('interpolates between ranks', () => {
    // [1,2,3,4]: p25 rank=0.75 -> 1 + 0.75*(2-1)=1.75 ; p75 rank=2.25 -> 3+0.25*(4-3)=3.25
    expect(percentile([1, 2, 3, 4], 0.25)).toBeCloseTo(1.75, 10);
    expect(percentile([1, 2, 3, 4], 0.75)).toBeCloseTo(3.25, 10);
  });
  it('is order-independent', () => {
    expect(percentile([5, 1, 3, 2, 4], 0.5)).toBe(3);
  });
  it('returns null for empty', () => {
    expect(percentile([], 0.5)).toBeNull();
  });
});

describe('median', () => {
  it('odd length', () => {
    expect(median([3, 1, 2])).toBe(2);
  });
  it('even length averages the middle two', () => {
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });
});

describe('std (sample, n-1)', () => {
  it('computes sample std of a known array', () => {
    // [2,4,4,4,5,5,7,9] mean=5, sum sq dev=32, /7 = 4.5714..., sqrt≈2.13809
    expect(std([2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(2.13809, 4);
  });
  it('is 0 for a single element and null for empty', () => {
    expect(std([42])).toBe(0);
    expect(std([])).toBeNull();
  });
});

describe('quartiles', () => {
  it('computes q1/q3/iqr', () => {
    const q = quartiles([1, 2, 3, 4, 5])!;
    expect(q.q1).toBe(2);
    expect(q.q3).toBe(4);
    expect(q.iqr).toBe(2);
  });
});
