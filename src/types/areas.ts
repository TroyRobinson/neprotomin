export type AreaKind = "ZIP" | "COUNTY" | "TRACT";

export interface AreaId {
  kind: AreaKind;
  id: string;
}

export interface AreaRecord {
  id: string;
  code: string;
  kind: AreaKind;
  name: string;
  parentCode?: string | null;
  centroid?: [number, number] | null;
  bounds?: [[number, number], [number, number]] | null;
  isActive?: boolean | null;
}

export const AREA_KINDS: AreaKind[] = ["ZIP", "COUNTY", "TRACT"];

export const DEFAULT_PARENT_AREA_BY_KIND: Record<AreaKind, string | null> = {
  ZIP: "Oklahoma",
  COUNTY: "Oklahoma",
  TRACT: null,
};

export const DEFAULT_SCOPE_LABEL_BY_KIND: Record<AreaKind, string> = {
  ZIP: "Oklahoma ZIPs",
  COUNTY: "Oklahoma Counties",
  TRACT: "Tracts",
};

export interface PersistedAreaSelection {
  version?: number;
  boundaryMode?: string | null;
  areaSelections?: Record<
    string,
    { selected?: string[]; pinned?: string[]; transient?: string[] }
  >;
  zips?: string[];
  pinned?: string[];
  counties?: { selected?: string[]; pinned?: string[] };
}

export const createAreaId = (kind: AreaKind, id: string): AreaId => ({ kind, id });

export const areaIdKey = (area: AreaId): string => `${area.kind}:${area.id}`;

export const areaCodeKey = (kind: AreaKind, code: string): string => areaIdKey({ kind, id: code });

export const isAreaId = (value: unknown): value is AreaId => {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<AreaId>;
  return typeof candidate.kind === "string" && typeof candidate.id === "string";
};

export const isAreaKind = (value: unknown): value is AreaKind =>
  typeof value === "string" && (AREA_KINDS as string[]).includes(value);

export const parseAreaKind = (value: unknown): AreaKind | null =>
  isAreaKind(value) ? (value as AreaKind) : null;

export const areaIdsEqual = (a: AreaId | null | undefined, b: AreaId | null | undefined): boolean => {
  if (!a || !b) return false;
  return a.kind === b.kind && a.id === b.id;
};
