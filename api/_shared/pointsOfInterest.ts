import { lookup, tx } from "@instantdb/admin";

type PoiBoundaryType = "ZIP" | "COUNTY";
type PoiExtremaKind = "high" | "low";

export type PoiScopeKey = "oklahoma" | "tulsa_area" | "okc_area";
export type PoiRecomputeAction = "recompute" | "deactivate";

type PoiStatRow = {
  id: string;
  name: string;
  label?: string | null;
  category: string;
  goodIfUp?: boolean | null;
  pointsOfInterestEnabled?: boolean | null;
  visibility?: string | null;
  visibilityEffective?: string | null;
  active?: boolean | null;
};

type AreaRow = {
  code: string;
  kind: string;
  name: string;
  parentCode?: string | null;
  isActive?: boolean | null;
};

type SummaryContext = {
  boundaryType: PoiBoundaryType;
  parentArea: string;
  date: string;
  normalizedParentArea: string;
};

type StatDataRow = {
  boundaryType: PoiBoundaryType;
  parentArea: string;
  date: string;
  data: Record<string, number>;
};

type ScopeMembership = {
  ZIP: Set<string>;
  COUNTY: Set<string>;
  countyScopeLabels: Set<string>;
};

type AreaIndex = {
  allZipCodes: Set<string>;
  allCountyCodes: Set<string>;
  countyLabelByCode: Map<string, string>;
  zipCodesByCountyLabel: Map<string, Set<string>>;
  areaNameByBoundary: Record<PoiBoundaryType, Map<string, string>>;
};

type InstantAdminLike = {
  query: (query: unknown) => Promise<unknown>;
  transact: (ops: unknown[]) => Promise<unknown>;
};

export type PoiRecomputeOptions = {
  statId: string;
  action?: PoiRecomputeAction;
  force?: boolean;
  runId?: string;
};

export type PoiRecomputeResult = {
  ok: boolean;
  action: PoiRecomputeAction;
  statId: string;
  runId: string;
  computedAt: number;
  rowsUpserted: number;
  rowsDeactivated: number;
  rowsConsidered: number;
  skipped?: boolean;
  reason?: string;
};

type ComputedPoiRecord = {
  poiKey: string;
  statId: string;
  statCategory: string;
  statName: string | null;
  boundaryType: PoiBoundaryType;
  scopeKey: PoiScopeKey;
  scopeLabel: string;
  extremaKind: PoiExtremaKind;
  areaCode: string;
  areaName: string | null;
  value: number;
  goodIfUp: boolean | null;
  isActive: boolean;
  computedAt: number;
  sourceDate: string | null;
  runId: string;
};

const MAX_QUERY_LIMIT = 2000;
const TX_CHUNK_SIZE = 50;

const OKLAHOMA_SCOPE_LABEL = "Oklahoma";

// Keep API shared code self-contained so serverless runtime does not depend on src/ imports.
const normalizeWordsLocal = (value: string): string =>
  value
    .split(/\s+/)
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1).toLowerCase())
    .join(" ");

const normalizeScopeLabel = (value: string | null | undefined): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return normalizeWordsLocal(trimmed);
};

const stripOklahomaSuffixLocal = (value: string): string =>
  value.replace(/,\s*Oklahoma$/i, "").trim();

const stripCountySuffixLocal = (value: string): string =>
  value.replace(/\s+County$/i, "").trim();

const formatCountyScopeLabel = (value: string | null | undefined): string | null => {
  const normalized = normalizeScopeLabel(value);
  if (!normalized) return null;
  const withoutCounty = stripCountySuffixLocal(stripOklahomaSuffixLocal(normalized));
  const base = normalizeScopeLabel(withoutCounty);
  if (!base) return null;
  return `${base} County`;
};

const COUNTY_NAME_FALLBACK_BY_CODE: Record<string, string> = {
  "40017": "Canadian County",
  "40027": "Cleveland County",
  "40037": "Creek County",
  "40073": "Kingfisher County",
  "40081": "Lincoln County",
  "40083": "Logan County",
  "40109": "Oklahoma County",
  "40111": "Okmulgee County",
  "40113": "Osage County",
  "40117": "Pawnee County",
  "40125": "Pottawatomie County",
  "40131": "Rogers County",
  "40143": "Tulsa County",
  "40145": "Wagoner County",
  "40147": "Washington County",
};

