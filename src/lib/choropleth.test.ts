import { describe, it, expect } from 'vitest';
import { getClassIndex } from './choropleth';

describe('getClassIndex', () => {
  it('returns 0 for non-finite values', () => {
    expect(getClassIndex(NaN as any, 0, 10, 7)).toBe(0);
    expect(getClassIndex(Infinity as any, 0, 10, 7)).toBe(0);
  });

  it('returns middle index when range <= 0', () => {
    expect(getClassIndex(5, 10, 10, 7)).toBe(Math.floor((7 - 1) / 2));
  });

  it('maps min to index 0 and max to last index', () => {
    expect(getClassIndex(0, 0, 10, 7)).toBe(0);
    expect(getClassIndex(10, 0, 10, 7)).toBe(6);
  });

  it('clamps into valid range', () => {
    expect(getClassIndex(-100, 0, 10, 7)).toBe(0);
    expect(getClassIndex(100, 0, 10, 7)).toBe(6);
  });
});


