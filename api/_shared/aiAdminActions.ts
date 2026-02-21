import { id as createId, lookup, tx } from "@instantdb/admin";

import type {
  AiAdminAction,
  AiAdminAllowedActionType,
  AiAdminRunCaps,
} from "./aiAdminPlan.ts";
import {
  applyStatDataPayloads,
  buildDataMaps,
  buildStatDataPayloads,
  CENSUS_TABLE_DOC_URL,
  createInstantClient,
  deriveStatName,
  fetchCountyData,
  fetchGroupMetadata,
  fetchZipData,
  hydrateCountyZipBucketsFromAreas,
  inferStatType,
  resolveVariables,
} from "./census.js";

type InstantAdminLike = {
  query: (query: unknown) => Promise<unknown>;
  transact: (ops: unknown | unknown[]) => Promise<unknown>;
};

type AiAdminActionConflict = {
  actionId: string;
  actionType: AiAdminAllowedActionType;
  reason:
    | "existing_stat_neid"
    | "existing_stat_name"
    | "plan_duplicate_import_variable"
    | "plan_duplicate_derived_name";
  statId?: string;
  statName?: string;
  neId?: string;
  detail: string;
};

type ExecuteActionContext = {
  runId: string;
  caps: AiAdminRunCaps;
  callerEmail: string | null;
};

type RootStatDataRow = {
  parentArea: string | null;
  boundaryType: string | null;
  date: string | null;
  data: Record<string, number>;
};

type DerivedFormulaKind =
  | "percent"
  | "sum"
  | "difference"
  | "rate_per_1000"
  | "ratio"
  | "index"
  | "change_over_time";

const DEFAULT_CATEGORY = "demographics";
const DEFAULT_SOURCE = "Census Derived";
const DEFAULT_IMPORT_DATASET = "acs/acs5";
const DEFAULT_IMPORT_YEAR = 2023;
const DEFAULT_IMPORT_YEARS = 1;
const MAX_IMPORT_YEARS = 5;
const MAX_WRITE_TX_BATCH = 10;
const UNDEFINED_STAT_ATTRIBUTE = "__undefined__";

const FORMULA_TO_STAT_TYPE: Record<DerivedFormulaKind, string> = {
  percent: "percent",
  sum: "number",
  difference: "number",
  rate_per_1000: "number",
  ratio: "number",
  index: "number",
  change_over_time: "percent_change",
};

const ALLOWED_CATEGORIES = new Set<string>([
  "food",
  "demographics",
  "health",
  "education",
  "economy",
  "housing",
  "justice",
]);

const ALLOWED_VISIBILITIES = new Set<string>(["public", "private", "inactive"]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const normalizeString = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const parseBoolean = (value: unknown, fallback: boolean): boolean => {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const lowered = value.trim().toLowerCase();
    if (lowered === "1" || lowered === "true" || lowered === "yes") return true;
    if (lowered === "0" || lowered === "false" || lowered === "no") return false;
  }
  return fallback;
};

const parseNumber = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.trim());
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
};

const parseIntInRange = (value: unknown, fallback: number, min: number, max: number): number => {
  const parsed = parseNumber(value);
  if (parsed == null) return fallback;
  const intVal = Math.trunc(parsed);
  if (intVal < min) return min;
  if (intVal > max) return max;
  return intVal;
};

const coerceCategory = (value: unknown): string => {
  const normalized = normalizeString(value) ?? DEFAULT_CATEGORY;
  return ALLOWED_CATEGORIES.has(normalized) ? normalized : DEFAULT_CATEGORY;
};

const coerceVisibility = (value: unknown, fallback: string): string => {
  const normalized = normalizeString(value);
  if (!normalized) return fallback;
  return ALLOWED_VISIBILITIES.has(normalized) ? normalized : fallback;
};