const SCOPE_DEFINITIONS: Record<
  PoiScopeKey,
  { label: string; countyCodes: string[] | null }
> = {
  oklahoma: { label: "Oklahoma", countyCodes: null },
  tulsa_area: {
    label: "Tulsa Area",
    countyCodes: [
      "40143", // Tulsa
      "40037", // Creek
      "40111", // Okmulgee
      "40113", // Osage
      "40117", // Pawnee
      "40131", // Rogers
      "40145", // Wagoner
      "40147", // Washington
    ],
  },
  okc_area: {
    label: "Oklahoma City Area",
    countyCodes: [
      "40109", // Oklahoma
      "40017", // Canadian
      "40027", // Cleveland
      "40073", // Kingfisher
      "40081", // Lincoln
      "40083", // Logan
      "40125", // Pottawatomie
    ],
  },
};

const normalizeVisibility = (value: unknown): "inactive" | "private" | "public" | null => {
  if (value !== "inactive" && value !== "private" && value !== "public") return null;
  return value;
};

const normalizeFiniteNumber = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
};

const normalizeDataMap = (value: unknown): Record<string, number> => {
  const out: Record<string, number> = {};
  if (!value || typeof value !== "object") return out;
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    const num = normalizeFiniteNumber(raw);
    if (num == null) continue;
    out[key] = num;
  }
  return out;
};

const normalizeBoundaryType = (value: unknown): PoiBoundaryType | null => {
  if (value === "ZIP" || value === "COUNTY") return value;
  return null;
};

const unwrapRows = <T>(resp: unknown, key: string): T[] => {
  const asRecord = (resp && typeof resp === "object" ? resp : null) as
    | Record<string, unknown>
    | null;
  if (!asRecord) return [];
  const direct = asRecord[key];
  if (Array.isArray(direct)) return direct as T[];
  const nested = asRecord.data;
  if (nested && typeof nested === "object" && Array.isArray((nested as Record<string, unknown>)[key])) {
    return (nested as Record<string, unknown>)[key] as T[];
  }
  return [];
};

const chunk = <T>(items: T[], size: number): T[][] => {
  const out: T[][] = [];
  if (size <= 0) return out;
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
};

const makePoiKey = (
  statId: string,
  scopeKey: PoiScopeKey,
  boundaryType: PoiBoundaryType,
  extremaKind: PoiExtremaKind,
): string => `${statId}::${scopeKey}::${boundaryType}::${extremaKind}`;

