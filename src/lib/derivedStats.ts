export type RootStatDataRow = {
  parentArea: string | null;
  boundaryType: string | null;
  date: string | null;
  data: Record<string, number>;
};

export type DerivedFormulaKind =
  | "percent"
  | "sum"
  | "difference"
  | "rate_per_1000"
  | "ratio"
  | "index"
  | "change_over_time";

export type DerivedStatPayloadLike = {
  formula?: DerivedFormulaKind | string | null;
  numeratorId?: string | null;
  denominatorId?: string | null;
  statId?: string | null;
  startYear?: string | null;
  endYear?: string | null;
  sumOperandIds?: Array<string | null | undefined> | null;
};

export const FORMULA_TO_STAT_TYPE: Record<DerivedFormulaKind, string> = {
  percent: "percent",
  sum: "number",
  difference: "number",
  rate_per_1000: "number",
  ratio: "number",
  index: "number",
  change_over_time: "percent_change",
};

export const DERIVED_FORMULAS: DerivedFormulaKind[] = [
  "percent",
  "sum",
  "difference",
  "rate_per_1000",
  "ratio",
  "index",
  "change_over_time",
];

export const coerceDerivedFormula = (value: unknown): DerivedFormulaKind => {
  return typeof value === "string" && DERIVED_FORMULAS.includes(value as DerivedFormulaKind)
    ? (value as DerivedFormulaKind)
    : "percent";
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const normalizeString = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
};

const toFiniteNumber = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.trim());
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

