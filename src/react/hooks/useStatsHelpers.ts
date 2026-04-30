import type { Stat } from "../../types/stat";

export const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

export const parseBooleanFlag = (value: string | null | undefined): boolean | null => {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on", "debug", "verbose"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return null;
};

export const readBooleanFlagFromStorage = (key: string): boolean | null => {
  if (typeof window === "undefined") return null;
  try {
    return parseBooleanFlag(window.localStorage.getItem(key));
  } catch {
    return null;
  }
};

export const resolveBooleanFlag = ({
  urlValue,
  storageValue,
  fallback,
}: {
  urlValue: boolean | null;
  storageValue: boolean | null;
  fallback: boolean;
}): boolean => {
  if (urlValue !== null) return urlValue;
  if (storageValue !== null) return storageValue;
  return fallback;
};

export const previewIds = (ids: string[], max = 6): string[] => ids.slice(0, max);

export type SelectedAreaResolution = {
  selectedStatId: string;
  total: number;
  resolved: number;
  unresolved: number;
  selectedZipCount: number;
  selectedCountyCount: number;
};

export const computeSelectedAreaResolution = ({
  rows,
  selectedStatId,
  selectedZipIds,
  selectedCountyIds,
}: {
  rows: any[];
  selectedStatId: string | null;
  selectedZipIds: string[];
  selectedCountyIds: string[];
}): SelectedAreaResolution | null => {
  if (!selectedStatId) return null;
  const normalizedZips = selectedZipIds.filter((id) => typeof id === "string" && id.length > 0);
  const normalizedCounties = selectedCountyIds.filter((id) => typeof id === "string" && id.length > 0);
  const total = normalizedZips.length + normalizedCounties.length;
  if (total === 0) return null;

  const zipTargets = new Set(normalizedZips);
  const countyTargets = new Set(normalizedCounties);
  const resolvedAreaKeys = new Set<string>();

  for (const row of rows) {
    if (typeof row?.statId !== "string" || row.statId !== selectedStatId) continue;
    const boundaryType = typeof row?.boundaryType === "string" ? row.boundaryType.toUpperCase() : "";
    const targets = boundaryType === "ZIP" ? zipTargets : boundaryType === "COUNTY" ? countyTargets : null;
    if (!targets || targets.size === 0) continue;
    const data = row?.data;
    if (!data || typeof data !== "object") continue;
    const record = data as Record<string, unknown>;
    for (const areaId of targets) {
      if (isFiniteNumber(record[areaId])) {
        resolvedAreaKeys.add(`${boundaryType}:${areaId}`);
      }
    }
  }

  const resolved = resolvedAreaKeys.size;
  return {
    selectedStatId,
    total,
    resolved,
    unresolved: Math.max(0, total - resolved),
    selectedZipCount: normalizedZips.length,
    selectedCountyCount: normalizedCounties.length,
  };
};

export const getContextSet = (
  map: Map<string, Set<string>>,
  contextKey: string,
): Set<string> => map.get(contextKey) ?? new Set<string>();

export const addIdsToContext = (
  prev: Map<string, Set<string>>,
  contextKey: string,
  ids: Iterable<string>,
): Map<string, Set<string>> => {
  const existing = prev.get(contextKey) ?? new Set<string>();
  const nextSet = new Set(existing);
  let changed = false;
  for (const id of ids) {
    if (typeof id !== "string" || id.length === 0) continue;
    if (!nextSet.has(id)) {
      nextSet.add(id);
      changed = true;
    }
  }
  if (!changed) return prev;
  const next = new Map(prev);
  next.set(contextKey, nextSet);
  return next;
};

export const removeIdsFromContext = (
  prev: Map<string, Set<string>>,
  contextKey: string,
  ids: Iterable<string>,
): Map<string, Set<string>> => {
  const existing = prev.get(contextKey);
  if (!existing || existing.size === 0) return prev;
  const removeSet = new Set<string>();
  for (const id of ids) {
    if (typeof id === "string" && id.length > 0) removeSet.add(id);
  }
  if (removeSet.size === 0) return prev;
  let changed = false;
  const nextSet = new Set(existing);
  for (const id of removeSet) {
    if (nextSet.delete(id)) changed = true;
  }
  if (!changed) return prev;
  const next = new Map(prev);
  if (nextSet.size === 0) next.delete(contextKey);
  else next.set(contextKey, nextSet);
  return next;
};

export const removeIdsFromAllContexts = (
  prev: Map<string, Set<string>>,
  ids: Iterable<string>,
): Map<string, Set<string>> => {
  const removeSet = new Set<string>();
  for (const id of ids) {
    if (typeof id === "string" && id.length > 0) removeSet.add(id);
  }
  if (removeSet.size === 0 || prev.size === 0) return prev;

  let changed = false;
  const next = new Map<string, Set<string>>();
  for (const [contextKey, contextIds] of prev.entries()) {
    const nextSet = new Set(contextIds);
    for (const id of removeSet) {
      if (nextSet.delete(id)) changed = true;
    }
    if (nextSet.size > 0) next.set(contextKey, nextSet);
  }
  return changed ? next : prev;
};

export const makeLoadedContextKey = (contextKey: string, statId: string): string =>
  `${contextKey}::${statId}`;

export const addLoadedIdsToContext = (
  prev: Set<string>,
  contextKey: string,
  ids: Iterable<string>,
): Set<string> => {
  const next = new Set(prev);
  let changed = false;
  for (const statId of ids) {
    if (typeof statId !== "string" || statId.length === 0) continue;
    const key = makeLoadedContextKey(contextKey, statId);
    if (!next.has(key)) {
      next.add(key);
      changed = true;
    }
  }
  return changed ? next : prev;
};

export const removeLoadedIdsFromAllContexts = (
  prev: Set<string>,
  ids: Iterable<string>,
): Set<string> => {
  const removeSet = new Set<string>();
  for (const id of ids) {
    if (typeof id === "string" && id.length > 0) removeSet.add(id);
  }
  if (removeSet.size === 0 || prev.size === 0) return prev;

  let changed = false;
  const next = new Set<string>();
  for (const key of prev) {
    // Key format is `${queryContextKey}::${statId}`; strip only the trailing stat id.
    const separatorIndex = key.lastIndexOf("::");
    const statId = separatorIndex >= 0 ? key.slice(separatorIndex + 2) : "";
    if (removeSet.has(statId)) {
      changed = true;
      continue;
    }
    next.add(key);
  }
  return changed ? next : prev;
};

export const getEffectiveStatType = (
  statId: string,
  declaredType: string,
  statsById: Map<string, Stat>,
): string => {
  const stat = statsById.get(statId);
  const explicitType = stat?.type;

  if (explicitType && explicitType !== "count") return explicitType;
  if (declaredType && declaredType !== "count") return declaredType;

  const name = (stat?.label || stat?.name || "").toLowerCase();
  if (name.includes("(dollars)") || name.includes("(usd)")) return "currency";

  return declaredType || "count";
};