const createRunId = (): string =>
  `poi_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

const getStatEffectiveVisibility = (stat: PoiStatRow): "inactive" | "private" | "public" => {
  const effective = normalizeVisibility(stat.visibilityEffective);
  if (effective) return effective;
  const declared = normalizeVisibility(stat.visibility);
  if (declared) return declared;
  if (stat.active === false) return "inactive";
  return "public";
};

const buildAreaIndex = (rows: AreaRow[]): AreaIndex => {
  const allZipCodes = new Set<string>();
  const allCountyCodes = new Set<string>();
  const countyLabelByCode = new Map<string, string>();
  const zipCodesByCountyLabel = new Map<string, Set<string>>();
  const areaNameByBoundary: Record<PoiBoundaryType, Map<string, string>> = {
    ZIP: new Map<string, string>(),
    COUNTY: new Map<string, string>(),
  };

  for (const row of rows) {
    if (!row.code || !row.kind || !row.name) continue;
    if (row.isActive === false) continue;
    const boundaryType = normalizeBoundaryType(row.kind);
    if (!boundaryType) continue;
    areaNameByBoundary[boundaryType].set(row.code, row.name);

    if (boundaryType === "COUNTY") {
      allCountyCodes.add(row.code);
      const countyLabel =
        formatCountyScopeLabel(row.name) ??
        formatCountyScopeLabel(COUNTY_NAME_FALLBACK_BY_CODE[row.code] ?? null) ??
        normalizeScopeLabel(row.name);
      if (countyLabel) countyLabelByCode.set(row.code, countyLabel);
      continue;
    }

    allZipCodes.add(row.code);
    const normalizedParent =
      formatCountyScopeLabel(row.parentCode) ??
      normalizeScopeLabel(row.parentCode);
    if (!normalizedParent) continue;
    const set = zipCodesByCountyLabel.get(normalizedParent) ?? new Set<string>();
    set.add(row.code);
    zipCodesByCountyLabel.set(normalizedParent, set);
  }

  return {
    allZipCodes,
    allCountyCodes,
    countyLabelByCode,
    zipCodesByCountyLabel,
    areaNameByBoundary,
  };
};

const buildScopeMembership = (areas: AreaIndex): Record<PoiScopeKey, ScopeMembership> => {
  const out = {} as Record<PoiScopeKey, ScopeMembership>;

  for (const [scopeKey, def] of Object.entries(SCOPE_DEFINITIONS) as Array<
    [PoiScopeKey, { label: string; countyCodes: string[] | null }]
  >) {
    if (!def.countyCodes) {
      const countyLabels = new Set<string>();
      for (const label of areas.countyLabelByCode.values()) countyLabels.add(label);
      out[scopeKey] = {
        ZIP: new Set<string>(areas.allZipCodes),
        COUNTY: new Set<string>(areas.allCountyCodes),
        countyScopeLabels: countyLabels,
      };
      continue;
    }

    const countyCodes = new Set<string>();
    const countyScopeLabels = new Set<string>();
    const zipCodes = new Set<string>();

    for (const countyCode of def.countyCodes) {
      countyCodes.add(countyCode);
      const countyLabel =
        areas.countyLabelByCode.get(countyCode) ??
        formatCountyScopeLabel(COUNTY_NAME_FALLBACK_BY_CODE[countyCode] ?? null) ??
        normalizeScopeLabel(COUNTY_NAME_FALLBACK_BY_CODE[countyCode] ?? null);
      if (!countyLabel) continue;
      countyScopeLabels.add(countyLabel);
      const countyZipSet = areas.zipCodesByCountyLabel.get(countyLabel);
      if (!countyZipSet) continue;
      for (const zip of countyZipSet) zipCodes.add(zip);
    }

    out[scopeKey] = {
      ZIP: zipCodes,
      COUNTY: countyCodes,
      countyScopeLabels,
    };
  }

  return out;
};

const buildParentAreaAliasSet = (scope: ScopeMembership): Set<string> => {
  const aliases = new Set<string>();
  const statewide = normalizeScopeLabel(OKLAHOMA_SCOPE_LABEL);
  if (statewide) aliases.add(statewide);

  for (const countyLabel of scope.countyScopeLabels) {
    const normalized = normalizeScopeLabel(countyLabel);
    if (normalized) aliases.add(normalized);
    const withoutCounty = normalizeScopeLabel(countyLabel.replace(/\s+County$/i, ""));
    if (withoutCounty) aliases.add(withoutCounty);
    const withCounty = formatCountyScopeLabel(countyLabel);
    if (withCounty) aliases.add(withCounty);
  }

  return aliases;
};

const extractExtrema = (
  data: Record<string, number>,
  membership: Set<string>,
): { high: { areaCode: string; value: number } | null; low: { areaCode: string; value: number } | null; considered: number } => {
  const entries = Object.entries(data)
    .filter(([areaCode, value]) => membership.has(areaCode) && typeof value === "number" && Number.isFinite(value))
    .sort(([a], [b]) => a.localeCompare(b));

  if (entries.length === 0) {
    return { high: null, low: null, considered: 0 };
  }

  let high = entries[0];
  let low = entries[0];

  for (const entry of entries) {
    if (entry[1] > high[1]) high = entry;
    if (entry[1] < low[1]) low = entry;
  }

  return {
    high: { areaCode: high[0], value: high[1] },
    low: { areaCode: low[0], value: low[1] },
    considered: entries.length,
  };
};

const fetchStat = async (db: InstantAdminLike, statId: string): Promise<PoiStatRow | null> => {
  const resp = await db.query({
    stats: {
      $: {
        where: { id: statId },
        limit: 1,
        fields: [
          "id",
          "name",
          "label",
          "category",
          "goodIfUp",
          "pointsOfInterestEnabled",
          "visibility",
          "visibilityEffective",
          "active",
        ],
      },
    },
  });
  const rows = unwrapRows<PoiStatRow>(resp, "stats");
  return rows[0] ?? null;
};

const fetchAreas = async (db: InstantAdminLike): Promise<AreaRow[]> => {
  const resp = await db.query({
    areas: {
      $: {
        where: { kind: { $in: ["ZIP", "COUNTY"] } },
        fields: ["code", "kind", "name", "parentCode", "isActive"],
        limit: MAX_QUERY_LIMIT,
      },
    },
  });
  const rows = unwrapRows<any>(resp, "areas");
  const out: AreaRow[] = [];
  for (const row of rows) {
    const code = typeof row?.code === "string" ? row.code : null;
    const kind = typeof row?.kind === "string" ? row.kind : null;
    const name = typeof row?.name === "string" ? row.name : null;
    if (!code || !kind || !name) continue;
    out.push({
      code,
      kind,
      name,
      parentCode: typeof row?.parentCode === "string" ? row.parentCode : null,
      isActive: typeof row?.isActive === "boolean" ? row.isActive : null,
    });
  }
  return out;
};

const fetchSummaryContexts = async (
  db: InstantAdminLike,
  statId: string,
  boundaryType: PoiBoundaryType,
): Promise<SummaryContext[]> => {
  const resp = await db.query({
    statDataSummaries: {
      $: {
        where: {
          statId,
          name: "root",
          boundaryType,
        },
        fields: ["parentArea", "date", "boundaryType"],
        limit: MAX_QUERY_LIMIT,
      },
    },
  });
  const rows = unwrapRows<any>(resp, "statDataSummaries");
  const out: SummaryContext[] = [];
  for (const row of rows) {
    const parentArea = typeof row?.parentArea === "string" ? row.parentArea : null;
    const date = typeof row?.date === "string" ? row.date : null;
    const normalizedParentArea = normalizeScopeLabel(parentArea);
    if (!parentArea || !date || !normalizedParentArea) continue;
    out.push({
      boundaryType,
      parentArea,
      date,
      normalizedParentArea,
    });
  }
  return out;
};

const contextKey = (boundaryType: PoiBoundaryType, parentArea: string, date: string): string =>
  `${boundaryType}::${parentArea}::${date}`;

const fetchStatDataRowsForContexts = async (
  db: InstantAdminLike,
  statId: string,
  boundaryType: PoiBoundaryType,
  contexts: SummaryContext[],
): Promise<Map<string, StatDataRow>> => {
  if (contexts.length === 0) return new Map();
  const parentAreas = Array.from(new Set(contexts.map((ctx) => ctx.parentArea)));
  const dates = Array.from(new Set(contexts.map((ctx) => ctx.date)));
  const resp = await db.query({
    statData: {
      $: {
        where: {
          statId,
          name: "root",
          boundaryType,
          parentArea: { $in: parentAreas },
          date: { $in: dates },
        },
        fields: ["boundaryType", "parentArea", "date", "data"],
        limit: MAX_QUERY_LIMIT,
      },
    },
  });
  const rows = unwrapRows<any>(resp, "statData");
  const out = new Map<string, StatDataRow>();
  for (const row of rows) {
    const parentArea = typeof row?.parentArea === "string" ? row.parentArea : null;
    const date = typeof row?.date === "string" ? row.date : null;
    const parsedBoundary = normalizeBoundaryType(row?.boundaryType);
    if (!parentArea || !date || !parsedBoundary) continue;
    out.set(contextKey(parsedBoundary, parentArea, date), {
      boundaryType: parsedBoundary,
      parentArea,
      date,
      data: normalizeDataMap(row?.data),
    });
  }
  return out;
};

const buildComputedRecords = (
  stat: PoiStatRow,
  memberships: Record<PoiScopeKey, ScopeMembership>,
  summariesByBoundary: Record<PoiBoundaryType, SummaryContext[]>,
  statDataRowsByContextKey: Record<PoiBoundaryType, Map<string, StatDataRow>>,
  areas: AreaIndex,
  computedAt: number,
  runId: string,
): { records: ComputedPoiRecord[]; rowsConsidered: number } => {
  const records: ComputedPoiRecord[] = [];
  let rowsConsidered = 0;
  const statName = stat.label && stat.label.trim() ? stat.label : stat.name;
  const goodIfUp = typeof stat.goodIfUp === "boolean" ? stat.goodIfUp : null;

  for (const [scopeKey, scopeDef] of Object.entries(SCOPE_DEFINITIONS) as Array<
    [PoiScopeKey, { label: string; countyCodes: string[] | null }]
  >) {
    const membership = memberships[scopeKey];
    const parentAliases = buildParentAreaAliasSet(membership);

    for (const boundaryType of ["ZIP", "COUNTY"] as const) {
      const contexts = summariesByBoundary[boundaryType]
        .filter((ctx) => parentAliases.has(ctx.normalizedParentArea))
        .sort((a, b) => {
          const parentCompare = a.parentArea.localeCompare(b.parentArea);
          if (parentCompare !== 0) return parentCompare;
          return a.date.localeCompare(b.date);
        });

      if (contexts.length === 0) continue;

      const merged: Record<string, number> = {};
      let sourceDate: string | null = null;
      for (const ctx of contexts) {
        const key = contextKey(boundaryType, ctx.parentArea, ctx.date);
        const row = statDataRowsByContextKey[boundaryType].get(key);
        if (!row) continue;
        if (!sourceDate || row.date.localeCompare(sourceDate) > 0) {
          sourceDate = row.date;
        }
        Object.assign(merged, row.data);
      }

      const extrema = extractExtrema(merged, membership[boundaryType]);
      rowsConsidered += extrema.considered;
      if (!extrema.high) continue;

      const highRecord: ComputedPoiRecord = {
        poiKey: makePoiKey(stat.id, scopeKey, boundaryType, "high"),
        statId: stat.id,
        statCategory: stat.category,
        statName,
        boundaryType,
        scopeKey,
        scopeLabel: scopeDef.label,
        extremaKind: "high",
        areaCode: extrema.high.areaCode,
        areaName: areas.areaNameByBoundary[boundaryType].get(extrema.high.areaCode) ?? null,
        value: extrema.high.value,
        goodIfUp,
        isActive: true,
        computedAt,
        sourceDate,
        runId,
      };
      records.push(highRecord);

      if (!extrema.low || extrema.low.areaCode === extrema.high.areaCode) continue;
      const lowRecord: ComputedPoiRecord = {
        poiKey: makePoiKey(stat.id, scopeKey, boundaryType, "low"),
        statId: stat.id,
        statCategory: stat.category,
        statName,
        boundaryType,
        scopeKey,
        scopeLabel: scopeDef.label,
        extremaKind: "low",
        areaCode: extrema.low.areaCode,
        areaName: areas.areaNameByBoundary[boundaryType].get(extrema.low.areaCode) ?? null,
        value: extrema.low.value,
        goodIfUp,
        isActive: true,
        computedAt,
        sourceDate,
        runId,
      };
      records.push(lowRecord);
    }
  }

  return { records, rowsConsidered };
};

const fetchExistingPoiRows = async (
  db: InstantAdminLike,
  statId: string,
): Promise<Array<{ id: string; poiKey: string; isActive: boolean | null }>> => {
  const resp = await db.query({
    pointsOfInterest: {
      $: {
        where: { statId },
        fields: ["id", "poiKey", "isActive"],
        limit: MAX_QUERY_LIMIT,
      },
    },
  });
  const rows = unwrapRows<any>(resp, "pointsOfInterest");
  const out: Array<{ id: string; poiKey: string; isActive: boolean | null }> = [];
  for (const row of rows) {
    const id = typeof row?.id === "string" ? row.id : null;
    const poiKey = typeof row?.poiKey === "string" ? row.poiKey : null;
    if (!id || !poiKey) continue;
    out.push({
      id,
      poiKey,
      isActive: typeof row?.isActive === "boolean" ? row.isActive : null,
    });
  }
  return out;
};

const transactChunked = async (db: InstantAdminLike, ops: unknown[]): Promise<void> => {
  if (ops.length === 0) return;
  for (const opsChunk of chunk(ops, TX_CHUNK_SIZE)) {
    await db.transact(opsChunk);
  }
};

export const runPointsOfInterestRecompute = async (
  db: InstantAdminLike,
  options: PoiRecomputeOptions,
): Promise<PoiRecomputeResult> => {
  const action: PoiRecomputeAction = options.action ?? "recompute";
  const statId = options.statId;
  const computedAt = Date.now();
  const runId = options.runId ?? createRunId();

  const stat = await fetchStat(db, statId);
  if (!stat) {
    throw new Error(`Stat not found: ${statId}`);
  }

  const shouldDeactivateOnly =
    action === "deactivate" ||
    getStatEffectiveVisibility(stat) !== "public" ||
    (!options.force && stat.pointsOfInterestEnabled !== true);

  let records: ComputedPoiRecord[] = [];
  let rowsConsidered = 0;

  if (!shouldDeactivateOnly) {
    const areaRows = await fetchAreas(db);
    const areaIndex = buildAreaIndex(areaRows);
    const memberships = buildScopeMembership(areaIndex);
    const summaryZip = await fetchSummaryContexts(db, statId, "ZIP");
    const summaryCounty = await fetchSummaryContexts(db, statId, "COUNTY");
    const requiredZipContexts = new Map<string, SummaryContext>();
    const requiredCountyContexts = new Map<string, SummaryContext>();

    // Build a union of summary contexts used by any scope so we can fetch
    // statData in two batched queries (ZIP + COUNTY) instead of N per scope.
    for (const scopeKey of Object.keys(SCOPE_DEFINITIONS) as PoiScopeKey[]) {
      const membership = memberships[scopeKey];
      const aliasSet = buildParentAreaAliasSet(membership);
      for (const ctx of summaryZip) {
        if (!aliasSet.has(ctx.normalizedParentArea)) continue;
        requiredZipContexts.set(contextKey("ZIP", ctx.parentArea, ctx.date), ctx);
      }
      for (const ctx of summaryCounty) {
        if (!aliasSet.has(ctx.normalizedParentArea)) continue;
        requiredCountyContexts.set(contextKey("COUNTY", ctx.parentArea, ctx.date), ctx);
      }
    }

    const statDataZip = await fetchStatDataRowsForContexts(
      db,
      statId,
      "ZIP",
      Array.from(requiredZipContexts.values()),
    );
    const statDataCounty = await fetchStatDataRowsForContexts(
      db,
      statId,
      "COUNTY",
      Array.from(requiredCountyContexts.values()),
    );

    const computed = buildComputedRecords(
      stat,
      memberships,
      { ZIP: summaryZip, COUNTY: summaryCounty },
      { ZIP: statDataZip, COUNTY: statDataCounty },
      areaIndex,
      computedAt,
      runId,
    );
    records = computed.records;
    rowsConsidered = computed.rowsConsidered;
  }

  const existingRows = await fetchExistingPoiRows(db, statId);
  const nextActiveKeys = new Set(records.map((record) => record.poiKey));
  const deactivateOps: unknown[] = [];

  for (const row of existingRows) {
    const shouldRemainActive = nextActiveKeys.has(row.poiKey);
    if (shouldRemainActive) continue;
    if (row.isActive === false) continue;
    deactivateOps.push(
      tx.pointsOfInterest[row.id].update({
        isActive: false,
        computedAt,
        runId,
      }),
    );
  }

  const upsertOps = records.map((record) =>
    tx.pointsOfInterest[lookup("poiKey", record.poiKey)].update({
      statId: record.statId,
      statCategory: record.statCategory,
      statName: record.statName,
      boundaryType: record.boundaryType,
      scopeKey: record.scopeKey,
      scopeLabel: record.scopeLabel,
      extremaKind: record.extremaKind,
      areaCode: record.areaCode,
      areaName: record.areaName,
      value: record.value,
      goodIfUp: record.goodIfUp,
      isActive: record.isActive,
      computedAt: record.computedAt,
      sourceDate: record.sourceDate,
      runId: record.runId,
    }),
  );

  await transactChunked(db, upsertOps);
  await transactChunked(db, deactivateOps);

  return {
    ok: true,
    action,
    statId,
    runId,
    computedAt,
    rowsUpserted: upsertOps.length,
    rowsDeactivated: deactivateOps.length,
    rowsConsidered,
    skipped: shouldDeactivateOnly && action === "recompute",
    reason:
      shouldDeactivateOnly && action === "recompute"
        ? "stat_not_enabled_or_not_public"
        : undefined,
  };
};