const toFiniteNumber = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.trim());
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const normalizeDataMap = (value: unknown): Record<string, number> => {
  const out: Record<string, number> = {};
  if (!value) return out;
  if (value instanceof Map) {
    value.forEach((entryValue, key) => {
      const parsed = toFiniteNumber(entryValue);
      if (parsed != null) out[String(key)] = parsed;
    });
    return out;
  }
  if (isRecord(value)) {
    for (const [key, raw] of Object.entries(value)) {
      const parsed = toFiniteNumber(raw);
      if (parsed != null) out[key] = parsed;
    }
  }
  return out;
};

const computeSummaryFromData = (data: Record<string, number>) => {
  let count = 0;
  let sum = 0;
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const value of Object.values(data ?? {})) {
    if (typeof value !== "number" || !Number.isFinite(value)) continue;
    count += 1;
    sum += value;
    if (value < min) min = value;
    if (value > max) max = value;
  }
  if (count === 0) return { count: 0, sum: 0, avg: 0, min: 0, max: 0 };
  return { count, sum, avg: sum / count, min, max };
};

const buildStatDataSummaryKey = (
  statId: string,
  name: string,
  parentArea: string | null | undefined,
  boundaryType: string | null | undefined,
) => `${statId}::${name}::${parentArea ?? ""}::${boundaryType ?? ""}`;

const buildRowKey = (row: RootStatDataRow) =>
  `${row.parentArea ?? ""}::${row.boundaryType ?? ""}::${row.date ?? ""}`;

const unwrapRows = <T>(result: unknown, key: string): T[] => {
  if (!result || typeof result !== "object") return [];
  const obj = result as Record<string, unknown>;
  if (Array.isArray(obj[key])) return obj[key] as T[];
  const data = obj.data;
  if (data && typeof data === "object" && Array.isArray((data as Record<string, unknown>)[key])) {
    return (data as Record<string, unknown>)[key] as T[];
  }
  return [];
};

const coerceFormula = (value: unknown): DerivedFormulaKind => {
  const normalized = normalizeString(value) as DerivedFormulaKind | null;
  if (
    normalized === "percent" ||
    normalized === "sum" ||
    normalized === "difference" ||
    normalized === "rate_per_1000" ||
    normalized === "ratio" ||
    normalized === "index" ||
    normalized === "change_over_time"
  ) {
    return normalized;
  }
  return "percent";
};

const computeDerivedValues = (
  aData: Record<string, number>,
  bData: Record<string, number>,
  formula: DerivedFormulaKind,
): Record<string, number> => {
  const out: Record<string, number> = {};
  const isFiniteNum = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
  const keys =
    formula === "sum" || formula === "difference"
      ? new Set([...Object.keys(aData), ...Object.keys(bData)])
      : Object.keys(aData);

  for (const area of keys) {
    const aVal = aData[area];
    const bVal = bData[area];
    switch (formula) {
      case "percent":
      case "ratio":
        if (isFiniteNum(aVal) && isFiniteNum(bVal) && bVal !== 0) out[area] = aVal / bVal;
        break;
      case "sum":
        if (isFiniteNum(aVal) && isFiniteNum(bVal)) out[area] = aVal + bVal;
        else if (isFiniteNum(aVal)) out[area] = aVal;
        else if (isFiniteNum(bVal)) out[area] = bVal;
        break;
      case "difference":
        if (isFiniteNum(aVal) && isFiniteNum(bVal)) out[area] = aVal - bVal;
        break;
      case "rate_per_1000":
        if (isFiniteNum(aVal) && isFiniteNum(bVal) && bVal !== 0) out[area] = (aVal / bVal) * 1000;
        break;
      case "index":
        if (isFiniteNum(aVal) && isFiniteNum(bVal) && bVal !== 0) out[area] = (aVal / bVal) * 100;
        break;
      case "change_over_time":
        break;
    }
  }

  return out;
};

const buildYearRange = (start: number, count: number): number[] => {
  const out: number[] = [];
  for (let i = 0; i < count; i += 1) out.push(start - i);
  return out;
};