export const normalizeDataMap = (value: unknown): Record<string, number> => {
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

export const computeSummaryFromData = (data: Record<string, number>) => {
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

export const buildStatDataSummaryKey = (
  statId: string,
  name: string,
  parentArea: string | null | undefined,
  boundaryType: string | null | undefined,
) => `${statId}::${name}::${parentArea ?? ""}::${boundaryType ?? ""}`;

export const buildRootStatDataRowKey = (row: RootStatDataRow) =>
  `${row.parentArea ?? ""}::${row.boundaryType ?? ""}::${row.date ?? ""}`;

export const computeDerivedValues = (
  aData: Record<string, number>,
  bData: Record<string, number>,
  formula: DerivedFormulaKind,
): Record<string, number> => {
  const out: Record<string, number> = {};
  const isFiniteNum = (value: unknown): value is number =>
    typeof value === "number" && Number.isFinite(value);
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

export const parseRootStatDataRows = (rows: unknown[]): RootStatDataRow[] => {
  const out: RootStatDataRow[] = [];
  for (const row of rows) {
    if (!isRecord(row)) continue;
    const rawDate = row.date;
    const date =
      typeof rawDate === "string" && rawDate.trim()
        ? rawDate.trim()
        : typeof rawDate === "number" && Number.isFinite(rawDate)
          ? String(rawDate)
          : null;
    out.push({
      parentArea: normalizeString(row.parentArea),
      boundaryType: normalizeString(row.boundaryType),
      date,
      data: normalizeDataMap(row.data),
    });
  }
  return out;
};

export const buildRowsByStatId = (rows: unknown[]): Map<string, Map<string, RootStatDataRow>> => {
  const rowsByStat = new Map<string, Map<string, RootStatDataRow>>();
  for (const raw of rows) {
    if (!isRecord(raw)) continue;
    const statId = normalizeString(raw.statId);
    if (!statId) continue;
    const row = parseRootStatDataRows([raw])[0];
    if (!row) continue;
    const rowsForStat = rowsByStat.get(statId) ?? new Map<string, RootStatDataRow>();
    rowsForStat.set(buildRootStatDataRowKey(row), row);
    rowsByStat.set(statId, rowsForStat);
  }
  return rowsByStat;
};

export const getDerivedSourceStatIds = (
  formula: DerivedFormulaKind,
  payload: DerivedStatPayloadLike,
): string[] => {
  const ids = new Set<string>();
  const add = (value: unknown) => {
    const normalized = normalizeString(value);
    if (normalized) ids.add(normalized);
  };
  if (formula === "change_over_time") {
    add(payload.numeratorId);
    add(payload.statId);
    return Array.from(ids);
  }
  if (formula === "sum") {
    for (const id of payload.sumOperandIds ?? []) add(id);
    return Array.from(ids);
  }
  add(payload.numeratorId);
  add(payload.denominatorId);
  return Array.from(ids);
};

const setEquals = (a?: Set<string>, b?: Set<string>): boolean => {
  if (!a && !b) return true;
  if (!a || !b) return false;
  if (a.size !== b.size) return false;
  for (const value of a) if (!b.has(value)) return false;
  return true;
};

const describeSet = (values?: Set<string>): string => Array.from(values ?? []).sort().join(", ") || "none";

export const createDerivedStatRows = (
  formula: DerivedFormulaKind,
  payload: DerivedStatPayloadLike,
  rowsByStat: Map<string, Map<string, RootStatDataRow>>,
): RootStatDataRow[] => {
  if (formula === "change_over_time") {
    const statId = normalizeString(payload.numeratorId) ?? normalizeString(payload.statId);
    const startYear = normalizeString(payload.startYear);
    const endYear = normalizeString(payload.endYear);
    if (!statId || !startYear || !endYear) {
      throw new Error("Missing stat or year range for change over time calculation.");
    }
    const statRows = rowsByStat.get(statId);
    if (!statRows?.size) throw new Error("No data found for the selected stat.");

    const byContext = new Map<
      string,
      { parentArea: string | null; boundaryType: string | null; rowsByDate: Map<string, Record<string, number>> }
    >();
    for (const row of statRows.values()) {
      if (!row.date) continue;
      const key = `${row.parentArea ?? ""}|${row.boundaryType ?? ""}`;
      const context =
        byContext.get(key) ?? {
          parentArea: row.parentArea,
          boundaryType: row.boundaryType,
          rowsByDate: new Map<string, Record<string, number>>(),
        };
      context.rowsByDate.set(row.date, row.data);
      byContext.set(key, context);
    }

    const derivedRows: RootStatDataRow[] = [];
    for (const context of byContext.values()) {
      const startData = context.rowsByDate.get(startYear);
      const endData = context.rowsByDate.get(endYear);
      if (!startData || !endData) continue;
      const data: Record<string, number> = {};
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
          data[areaKey] = (endValue - startValue) / Math.abs(startValue);
        }
      }
      if (Object.keys(data).length === 0) continue;
      derivedRows.push({
        parentArea: context.parentArea,
        boundaryType: context.boundaryType,
        date: `${startYear}-${endYear}`,
        data,
      });
    }

    if (derivedRows.length === 0) {
      throw new Error(`No overlapping areas with data for both ${startYear} and ${endYear}.`);
    }
    return derivedRows;
  }

  if (formula === "sum") {
    const operandIds = Array.from(
      new Set((payload.sumOperandIds ?? []).map((idValue) => normalizeString(idValue)).filter(Boolean)),
    ) as string[];
    if (operandIds.length < 2) throw new Error("Select at least two stats to sum.");

    const allRowKeys = new Set<string>();
    for (const statId of operandIds) {
      const rowMap = rowsByStat.get(statId);
      if (!rowMap) continue;
      for (const key of rowMap.keys()) allRowKeys.add(key);
    }
    if (allRowKeys.size === 0) throw new Error("No data found for the selected stats.");

    const derivedRows: RootStatDataRow[] = [];
    let nonEmptyCount = 0;
    for (const rowKey of allRowKeys) {
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

      const data: Record<string, number> = {};
      for (const areaKey of areaKeys) {
        let sum = 0;
        let hasAnyValue = false;
        for (const statId of operandIds) {
          const value = rowsByStat.get(statId)?.get(rowKey)?.data[areaKey];
          if (typeof value === "number" && Number.isFinite(value)) {
            sum += value;
            hasAnyValue = true;
          }
        }
        if (hasAnyValue) data[areaKey] = sum;
      }
      if (Object.keys(data).length > 0) nonEmptyCount += 1;
      derivedRows.push({
        parentArea: template.parentArea,
        boundaryType: template.boundaryType,
        date: template.date,
        data,
      });
    }

    if (nonEmptyCount === 0) throw new Error("Selected stats have no overlapping area data to compute a sum.");
    return derivedRows;
  }

  const numeratorId = normalizeString(payload.numeratorId);
  const denominatorId = normalizeString(payload.denominatorId);
  if (!numeratorId || !denominatorId) throw new Error("Unable to locate selected stats.");

  const numeratorRows = rowsByStat.get(numeratorId);
  const denominatorRows = rowsByStat.get(denominatorId);
  if (!numeratorRows?.size || !denominatorRows?.size) {
    throw new Error("Missing data for one of the selected stats.");
  }

  const yearsByStat = new Map<string, Set<string>>();
  const boundaryTypesByStat = new Map<string, Set<string>>();
  for (const [statId, rowMap] of rowsByStat.entries()) {
    const years = new Set<string>();
    const boundaryTypes = new Set<string>();
    for (const row of rowMap.values()) {
      if (row.date) years.add(row.date);
      if (row.boundaryType) boundaryTypes.add(row.boundaryType);
    }
    yearsByStat.set(statId, years);
    boundaryTypesByStat.set(statId, boundaryTypes);
  }

  const numYears = yearsByStat.get(numeratorId);
  const denYears = yearsByStat.get(denominatorId);
  const numBounds = boundaryTypesByStat.get(numeratorId);
  const denBounds = boundaryTypesByStat.get(denominatorId);
  if (!setEquals(numYears, denYears) || !setEquals(numBounds, denBounds)) {
    const parts: string[] = [];
    if (!setEquals(numYears, denYears)) {
      parts.push(`years (numerator: ${describeSet(numYears)}, denominator: ${describeSet(denYears)})`);
    }
    if (!setEquals(numBounds, denBounds)) {
      parts.push(`boundary types (numerator: ${describeSet(numBounds)}, denominator: ${describeSet(denBounds)})`);
    }
    throw new Error(`These stats can't be combined: they have different ${parts.join(" and ")}.`);
  }

  const derivedRows: RootStatDataRow[] = [];
  let nonEmptyCount = 0;
  for (const [rowKey, denominatorRow] of denominatorRows.entries()) {
    const numeratorRow = numeratorRows.get(rowKey);
    const data = computeDerivedValues(numeratorRow?.data ?? {}, denominatorRow.data, formula);
    if (Object.keys(data).length > 0) nonEmptyCount += 1;
    derivedRows.push({
      parentArea: denominatorRow.parentArea,
      boundaryType: denominatorRow.boundaryType,
      date: denominatorRow.date,
      data,
    });
  }

  if (nonEmptyCount === 0) {
    throw new Error("Selected stats have no overlapping area data to compute a derived value.");
  }
  return derivedRows;
};
