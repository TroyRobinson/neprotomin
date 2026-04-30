import type { AreaKind } from "../../types/areas";

export interface AreaSelectionState {
  selected: string[];
  pinned: string[];
  transient: string[];
}

export interface AreaSelectionSnapshot {
  kind: AreaKind;
  selected: string[];
  pinned: string[];
}

export type AreaSelectionMap = Record<AreaKind, AreaSelectionState>;

export const createEmptySelection = (): AreaSelectionState => ({
  selected: [],
  pinned: [],
  transient: [],
});

export const dedupeIds = (ids: string[]): string[] => {
  if (!ids || ids.length === 0) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const id of ids) {
    if (!seen.has(id)) {
      seen.add(id);
      result.push(id);
    }
  }
  return result;
};

export const arraysEqual = (a: string[], b: string[]): boolean => {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
};

export const normalizeAreaSelection = (selection: AreaSelectionState): AreaSelectionState => ({
  selected: dedupeIds(selection.selected),
  pinned: dedupeIds(selection.pinned),
  transient: dedupeIds(selection.transient),
});

export const areaSelectionsEqual = (
  a: AreaSelectionState,
  b: AreaSelectionState,
): boolean =>
  arraysEqual(a.selected, b.selected) &&
  arraysEqual(a.pinned, b.pinned) &&
  arraysEqual(a.transient, b.transient);
