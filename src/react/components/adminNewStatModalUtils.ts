import type { ImportRelationship } from "../types/censusImport";

export type StatItem = {
  id: string;
  name: string;
  label?: string | null;
  category: string;
  neId?: string | null;
  source?: string | null;
};

export type CensusVariablePreview = {
  name: string;
  label: string;
  concept?: string;
  predicateType?: string;
  inferredType: string;
  statName: string;
  statLabel?: string;
  zipCount: number;
  countyCount: number;
};

export type CensusPreviewMeta = {
  dataset: string;
  group: string;
  year: number;
  universe: string | null;
  concept: string | null;
};

export type VariableSelection = {
  selected: boolean;
  yearEnd: number | null;
  yearStart: number | null;
  relationship: ImportRelationship;
  statAttribute: string;
  lockedImported: boolean;
  importedStatId: string | null;
  importedStatLabel: string | null;
  importedStatName: string | null;
};

export const DEFAULT_CENSUS_DATASET = "acs/acs5";

export const formatPredicateTypeLabel = (predicateType?: string | null): string | null => {
  if (!predicateType) return null;
  const normalized = predicateType.trim().toLowerCase();
  if (!normalized) return null;
  if (["int", "integer", "long", "short"].includes(normalized)) return "Whole number";
  if (["float", "double", "decimal"].includes(normalized)) return "Decimal number";
  if (["string", "str"].includes(normalized)) return "Text";
  if (["boolean", "bool"].includes(normalized)) return "Yes/No";
  if (normalized === "number") return "Number";
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
};

export const inferUniverseFromConcept = (concept?: string | null): string | null => {
  if (!concept) return null;
  const normalized = concept.trim();
  if (!normalized) return null;
  const lower = normalized.toLowerCase();
  const markers = [" for the ", " for ", " among the ", " among "];
  let bestIndex = -1;
  let bestMarker = "";
  for (const marker of markers) {
    const idx = lower.lastIndexOf(marker);
    if (idx > bestIndex) {
      bestIndex = idx;
      bestMarker = marker;
    }
  }
  if (bestIndex === -1) return null;
  const candidate = normalized.slice(bestIndex + bestMarker.length).trim();
  return candidate || null;
};

// Heuristic: group IDs are typically like B22003, S1701, DP02, etc.
export const looksLikeGroupId = (value: string): boolean => {
  const trimmed = value.trim();
  if (!trimmed) return false;
  return /^(?:[A-Z]{1,2}\d{3,5}[A-Z]?|(?:DP|CP)\d{2,5}[A-Z]?)$/i.test(trimmed);
};

// Auto-pick the correct Census dataset for common group prefixes when the user keeps the default.
export const inferDatasetForGroup = (
  group: string,
  dataset: string,
): { dataset: string; changed: boolean } => {
  const trimmedGroup = group.trim().toUpperCase();
  const normalizedDataset = dataset.trim() || DEFAULT_CENSUS_DATASET;
  if (!trimmedGroup) return { dataset: normalizedDataset, changed: false };
  if (normalizedDataset !== DEFAULT_CENSUS_DATASET) return { dataset: normalizedDataset, changed: false };

  if (trimmedGroup.startsWith("DP")) return { dataset: "acs/acs5/profile", changed: true };
  if (trimmedGroup.startsWith("CP")) return { dataset: "acs/acs5/cprofile", changed: true };
  if (trimmedGroup.startsWith("S")) return { dataset: "acs/acs5/subject", changed: true };
  return { dataset: normalizedDataset, changed: false };
};

export const filterStatsBySearch = (
  stats: StatItem[],
  search: string,
  limitResults = 30,
): StatItem[] => {
  const term = search.trim().toLowerCase();
  const candidates = term
    ? stats.filter((stat) => {
        const label = (stat.label ?? "").toLowerCase();
        const name = stat.name.toLowerCase();
        const neId = (stat.neId ?? "").toLowerCase();
        return label.includes(term) || name.includes(term) || neId.includes(term);
      })
    : stats;
  return candidates.slice(0, limitResults);
};

