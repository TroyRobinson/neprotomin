export type AreaKind = "ZIP" | "COUNTY" | "TRACT";

export interface AreaId {
  kind: AreaKind;
  id: string;
}

export const AREA_KINDS: AreaKind[] = ["ZIP", "COUNTY", "TRACT"];

export const createAreaId = (kind: AreaKind, id: string): AreaId => ({ kind, id });

export const areaIdKey = (area: AreaId): string => `${area.kind}:${area.id}`;

export const isAreaId = (value: unknown): value is AreaId => {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<AreaId>;
  return typeof candidate.kind === "string" && typeof candidate.id === "string";
};

export const areaIdsEqual = (a: AreaId | null | undefined, b: AreaId | null | undefined): boolean => {
  if (!a || !b) return false;
  return a.kind === b.kind && a.id === b.id;
};
