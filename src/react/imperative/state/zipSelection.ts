export interface ZipSelectionState {
  pinned: Set<string>;
  transient: Set<string>;
}

export const getSelectedSet = (state: ZipSelectionState): Set<string> => {
  return new Set<string>([...state.pinned, ...state.transient]);
};

export const computeToggle = (
  zip: string,
  additive: boolean,
  pinned: Set<string>,
  transient: Set<string>,
): ZipSelectionState => {
  const isPinned = pinned.has(zip);
  const isTransient = transient.has(zip);
  const isSelected = isPinned || isTransient;

  let nextPinned = new Set(pinned);
  let nextTransient = new Set(transient);
  const selectedCount = new Set<string>([...pinned, ...transient]).size;

  if (additive) {
    if (isSelected) {
      if (isPinned) {
        nextPinned.delete(zip);
      }
      if (isTransient) {
        nextTransient.delete(zip);
      }
    } else {
      nextTransient.add(zip);
    }
  } else {
    // Single-select click should deselect when this is the only selected area.
    if (isSelected && selectedCount === 1) {
      if (isPinned) nextPinned.delete(zip);
      if (isTransient) nextTransient.delete(zip);
    } else if (isPinned) {
      // Preserve pinned; clear any transient selection
      if (nextTransient.size > 0) nextTransient = new Set();
    } else if (isTransient) {
      nextTransient = new Set([zip]);
    } else {
      nextTransient = new Set([zip]);
    }
  }

  return { pinned: nextPinned, transient: nextTransient };
};

export const computeAddTransient = (
  zips: string[],
  transient: Set<string>,
): Set<string> => {
  const next = new Set(transient);
  for (const z of zips) next.add(z);
  return next;
};

export const computeClearTransient = (): Set<string> => {
  return new Set<string>();
};