const parseImportPayload = (payload: Record<string, unknown>) => {
  const dataset = normalizeString(payload.dataset) ?? DEFAULT_IMPORT_DATASET;
  const group = normalizeString(payload.group);
  const variable = normalizeString(payload.variable);
  if (!group) throw new Error("import_census_stat requires payload.group.");
  if (!variable) throw new Error("import_census_stat requires payload.variable.");
  return {
    dataset,
    group,
    variable,
    year: parseIntInRange(payload.year, DEFAULT_IMPORT_YEAR, 2005, 2100),
    years: parseIntInRange(payload.years, DEFAULT_IMPORT_YEARS, 1, MAX_IMPORT_YEARS),
    includeMoe: parseBoolean(payload.includeMoe, false),
    category: coerceCategory(payload.category),
    visibility: coerceVisibility(payload.visibility, "private"),
    createdBy: normalizeString(payload.createdBy),
  };
};

const parseRootStatDataRows = (rows: unknown[]): RootStatDataRow[] => {
  const out: RootStatDataRow[] = [];
  for (const row of rows) {
    if (!isRecord(row)) continue;
    const parentArea = normalizeString(row.parentArea);
    const boundaryType = normalizeString(row.boundaryType);
    const rawDate = row.date;
    const date =
      typeof rawDate === "string" && rawDate.trim()
        ? rawDate.trim()
        : typeof rawDate === "number" && Number.isFinite(rawDate)
        ? String(rawDate)
        : null;
    out.push({
      parentArea,
      boundaryType,
      date,
      data: normalizeDataMap(row.data),
    });
  }
  return out;
};

const fetchRootRowsByStatIds = async (
  db: InstantAdminLike,
  statIds: string[],
): Promise<Array<{ statId: string; row: RootStatDataRow }>> => {
  if (statIds.length === 0) return [];
  const resp = await db.query({
    statData: {
      $: {
        where: {
          name: "root",
          statId: { $in: statIds },
        },
        fields: ["statId", "parentArea", "boundaryType", "date", "data"],
      },
    },
  });
  const rows = unwrapRows<Record<string, unknown>>(resp, "statData");
  const out: Array<{ statId: string; row: RootStatDataRow }> = [];
  for (const raw of rows) {
    const statId = normalizeString(raw.statId);
    if (!statId) continue;
    const normalized = parseRootStatDataRows([raw])[0];
    if (!normalized) continue;
    out.push({ statId, row: normalized });
  }
  return out;
};

