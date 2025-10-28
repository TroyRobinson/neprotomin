// Unit tests for ETL utility functions
import { describe, it, expect } from 'vitest';
import {
  mapUnitToType,
  desiredToGoodIfUp,
  parseArgs,
  inTulsaBbox,
  TULSA_BBOX,
} from './etlUtils.js';

describe('mapUnitToType', () => {
  it('maps percentage to percent', () => {
    expect(mapUnitToType('percentage')).toBe('percent');
    expect(mapUnitToType('Percentage')).toBe('percent');
    expect(mapUnitToType('PERCENTAGE')).toBe('percent');
  });

  it('maps rate to rate', () => {
    expect(mapUnitToType('rate')).toBe('rate');
    expect(mapUnitToType('Rate')).toBe('rate');
  });

  it('maps dollars to currency', () => {
    expect(mapUnitToType('dollars')).toBe('currency');
    expect(mapUnitToType('dollars_per_capita')).toBe('currency');
  });

  it('maps index to index', () => {
    expect(mapUnitToType('index')).toBe('index');
  });

  it('maps total to count', () => {
    expect(mapUnitToType('total')).toBe('count');
  });

  it('maps hours to hours', () => {
    expect(mapUnitToType('hours')).toBe('hours');
  });

  it('maps years to years', () => {
    expect(mapUnitToType('years')).toBe('years');
  });

  it('defaults unknown units to count', () => {
    expect(mapUnitToType('unknown')).toBe('count');
    expect(mapUnitToType('')).toBe('count');
    expect(mapUnitToType(null)).toBe('count');
    expect(mapUnitToType(undefined)).toBe('count');
  });
});

describe('desiredToGoodIfUp', () => {
  it('maps "high" to true', () => {
    expect(desiredToGoodIfUp('high')).toBe(true);
    expect(desiredToGoodIfUp('High')).toBe(true);
    expect(desiredToGoodIfUp('HIGH')).toBe(true);
  });

  it('maps "low" to false', () => {
    expect(desiredToGoodIfUp('low')).toBe(false);
    expect(desiredToGoodIfUp('Low')).toBe(false);
    expect(desiredToGoodIfUp('LOW')).toBe(false);
  });

  it('returns null for neutral/unknown', () => {
    expect(desiredToGoodIfUp('neutral')).toBe(null);
    expect(desiredToGoodIfUp('')).toBe(null);
    expect(desiredToGoodIfUp(null)).toBe(null);
    expect(desiredToGoodIfUp(undefined)).toBe(null);
  });
});

describe('parseArgs', () => {
  it('parses key=value pairs', () => {
    const argv = ['node', 'script.js', '--foo=bar', '--baz=qux'];
    const args = parseArgs(argv);
    expect(args.foo).toBe('bar');
    expect(args.baz).toBe('qux');
  });

  it('parses flags without values', () => {
    const argv = ['node', 'script.js', '--dry', '--debug'];
    const args = parseArgs(argv);
    expect(args.dry).toBe(true);
    expect(args.debug).toBe(true);
  });

  it('handles mixed args', () => {
    const argv = ['node', 'script.js', '--limit=10', '--dry', '--base=http://example.com'];
    const args = parseArgs(argv);
    expect(args.limit).toBe('10');
    expect(args.dry).toBe(true);
    expect(args.base).toBe('http://example.com');
  });
});

describe('inTulsaBbox', () => {
  it('returns true for coordinates within Tulsa bbox', () => {
    // Center of Tulsa: approximately [-95.99, 36.15]
    expect(inTulsaBbox([-95.99, 36.15])).toBe(true);

    // Near edges but still inside
    expect(inTulsaBbox([-96.2, 36.0])).toBe(true);
    expect(inTulsaBbox([-95.4, 36.5])).toBe(true);
  });

  it('returns false for coordinates outside Tulsa bbox', () => {
    // Too far west
    expect(inTulsaBbox([-96.5, 36.0])).toBe(false);

    // Too far east
    expect(inTulsaBbox([-95.0, 36.0])).toBe(false);

    // Too far south
    expect(inTulsaBbox([-95.99, 35.5])).toBe(false);

    // Too far north
    expect(inTulsaBbox([-95.99, 36.8])).toBe(false);
  });

  it('returns false for invalid coordinates', () => {
    expect(inTulsaBbox(null)).toBe(false);
    expect(inTulsaBbox(undefined)).toBe(false);
    expect(inTulsaBbox([])).toBe(false);
    expect(inTulsaBbox([95.99])).toBe(false); // Missing latitude
    expect(inTulsaBbox('invalid')).toBe(false);
  });

  it('validates TULSA_BBOX structure', () => {
    expect(TULSA_BBOX).toHaveProperty('minLon');
    expect(TULSA_BBOX).toHaveProperty('maxLon');
    expect(TULSA_BBOX).toHaveProperty('minLat');
    expect(TULSA_BBOX).toHaveProperty('maxLat');
    expect(TULSA_BBOX.minLon).toBeLessThan(TULSA_BBOX.maxLon);
    expect(TULSA_BBOX.minLat).toBeLessThan(TULSA_BBOX.maxLat);
  });
});