export const getYearRange = (
  sel: { yearEnd: number | null; yearStart: number | null },
  defaultYear: number,
): { year: number; years: number } => {
  const hasStart = sel.yearStart !== null;
  const hasEnd = sel.yearEnd !== null;

  if (hasStart && hasEnd) {
    const start = sel.yearStart!;
    const end = sel.yearEnd!;
    return { year: end, years: Math.max(1, end - start + 1) };
  }
  if (hasEnd) return { year: sel.yearEnd!, years: 1 };
  if (hasStart) return { year: sel.yearStart!, years: 1 };
  return { year: defaultYear, years: 1 };
};

export const getPredicateTypeSummary = (
  variables: CensusVariablePreview[],
): string | null => {
  const labels = new Map<string, string>();
  variables.forEach((variable) => {
    const label = formatPredicateTypeLabel(variable.predicateType);
    if (!label) return;
    const key = label.toLowerCase();
    if (!labels.has(key)) labels.set(key, label);
  });
  if (labels.size === 0) return null;
  const types = Array.from(labels.values());
  return types.length === 1 ? types[0] : `Mixed (${types.join(", ")})`;
};

export const getConceptDisplay = (
  variables: CensusVariablePreview[],
  fallbackConcept?: string | null,
): { shared: string | null; showPerVariable: boolean } => {
  const entries = variables
    .map((variable) => (typeof variable.concept === "string" ? variable.concept.trim() : ""))
    .filter(Boolean);
  if (entries.length === 0) {
    const fallback = fallbackConcept?.trim();
    return { shared: fallback || null, showPerVariable: false };
  }

  const unique = new Map<string, string>();
  variables.forEach((variable) => {
    const concept = typeof variable.concept === "string" ? variable.concept.trim() : "";
    if (!concept) return;
    const key = concept.toLowerCase();
    if (!unique.has(key)) unique.set(key, concept);
  });
  const allHaveConcept = variables.every(
    (variable) => typeof variable.concept === "string" && variable.concept.trim().length > 0,
  );
  if (unique.size === 1 && allHaveConcept) {
    return { shared: Array.from(unique.values())[0], showPerVariable: false };
  }
  return { shared: null, showPerVariable: true };
};

export const getPendingSelections = (
  variables: CensusVariablePreview[],
  selection: Record<string, VariableSelection>,
  defaultYear: number,
): Array<{ variable: string; year: number; years: number }> =>
  variables
    .map((variable) => {
      const sel = selection[variable.name];
      if (!sel || !sel.selected || sel.lockedImported) return null;
      return { variable: variable.name, ...getYearRange(sel, defaultYear) };
    })
    .filter((item): item is { variable: string; year: number; years: number } => item !== null);

export const getRelationshipConfigError = ({
  selection,
  hasManualParent,
  pendingSelectionCount,
}: {
  selection: Record<string, VariableSelection>;
  hasManualParent: boolean;
  pendingSelectionCount: number;
}): string | null => {
  const selectedValues = Object.values(selection).filter((value) => value.selected);
  const parents = selectedValues.filter((value) => value.relationship === "parent" && !value.lockedImported);
  const children = selectedValues.filter((value) => value.relationship === "child" && !value.lockedImported);
  const importedParents = selectedValues.filter(
    (value) => value.relationship === "parent" && value.lockedImported && Boolean(value.importedStatId),
  );
  const parentCount = parents.length + importedParents.length + (hasManualParent ? 1 : 0);
  if (parentCount > 1) return "Only one Parent is allowed per import.";
  if (hasManualParent && pendingSelectionCount > 0 && children.length === 0) {
    return "Parent selected but no Child stats selected. Mark at least one variable as Child.";
  }
  if (children.length > 0 && parentCount !== 1) {
    return "Select exactly one Parent when using Child relationships.";
  }
  return null;
};