const createDerivedStatRows = (
  formula: DerivedFormulaKind,
  payload: Record<string, unknown>,
  rowsByStat: Map<string, Map<string, RootStatDataRow>>,
): RootStatDataRow[] => {
  if (formula === "change_over_time") {
    const statId = normalizeString(payload.numeratorId) ?? normalizeString(payload.statId);
    const startYear = normalizeString(payload.startYear);
    const endYear = normalizeString(payload.endYear);
    if (!statId || !startYear || !endYear) {
      throw new Error("change_over_time requires numeratorId (or statId), startYear, and endYear.");
    }
    const statRows = rowsByStat.get(statId);
    if (!statRows || statRows.size === 0) {
      throw new Error("No source rows found for change_over_time.");
    }

    const byContext = new Map<
      string,
      { parentArea: string | null; boundaryType: string | null; rowsByDate: Map<string, Record<string, number>> }
    >();
    for (const row of statRows.values()) {
      if (!row.date) continue;
      const key = `${row.parentArea ?? ""}|${row.boundaryType ?? ""}`;
      if (!byContext.has(key)) {
        byContext.set(key, {
          parentArea: row.parentArea,
          boundaryType: row.boundaryType,
          rowsByDate: new Map(),
        });
      }
      byContext.get(key)?.rowsByDate.set(row.date, row.data);
    }

    const derivedRows: RootStatDataRow[] = [];
    for (const context of byContext.values()) {
      const startData = context.rowsByDate.get(startYear);
      const endData = context.rowsByDate.get(endYear);
      if (!startData || !endData) continue;
      const out: Record<string, number> = {};
      for (const areaKey of Object.keys(endData)) {
        const startValue = startData[areaKey];
        const endValue = endData[areaKey];
        if (
          typeof startValue === "number" &&
          Number.isFinite(startValue) &&
          startValue !== 0 &&
          typeof endValue === "number" &&
          Number.isFinite(endValue)
        ) {
          out[areaKey] = (endValue - startValue) / Math.abs(startValue);
        }
      }
      if (Object.keys(out).length === 0) continue;
      derivedRows.push({
        parentArea: context.parentArea,
        boundaryType: context.boundaryType,
        date: `${startYear}-${endYear}`,
        data: out,
      });
    }
    if (derivedRows.length === 0) {
      throw new Error("No overlapping rows found for change_over_time.");
    }
    return derivedRows;
  }

  if (formula === "sum") {
    const operandIds = Array.isArray(payload.sumOperandIds)
      ? payload.sumOperandIds.map((entry) => normalizeString(entry)).filter((entry): entry is string => Boolean(entry))
      : [];
    if (operandIds.length < 2) throw new Error("sum requires at least two stat ids in sumOperandIds.");

    const allKeys = new Set<string>();
    for (const statId of operandIds) {
      const rowMap = rowsByStat.get(statId);
      if (!rowMap) continue;
      for (const key of rowMap.keys()) allKeys.add(key);
    }
    if (allKeys.size === 0) throw new Error("No source rows found for sum operands.");

    const derivedRows: RootStatDataRow[] = [];
    for (const rowKey of allKeys) {
      let template: RootStatDataRow | null = null;
      for (const statId of operandIds) {
        const row = rowsByStat.get(statId)?.get(rowKey);
        if (row) {
          template = row;
          break;
        }
      }
      if (!template) continue;

      const areaKeys = new Set<string>();
      for (const statId of operandIds) {
        const row = rowsByStat.get(statId)?.get(rowKey);
        if (!row) continue;
        for (const areaKey of Object.keys(row.data)) areaKeys.add(areaKey);
      }

      const out: Record<string, number> = {};
      for (const areaKey of areaKeys) {
        let sum = 0;
        let hasAny = false;
        for (const statId of operandIds) {
          const row = rowsByStat.get(statId)?.get(rowKey);
          if (!row) continue;
          const value = row.data[areaKey];
          if (typeof value === "number" && Number.isFinite(value)) {
            sum += value;
            hasAny = true;
          }
        }
        if (hasAny) out[areaKey] = sum;
      }
      if (Object.keys(out).length === 0) continue;
      derivedRows.push({
        parentArea: template.parentArea,
        boundaryType: template.boundaryType,
        date: template.date,
        data: out,
      });
    }

    if (derivedRows.length === 0) throw new Error("No overlapping rows found for sum operands.");
    return derivedRows;
  }

  const numeratorId = normalizeString(payload.numeratorId);
  const denominatorId = normalizeString(payload.denominatorId);
  if (!numeratorId || !denominatorId) {
    throw new Error(`${formula} requires numeratorId and denominatorId.`);
  }

  const numeratorRows = rowsByStat.get(numeratorId);
  const denominatorRows = rowsByStat.get(denominatorId);
  if (!numeratorRows || numeratorRows.size === 0 || !denominatorRows || denominatorRows.size === 0) {
    throw new Error("Missing source rows for numerator or denominator.");
  }

  const yearsByStat = new Map<string, Set<string>>();
  const boundaryByStat = new Map<string, Set<string>>();
  for (const [statId, rowMap] of rowsByStat.entries()) {
    const years = new Set<string>();
    const boundaries = new Set<string>();
    for (const row of rowMap.values()) {
      if (row.date) years.add(row.date);
      if (row.boundaryType) boundaries.add(row.boundaryType);
    }
    yearsByStat.set(statId, years);
    boundaryByStat.set(statId, boundaries);
  }

  const setsEqual = (a?: Set<string>, b?: Set<string>): boolean => {
    if (!a && !b) return true;
    if (!a || !b) return false;
    if (a.size !== b.size) return false;
    for (const value of a) if (!b.has(value)) return false;
    return true;
  };
  if (!setsEqual(yearsByStat.get(numeratorId), yearsByStat.get(denominatorId))) {
    throw new Error("Numerator and denominator have incompatible year sets.");
  }
  if (!setsEqual(boundaryByStat.get(numeratorId), boundaryByStat.get(denominatorId))) {
    throw new Error("Numerator and denominator have incompatible boundary sets.");
  }

  const derivedRows: RootStatDataRow[] = [];
  for (const [rowKey, denominatorRow] of denominatorRows.entries()) {
    const numeratorRow = numeratorRows.get(rowKey);
    const out = computeDerivedValues(numeratorRow?.data ?? {}, denominatorRow.data, formula);
    if (Object.keys(out).length === 0) continue;
    derivedRows.push({
      parentArea: denominatorRow.parentArea,
      boundaryType: denominatorRow.boundaryType,
      date: denominatorRow.date,
      data: out,
    });
  }
  if (derivedRows.length === 0) throw new Error("No overlapping rows found for derived formula.");
  return derivedRows;
};

