export const CATEGORY_FILTER_LABEL_MAX_CHARS = 6;

export type SupportedAreaKind = "ZIP" | "COUNTY";

export const abbreviateCategoryFilterLabel = (label: string): string => {
  const trimmed = label.trim();
  if (trimmed.length <= CATEGORY_FILTER_LABEL_MAX_CHARS) return trimmed;
  return `${trimmed.slice(0, CATEGORY_FILTER_LABEL_MAX_CHARS - 2)}..`;
};

export const areaKey = (kind: SupportedAreaKind, id: string): string => `${kind}:${id}`;
