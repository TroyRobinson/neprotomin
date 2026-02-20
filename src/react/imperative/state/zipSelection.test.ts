import { describe, it, expect } from 'vitest';
import { computeToggle, computeAddTransient, computeClearTransient, getSelectedSet } from './zipSelection';

const S = (arr: string[]) => new Set(arr);

describe('zipSelection helpers', () => {
  it('computeToggle additive false selects single transient', () => {
    const { pinned, transient } = computeToggle('74103', false, S([]), S([]));
    expect([...transient]).toEqual(['74103']);
    expect(pinned.size).toBe(0);
  });

  it('computeToggle additive true adds/removes transient when not pinned', () => {
    let state = computeToggle('74103', true, S([]), S([]));
    expect([...state.transient]).toEqual(['74103']);
    state = computeToggle('74103', true, state.pinned, state.transient);
    expect(state.transient.size).toBe(0);
  });

  it('computeToggle additive true removes from pinned if present', () => {
    const state = computeToggle('74103', true, S(['74103']), S([]));
    expect(state.pinned.size).toBe(0);
    expect(state.transient.size).toBe(0);
  });

  it('computeToggle additive false deselects when clicked area is the only transient selection', () => {
    const state = computeToggle('74103', false, S([]), S(['74103']));
    expect(state.pinned.size).toBe(0);
    expect(state.transient.size).toBe(0);
  });

  it('computeToggle additive false deselects when clicked area is the only pinned selection', () => {
    const state = computeToggle('74103', false, S(['74103']), S([]));
    expect(state.pinned.size).toBe(0);
    expect(state.transient.size).toBe(0);
  });

  it('computeAddTransient unions sets', () => {
    const next = computeAddTransient(['a', 'b'], S(['a']));
    expect([...next].sort()).toEqual(['a', 'b']);
  });

  it('computeClearTransient returns empty set', () => {
    expect(computeClearTransient().size).toBe(0);
  });

  it('getSelectedSet merges pinned and transient', () => {
    const merged = getSelectedSet({ pinned: S(['a']), transient: S(['b']) });
    expect([...merged].sort()).toEqual(['a', 'b']);
  });
});