const chunkAndTransact = async (db: InstantAdminLike, operations: unknown[], maxBatch = MAX_WRITE_TX_BATCH) => {
  for (let i = 0; i < operations.length; i += maxBatch) {
    const chunk = operations.slice(i, i + maxBatch);
    if (chunk.length > 0) await db.transact(chunk);
  }
};

const executeImportCensusStat = async (
  db: InstantAdminLike,
  action: AiAdminAction,
  context: ExecuteActionContext,
) => {
  const payload = parseImportPayload(action.payload);
  const survey = payload.dataset.split("/").pop() || "acs5";
  const years = buildYearRange(payload.year, payload.years);

  const statId = createId();
  let statName: string | null = null;
  let statType: string | null = null;
  const allPayloads: any[] = [];

  for (const currentYear of years) {
    const options = {
      dataset: payload.dataset,
      survey,
      group: payload.group,
      variables: [payload.variable],
      year: currentYear,
      includeMoe: payload.includeMoe,
      dryRun: false,
      debug: false,
      limit: 1,
      years: 1,
    };

    const groupMeta = await fetchGroupMetadata(options);
    const { estimates, moeMap } = resolveVariables(options, groupMeta);
    if (!estimates.includes(payload.variable)) {
      throw new Error(`Variable ${payload.variable} is not available in ${payload.group} for year ${currentYear}.`);
    }
    const variableMeta = groupMeta.variables.get(payload.variable);
    if (!variableMeta) {
      throw new Error(`Missing metadata for ${payload.variable} in ${payload.group}.`);
    }

    if (!statName || !statType) {
      statName = deriveStatName(payload.variable, variableMeta, groupMeta);
      statType = inferStatType(variableMeta);
      const now = Date.now();
      const statRecord: Record<string, unknown> = {
        name: statName,
        category: payload.category,
        neId: `census:${payload.variable}`,
        source: "Census",
        goodIfUp: null,
        active: true,
        createdOn: now,
        lastUpdated: now,
        visibility: payload.visibility,
        visibilityEffective: payload.visibility,
      };
      if (payload.createdBy) statRecord.createdBy = payload.createdBy;
      await db.transact(tx.stats[statId].update(statRecord));
    }

    const moeVariables = payload.includeMoe ? Array.from(moeMap.values()) : [];
    const zipPayload = await fetchZipData(options, [payload.variable], moeVariables);
    const countyPayload = await fetchCountyData(options, [payload.variable], moeVariables);
    const maps = buildDataMaps(
      payload.variable,
      payload.includeMoe ? moeMap.get(payload.variable) ?? null : null,
      zipPayload,
      countyPayload,
    );
    await hydrateCountyZipBucketsFromAreas(db, maps);

    const payloadsForYear = buildStatDataPayloads(statId, statName, statType, maps, {
      censusVariable: payload.variable,
      censusSurvey: survey,
      censusUniverse: groupMeta.universe,
      censusTableUrl: CENSUS_TABLE_DOC_URL(currentYear, payload.dataset, payload.group),
      year: currentYear,
    });
    allPayloads.push(...payloadsForYear);
  }

  if (!statName || !statType) {
    throw new Error("Failed to build import payload.");
  }

  await applyStatDataPayloads(db, allPayloads);

  return {
    actionId: action.id,
    actionType: action.type,
    status: "completed",
    createdStatId: statId,
    createdStatName: statName,
    statType,
    yearsProcessed: years,
    runId: context.runId,
  };
};

const executeCreateDerivedStat = async (
  db: InstantAdminLike,
  action: AiAdminAction,
  context: ExecuteActionContext,
) => {
  const payload = action.payload;
  const formula = coerceFormula(payload.formula);
  const name = normalizeString(payload.name);
  if (!name) throw new Error("create_derived_stat requires payload.name.");
  const label = normalizeString(payload.label) ?? name;
  const category = coerceCategory(payload.category);
  const source = normalizeString(payload.description) ?? normalizeString(payload.source) ?? DEFAULT_SOURCE;
  const createdBy = normalizeString(payload.createdBy);
  const visibility = coerceVisibility(payload.visibility, "private");

  const statIdsForLookup = new Set<string>();
  const numeratorId = normalizeString(payload.numeratorId);
  const denominatorId = normalizeString(payload.denominatorId);
  if (numeratorId) statIdsForLookup.add(numeratorId);
  if (denominatorId) statIdsForLookup.add(denominatorId);
  if (Array.isArray(payload.sumOperandIds)) {
    for (const entry of payload.sumOperandIds) {
      const idValue = normalizeString(entry);
      if (idValue) statIdsForLookup.add(idValue);
    }
  }
  const statRows = await fetchRootRowsByStatIds(db, Array.from(statIdsForLookup));
  const rowsByStat = new Map<string, Map<string, RootStatDataRow>>();
  for (const { statId, row } of statRows) {
    if (!rowsByStat.has(statId)) rowsByStat.set(statId, new Map());
    rowsByStat.get(statId)?.set(buildRowKey(row), row);
  }

  const derivedRows = createDerivedStatRows(formula, payload, rowsByStat);
  const now = Date.now();
  const newStatId = createId();

  const statRecord: Record<string, unknown> = {
    name,
    label,
    category,
    source,
    goodIfUp: null,
    featured: false,
    homeFeatured: false,
    visibility,
    visibilityEffective: visibility,
    createdOn: now,
    lastUpdated: now,
  };
  if (createdBy) statRecord.createdBy = createdBy;

  await db.transact(tx.stats[newStatId].update(statRecord));

  const dataType = FORMULA_TO_STAT_TYPE[formula];
  const operations: unknown[] = [];
  const sortedRows = [...derivedRows].sort((a, b) => String(a.date ?? "").localeCompare(String(b.date ?? "")));

  for (const row of sortedRows) {
    const parentArea = row.parentArea ?? undefined;
    const boundaryType = row.boundaryType ?? undefined;
    const date = row.date ?? undefined;
    if (!parentArea || !boundaryType || !date) continue;
    const summaryKey = buildStatDataSummaryKey(newStatId, "root", parentArea, boundaryType);
    const summary = computeSummaryFromData(row.data);

    operations.push(
      tx.statData[createId()].update({
        statId: newStatId,
        name: "root",
        parentArea,
        boundaryType,
        date,
        type: dataType,
        data: row.data,
        source,
        statTitle: label,
        createdOn: now,
        lastUpdated: now,
      }),
    );

    operations.push(
      tx.statDataSummaries[lookup("summaryKey", summaryKey)].update({
        summaryKey,
        statId: newStatId,
        name: "root",
        parentArea,
        boundaryType,
        date,
        minDate: date,
        maxDate: date,
        type: dataType,
        count: summary.count,
        sum: summary.sum,
        avg: summary.avg,
        min: summary.min,
        max: summary.max,
        updatedAt: now,
      }),
    );
  }

  await chunkAndTransact(db, operations);

  return {
    actionId: action.id,
    actionType: action.type,
    status: "completed",
    createdStatId: newStatId,
    createdStatName: name,
    createdRows: operations.length / 2,
    formula,
    runId: context.runId,
  };
};

const executeCreateStatFamilyLinks = async (
  db: InstantAdminLike,
  action: AiAdminAction,
  context: ExecuteActionContext,
) => {
  const payload = action.payload;
  const parentStatId = normalizeString(payload.parentStatId);
  if (!parentStatId) throw new Error("create_stat_family_links requires payload.parentStatId.");
  const childIds = Array.isArray(payload.childStatIds)
    ? payload.childStatIds.map((entry) => normalizeString(entry)).filter((entry): entry is string => Boolean(entry))
    : [];
  const uniqueChildIds = Array.from(new Set(childIds)).filter((id) => id !== parentStatId);
  if (uniqueChildIds.length === 0) {
    throw new Error("create_stat_family_links requires at least one childStatId different from parentStatId.");
  }

  const statAttribute = normalizeString(payload.statAttribute) ?? UNDEFINED_STAT_ATTRIBUTE;
  const sortOrderRaw = parseNumber(payload.sortOrder);
  const sortOrder = sortOrderRaw == null ? null : Math.trunc(sortOrderRaw);
  const now = Date.now();

  const relationKeys = uniqueChildIds.map((childStatId) => `${parentStatId}::${childStatId}::${statAttribute}`);
  const existingResp = await db.query({
    statRelations: {
      $: {
        where: { relationKey: { $in: relationKeys } },
        fields: ["relationKey"],
      },
    },
  });
  const existingRows = unwrapRows<Record<string, unknown>>(existingResp, "statRelations");
  const existingKeySet = new Set(
    existingRows
      .map((row) => normalizeString(row.relationKey))
      .filter((entry): entry is string => Boolean(entry)),
  );

  const ops: unknown[] = [];
  for (const childStatId of uniqueChildIds) {
    const relationKey = `${parentStatId}::${childStatId}::${statAttribute}`;
    if (existingKeySet.has(relationKey)) continue;
    const record: Record<string, unknown> = {
      relationKey,
      parentStatId,
      childStatId,
      statAttribute,
      createdAt: now,
      updatedAt: now,
    };
    if (sortOrder != null) record.sortOrder = sortOrder;
    ops.push(tx.statRelations[createId()].update(record));
  }

  await chunkAndTransact(db, ops);

  return {
    actionId: action.id,
    actionType: action.type,
    status: "completed",
    createdRelations: ops.length,
    skippedExistingRelations: relationKeys.length - ops.length,
    runId: context.runId,
  };
};

const collectValuesByAction = (
  actions: AiAdminAction[],
): {
  importNeIdByActionId: Map<string, string>;
  derivedNameByActionId: Map<string, string>;
  duplicateConflicts: AiAdminActionConflict[];
} => {
  const importNeIdByActionId = new Map<string, string>();
  const derivedNameByActionId = new Map<string, string>();
  const duplicateConflicts: AiAdminActionConflict[] = [];

  const importActionsByNeId = new Map<string, string[]>();
  const derivedActionsByName = new Map<string, string[]>();

  for (const action of actions) {
    if (action.type === "import_census_stat") {
      const variable = normalizeString(action.payload.variable);
      if (!variable) continue;
      const neId = `census:${variable}`;
      importNeIdByActionId.set(action.id, neId);
      const list = importActionsByNeId.get(neId) ?? [];
      list.push(action.id);
      importActionsByNeId.set(neId, list);
    }
    if (action.type === "create_derived_stat") {
      const name = normalizeString(action.payload.name);
      if (!name) continue;
      derivedNameByActionId.set(action.id, name);
      const list = derivedActionsByName.get(name) ?? [];
      list.push(action.id);
      derivedActionsByName.set(name, list);
    }
  }

  for (const [neId, actionIds] of importActionsByNeId.entries()) {
    if (actionIds.length < 2) continue;
    for (const actionId of actionIds) {
      duplicateConflicts.push({
        actionId,
        actionType: "import_census_stat",
        reason: "plan_duplicate_import_variable",
        neId,
        detail: `Plan includes duplicate import variable ${neId}.`,
      });
    }
  }

  for (const [name, actionIds] of derivedActionsByName.entries()) {
    if (actionIds.length < 2) continue;
    for (const actionId of actionIds) {
      duplicateConflicts.push({
        actionId,
        actionType: "create_derived_stat",
        reason: "plan_duplicate_derived_name",
        statName: name,
        detail: `Plan includes duplicate derived stat name "${name}".`,
      });
    }
  }

  return { importNeIdByActionId, derivedNameByActionId, duplicateConflicts };
};

export const createAiAdminDb = (): InstantAdminLike => createInstantClient();

export const findExistingStatConflicts = async (
  db: InstantAdminLike,
  actions: AiAdminAction[],
): Promise<AiAdminActionConflict[]> => {
  const {
    importNeIdByActionId,
    derivedNameByActionId,
    duplicateConflicts,
  } = collectValuesByAction(actions);

  const conflicts: AiAdminActionConflict[] = [...duplicateConflicts];
  const neIds = Array.from(new Set(importNeIdByActionId.values()));
  const derivedNames = Array.from(new Set(derivedNameByActionId.values()));

  if (neIds.length > 0) {
    const resp = await db.query({
      stats: {
        $: {
          where: { neId: { $in: neIds } },
          fields: ["id", "name", "neId"],
        },
      },
    });
    const rows = unwrapRows<Record<string, unknown>>(resp, "stats");
    const existingByNeId = new Map<string, { id: string; name: string | null }>();
    for (const row of rows) {
      const neId = normalizeString(row.neId);
      const id = normalizeString(row.id);
      if (!neId || !id) continue;
      existingByNeId.set(neId, { id, name: normalizeString(row.name) });
    }

    for (const [actionId, neId] of importNeIdByActionId.entries()) {
      const existing = existingByNeId.get(neId);
      if (!existing) continue;
      conflicts.push({
        actionId,
        actionType: "import_census_stat",
        reason: "existing_stat_neid",
        statId: existing.id,
        statName: existing.name ?? undefined,
        neId,
        detail: `Existing stat found for ${neId}.`,
      });
    }
  }

  if (derivedNames.length > 0) {
    const resp = await db.query({
      stats: {
        $: {
          where: { name: { $in: derivedNames } },
          fields: ["id", "name", "neId"],
        },
      },
    });
    const rows = unwrapRows<Record<string, unknown>>(resp, "stats");
    const existingByName = new Map<string, { id: string; neId: string | null }>();
    for (const row of rows) {
      const name = normalizeString(row.name);
      const id = normalizeString(row.id);
      if (!name || !id) continue;
      existingByName.set(name, { id, neId: normalizeString(row.neId) });
    }

    for (const [actionId, statName] of derivedNameByActionId.entries()) {
      const existing = existingByName.get(statName);
      if (!existing) continue;
      conflicts.push({
        actionId,
        actionType: "create_derived_stat",
        reason: "existing_stat_name",
        statId: existing.id,
        statName,
        neId: existing.neId ?? undefined,
        detail: `Existing stat found with name "${statName}".`,
      });
    }
  }

  return conflicts;
};

export const executeAiAdminWriteAction = async (
  db: InstantAdminLike,
  action: AiAdminAction,
  context: ExecuteActionContext,
) => {
  switch (action.type) {
    case "import_census_stat":
      return executeImportCensusStat(db, action, context);
    case "create_derived_stat":
      return executeCreateDerivedStat(db, action, context);
    case "create_stat_family_links":
      return executeCreateStatFamilyLinks(db, action, context);
    default:
      return {
        actionId: action.id,
        actionType: action.type,
        status: "accepted_not_executed",
        message: "Read-only action accepted.",
        runId: context.runId,
      };
  }
};
