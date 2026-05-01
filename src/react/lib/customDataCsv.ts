export type CustomDataKind = "attendance" | "people" | "survey" | "generic";

export type ColumnRole =
  | "ignore"
  | "entityId"
  | "name"
  | "locationZip"
  | "locationAddress"
  | "locationCity"
  | "locationState"
  | "locationSiteId"
  | "date"
  | "measure"
  | "category";

export type InferredColumnType = "empty" | "number" | "date" | "boolean" | "text";

export interface ColumnProfile {
  index: number;
  name: string;
  fillRate: number;
  examples: string[];
  uniqueSampleCount: number;
  inferredType: InferredColumnType;
  suggestedRole: ColumnRole;
}

export interface CsvProfile {
  fileName: string;
  sizeBytes: number;
  sampledRows: number;
  columnCount: number;
  truncated: boolean;
  detectedKind: CustomDataKind;
  columns: ColumnProfile[];
  warnings: string[];
}

export type TransformLocationKind = "ZIP" | "SITE_ID" | "ADDRESS";
export type TransformAggregation = "average" | "sum" | "count" | "responseCount";
export type CustomStatValueType = "count" | "rate" | "percent" | "currency" | "years";

export interface CsvTransformMapping {
  datasetName: string;
  roles: Record<string, ColumnRole>;
  aggregations?: Record<string, TransformAggregation>;
  valueTypes?: Record<string, CustomStatValueType>;
  locationLookups?: {
    siteIdToZip?: Record<string, string>;
  };
}

export interface TransformMeasurePreview {
  measureName: string;
  aggregation: TransformAggregation;
  numericValues: number;
  textValues: number;
  areaCount: number;
  dateCount: number;
  sampleAreas: Array<{
    area: string;
    date: string;
    value: number;
  }>;
}

export interface StatDataPreviewRow {
  statName: string;
  name: "root";
  parentArea: string;
  boundaryType: TransformLocationKind;
  date: string;
  type: CustomStatValueType;
  data: Record<string, number>;
}

export interface CsvTransformPreview {
  sampledRows: number;
  skippedRows: number;
  bytesRead?: number;
  totalBytes?: number;
  isComplete: boolean;
  locationKind: TransformLocationKind | null;
  locationColumn: string | null;
  dateColumn: string | null;
  measureCount: number;
  measures: TransformMeasurePreview[];
  statDataRows: StatDataPreviewRow[];
  unresolvedLocationValues: string[];
  warnings: string[];
}

export interface CsvTransformProgress {
  rowsProcessed: number;
  bytesRead: number;
  totalBytes: number;
}

export interface ColumnValueSample {
  columnName: string;
  values: string[];
  truncated: boolean;
  sampledRows: number;
}

interface ParseCsvOptions {
  maxRows?: number;
  includePartialRecord?: boolean;
}

interface ParsedCsv {
  records: string[][];
  endedInsideQuote: boolean;
  warnings: string[];
}

const MAX_EXAMPLES = 4;
const MAX_UNIQUE_TRACKED = 50;
const DEFAULT_SAMPLE_ROWS = 5000;
const DEFAULT_SAMPLE_BYTES = 2_000_000;
const DEFAULT_TRANSFORM_SAMPLE_ROWS = 25000;
const DEFAULT_TRANSFORM_SAMPLE_BYTES = 6_000_000;
const DEFAULT_LOOKUP_SAMPLE_VALUES = 200;
const ZIP_PARENT_AREA = "Oklahoma";

const ROLE_PRIORITY: Record<ColumnRole, number> = {
  locationZip: 0,
  locationAddress: 1,
  locationCity: 2,
  locationState: 3,
  locationSiteId: 4,
  entityId: 5,
  name: 6,
  date: 7,
  measure: 8,
  category: 9,
  ignore: 10,
};

const normalizeHeader = (value: string) => value.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ");

const isProportionMeasureName = (measureName: string): boolean => {
  const normalized = normalizeHeader(measureName);
  return /\b(present|attendance|absence|absences|absent|rate|percent|percentage|pct|share|proportion)\b/.test(normalized);
};

const isDenominatorMeasureName = (measureName: string): boolean => {
  const normalized = normalizeHeader(measureName);
  return /\b(student\s*membership|membership|enrollment|enrolled|eligible|denominator|total\s*students|student\s*count|record\s*count|row\s*count|n)\b/.test(normalized);
};

const inferAverageStatType = (
  measureName: string,
  range: { min: number; max: number } | null,
): "rate" | "percent" => {
  const isUnitInterval =
    range !== null &&
    Number.isFinite(range.min) &&
    Number.isFinite(range.max) &&
    range.min >= 0 &&
    range.max <= 1;

  return isProportionMeasureName(measureName) && isUnitInterval ? "percent" : "rate";
};

const inferDefaultAggregation = (
  measureName: string,
  totals: Pick<MeasureTotals, "numericValues" | "textValues">,
): TransformAggregation => {
  if (totals.numericValues === 0 || totals.textValues > 0) return "responseCount";
  if (isDenominatorMeasureName(measureName)) return "sum";
  return "average";
};

const looksLikeDate = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) return false;
  return (
    /^\d{4}-\d{1,2}-\d{1,2}$/.test(trimmed) ||
    /^\d{4}\/\d{1,2}\/\d{1,2}(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?$/.test(trimmed) ||
    /^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(trimmed)
  );
};

const looksLikeNumber = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) return false;
  return /^-?\d+(?:\.\d+)?$/.test(trimmed.replace(/,/g, ""));
};

const looksLikeBoolean = (value: string) => /^(true|false|yes|no|y|n|0|1)$/i.test(value.trim());

export const parseCsvRecords = (text: string, options: ParseCsvOptions = {}): ParsedCsv => {
  const maxRows = options.maxRows ?? Number.POSITIVE_INFINITY;
  const includePartialRecord = options.includePartialRecord ?? true;
  const records: string[][] = [];
  const warnings: string[] = [];
  let record: string[] = [];
  let field = "";
  let quoted = false;

  const pushRecord = () => {
    record.push(field);
    field = "";
    if (record.length > 1 || record[0] !== "") {
      records.push(record);
    }
    record = [];
  };

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '"') {
      if (quoted && text[i + 1] === '"') {
        field += '"';
        i += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }

    if (ch === "," && !quoted) {
      record.push(field);
      field = "";
      continue;
    }

    if ((ch === "\n" || ch === "\r") && !quoted) {
      if (ch === "\r" && text[i + 1] === "\n") i += 1;
      pushRecord();
      if (records.length >= maxRows) break;
      continue;
    }

    field += ch;
  }

  const hasPartialRecord = field.length > 0 || record.length > 0;
  if (hasPartialRecord && records.length < maxRows && includePartialRecord && !quoted) {
    pushRecord();
  }

  if (quoted) {
    warnings.push("The sample ended inside a quoted field. The final sampled row was ignored.");
  }

  return { records, endedInsideQuote: quoted, warnings };
};

const inferColumnType = (values: string[]): InferredColumnType => {
  const nonEmpty = values.map((value) => value.trim()).filter(Boolean);
  if (nonEmpty.length === 0) return "empty";
  const sample = nonEmpty.slice(0, 40);
  const numberCount = sample.filter(looksLikeNumber).length;
  const dateCount = sample.filter(looksLikeDate).length;
  const booleanCount = sample.filter(looksLikeBoolean).length;
  const threshold = Math.max(1, Math.ceil(sample.length * 0.75));

  if (dateCount >= threshold) return "date";
  if (numberCount >= threshold) return "number";
  if (booleanCount >= threshold) return "boolean";
  return "text";
};

export const suggestColumnRole = (name: string, inferredType: InferredColumnType): ColumnRole => {
  const header = normalizeHeader(name);
  if (!header) return "ignore";
  if (/\b(zip|zipcode|postal|postal code|home zip)\b/.test(header)) return "locationZip";
  if (/\b(street|address|home street address)\b|streetaddress|homeaddress/.test(header)) return "locationAddress";
  if (/\bcity\b/.test(header)) return "locationCity";
  if (/\bstate\b/.test(header)) return "locationState";
  if (/\b(siteid|site id|schoolid|school id|whichschool|which school)\b/.test(header)) {
    return "locationSiteId";
  }
  if (/\b(personid|person id|student number|student_number|studentid|clientid|surveyid)\b/.test(header)) {
    return "entityId";
  }
  if (/\b(firstname|first name|lastname|last name|name|school attending)\b/.test(header)) return "name";
  if (/\b(date|time|school year|year)\b/.test(header)) return "date";
  if (
    /^\d+\s/.test(header) ||
    /\b(present|absen|minutes|membership|score|count|total|rate|percent|survey)\b/.test(header)
  ) {
    return "measure";
  }
  if (/\b(grade|gender|ethnicity|language|pre or post|status|category|type)\b/.test(header)) {
    return "category";
  }
  return inferredType === "number" || inferredType === "boolean" ? "measure" : "ignore";
};

const detectKind = (headers: string[]): CustomDataKind => {
  const joined = headers.map(normalizeHeader).join(" | ");
  if (/\bispresent\b|\bisabsent\b|\bpresent\b|\babsences\b|\bminutes\b/.test(joined)) return "attendance";
  if (/\bsurveyid\b|\bsurveydate\b|\bpre or post\b|kids here|mostly yes|mostly agree/.test(joined)) {
    return "survey";
  }
  if (/\bpersonid\b|\bfirstname\b|\blastname\b|\bdob\b|\bethnicity\b|\bstreetaddress\b/.test(joined)) {
    return "people";
  }
  return "generic";
};

export const profileCsvText = (
  text: string,
  {
    fileName = "Uploaded CSV",
    sizeBytes = text.length,
    maxRows = DEFAULT_SAMPLE_ROWS,
    truncated = false,
  }: {
    fileName?: string;
    sizeBytes?: number;
    maxRows?: number;
    truncated?: boolean;
  } = {},
): CsvProfile => {
  const parsed = parseCsvRecords(text, { maxRows: maxRows + 1, includePartialRecord: !truncated });
  const [headers = [], ...rows] = parsed.records;
  const sampledRows = rows.length;
  const malformedRows = rows.filter((row) => row.length !== headers.length).length;
  const columnValues = headers.map((): string[] => []);
  const nonEmptyCounts = headers.map(() => 0);
  const examples = headers.map((): string[] => []);
  const uniques = headers.map(() => new Set<string>());

  rows.forEach((row) => {
    headers.forEach((_, index) => {
      const value = row[index] ?? "";
      const normalized = value.trim();
      columnValues[index].push(value);
      if (!normalized) return;
      nonEmptyCounts[index] += 1;
      if (examples[index].length < MAX_EXAMPLES && !examples[index].includes(normalized)) {
        examples[index].push(normalized.replace(/\s+/g, " ").slice(0, 120));
      }
      if (uniques[index].size < MAX_UNIQUE_TRACKED) {
        uniques[index].add(normalized);
      }
    });
  });

  const columns = headers.map((name, index) => {
    const inferredType = inferColumnType(columnValues[index] ?? []);
    return {
      index,
      name: name.trim() || `Column ${index + 1}`,
      fillRate: sampledRows === 0 ? 0 : nonEmptyCounts[index] / sampledRows,
      examples: examples[index],
      uniqueSampleCount: uniques[index].size,
      inferredType,
      suggestedRole: suggestColumnRole(name, inferredType),
    };
  });

  const warnings = [...parsed.warnings];
  if (malformedRows > 0) {
    warnings.push(`${malformedRows} sampled rows had a different column count than the header.`);
  }
  if (truncated) {
    warnings.push("Column detection used the first 5,000 rows of this large file. You can still process the full file in Preview.");
  }

  return {
    fileName,
    sizeBytes,
    sampledRows,
    columnCount: headers.length,
    truncated,
    detectedKind: detectKind(headers),
    columns,
    warnings,
  };
};

export const profileCsvFile = async (
  file: File,
  {
    maxBytes = DEFAULT_SAMPLE_BYTES,
    maxRows = DEFAULT_SAMPLE_ROWS,
  }: {
    maxBytes?: number;
    maxRows?: number;
  } = {},
): Promise<CsvProfile> => {
  const sample = file.slice(0, maxBytes);
  const text = await sample.text();
  return profileCsvText(text, {
    fileName: file.name,
    sizeBytes: file.size,
    maxRows,
    truncated: file.size > maxBytes,
  });
};

export const collectCsvColumnValuesFile = async (
  file: File,
  columnName: string,
  {
    maxBytes = DEFAULT_SAMPLE_BYTES,
    maxRows = DEFAULT_SAMPLE_ROWS,
    maxValues = DEFAULT_LOOKUP_SAMPLE_VALUES,
  }: {
    maxBytes?: number;
    maxRows?: number;
    maxValues?: number;
  } = {},
): Promise<ColumnValueSample> => {
  const sample = file.slice(0, maxBytes);
  const text = await sample.text();
  const parsed = parseCsvRecords(text, { maxRows: maxRows + 1, includePartialRecord: file.size <= maxBytes });
  const [headers = [], ...rows] = parsed.records;
  const index = headers.findIndex((header) => header === columnName);
  if (index < 0) {
    return {
      columnName,
      values: [],
      truncated: file.size > maxBytes,
      sampledRows: 0,
    };
  }

  const values = new Set<string>();
  for (const row of rows) {
    const value = (row[index] ?? "").trim();
    if (!value) continue;
    values.add(value);
    if (values.size >= maxValues) break;
  }

  return {
    columnName,
    values: Array.from(values).sort((a, b) => a.localeCompare(b)),
    truncated: file.size > maxBytes || values.size >= maxValues,
    sampledRows: rows.length,
  };
};

export const sortColumnsForReview = (columns: ColumnProfile[]): ColumnProfile[] => {
  return [...columns].sort((a, b) => {
    const roleDelta = ROLE_PRIORITY[a.suggestedRole] - ROLE_PRIORITY[b.suggestedRole];
    if (roleDelta !== 0) return roleDelta;
    return a.index - b.index;
  });
};

const parseMeasureValue = (value: string): { value: number; numeric: boolean } | null => {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const normalized = trimmed.toLowerCase();
  if (looksLikeNumber(trimmed)) return { value: Number(trimmed.replace(/,/g, "")), numeric: true };
  if (["true", "yes", "y"].includes(normalized)) return { value: 1, numeric: true };
  if (["false", "no", "n"].includes(normalized)) return { value: 0, numeric: true };
  return { value: 1, numeric: false };
};

const normalizeZip = (value: string) => {
  const match = value.trim().match(/\d{5}/);
  return match?.[0] ?? "";
};

const normalizeLookupKey = (value: string) => value.trim().toLowerCase();

const normalizeDateBucket = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) return "all";
  const iso = trimmed.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, "0")}-${iso[3].padStart(2, "0")}`;
  const slash = trimmed.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})/);
  if (slash) return `${slash[1]}-${slash[2].padStart(2, "0")}-${slash[3].padStart(2, "0")}`;
  return trimmed.slice(0, 40);
};

const roleEntries = (headers: string[], roles: Record<string, ColumnRole>, role: ColumnRole) =>
  headers
    .map((name, index) => ({ name, index, role: roles[name] }))
    .filter((entry) => entry.role === role);

type Bucket = {
  sum: number;
  count: number;
  min: number;
  max: number;
  numericValues: number;
  textValues: number;
};

type MeasureTotals = {
  numericValues: number;
  textValues: number;
  areas: Set<string>;
  dates: Set<string>;
};

const createTransformBuilder = (
  headers: string[],
  mapping: CsvTransformMapping,
  warnings: string[],
  {
    complete,
    statDataMode,
    bytesRead,
    totalBytes,
  }: {
    complete: boolean;
    statDataMode: "sample" | "full";
    bytesRead?: number;
    totalBytes?: number;
  },
) => {
  const zipColumn = roleEntries(headers, mapping.roles, "locationZip")[0] ?? null;
  const siteColumn = roleEntries(headers, mapping.roles, "locationSiteId")[0] ?? null;
  const addressColumn = roleEntries(headers, mapping.roles, "locationAddress")[0] ?? null;
  const cityColumn = roleEntries(headers, mapping.roles, "locationCity")[0] ?? null;
  const stateColumn = roleEntries(headers, mapping.roles, "locationState")[0] ?? null;
  const dateColumn = roleEntries(headers, mapping.roles, "date")[0] ?? null;
  const measureColumns = roleEntries(headers, mapping.roles, "measure");
  const siteIdToZip = new Map<string, string>();
  for (const [siteId, zip] of Object.entries(mapping.locationLookups?.siteIdToZip ?? {})) {
    const normalizedSiteId = normalizeLookupKey(siteId);
    const normalizedZip = normalizeZip(zip);
    if (normalizedSiteId && normalizedZip) siteIdToZip.set(normalizedSiteId, normalizedZip);
  }
  const resolvesSiteIdsToZip = Boolean(siteColumn && siteIdToZip.size > 0);
  const locationKind: TransformLocationKind | null = zipColumn || resolvesSiteIdsToZip ? "ZIP" : siteColumn ? "SITE_ID" : addressColumn ? "ADDRESS" : null;
  const locationColumn = zipColumn?.name ?? siteColumn?.name ?? addressColumn?.name ?? null;

  if (siteColumn && !resolvesSiteIdsToZip) {
    warnings.push("Site/school IDs need a lookup table before they can render as ZIP or county map areas.");
  }
  if (resolvesSiteIdsToZip) {
    warnings.push("Site/school IDs are being resolved to ZIPs with this import's lookup table.");
  }
  if (locationKind === "ADDRESS") {
    warnings.push("Address locations need geocoding before they can render as map areas.");
  }

  const buckets = new Map<string, Bucket>();
  const measureTotals = new Map<string, MeasureTotals>();
  const unresolvedSiteIds = new Set<string>();
  let skippedRows = 0;
  let sampledRows = 0;

  const resolveLocation = (row: string[]) => {
    if (zipColumn) return normalizeZip(row[zipColumn.index] ?? "");
    if (siteColumn) {
      const rawSiteId = (row[siteColumn.index] ?? "").trim();
      if (!rawSiteId) return "";
      if (resolvesSiteIdsToZip) {
        const zip = siteIdToZip.get(normalizeLookupKey(rawSiteId)) ?? "";
        if (!zip) unresolvedSiteIds.add(rawSiteId);
        return zip;
      }
      return rawSiteId;
    }
    if (addressColumn) {
      return [row[addressColumn.index], cityColumn ? row[cityColumn.index] : "", stateColumn ? row[stateColumn.index] : ""]
        .map((part) => (part ?? "").trim())
        .filter(Boolean)
        .join(", ");
    }
    return "";
  };

  const addRow = (row: string[]) => {
    sampledRows += 1;
    const area = resolveLocation(row);
    if (!area) {
      skippedRows += 1;
      return;
    }
    const date = dateColumn ? normalizeDateBucket(row[dateColumn.index] ?? "") : "all";
    let usedRow = false;
    for (const measure of measureColumns) {
      const parsedValue = parseMeasureValue(row[measure.index] ?? "");
      if (!parsedValue) {
        continue;
      }
      const key = `${measure.name}\u001f${date}\u001f${area}`;
      const bucket = buckets.get(key) ?? {
        sum: 0,
        count: 0,
        min: Number.POSITIVE_INFINITY,
        max: Number.NEGATIVE_INFINITY,
        numericValues: 0,
        textValues: 0,
      };
      bucket.sum += parsedValue.value;
      bucket.count += 1;
      bucket.min = Math.min(bucket.min, parsedValue.value);
      bucket.max = Math.max(bucket.max, parsedValue.value);
      if (parsedValue.numeric) bucket.numericValues += 1;
      else bucket.textValues += 1;
      buckets.set(key, bucket);

      const totals = measureTotals.get(measure.name) ?? {
        numericValues: 0,
        textValues: 0,
        areas: new Set<string>(),
        dates: new Set<string>(),
      };
      if (parsedValue.numeric) totals.numericValues += 1;
      else totals.textValues += 1;
      totals.areas.add(area);
      totals.dates.add(date);
      measureTotals.set(measure.name, totals);
      usedRow = true;
    }
    if (!usedRow) skippedRows += 1;
  };

  const build = (): CsvTransformPreview => {
    const unresolvedLocationValues = Array.from(unresolvedSiteIds).sort((a, b) => a.localeCompare(b)).slice(0, DEFAULT_LOOKUP_SAMPLE_VALUES);
    if (unresolvedSiteIds.size > 0) {
      warnings.push(
        `${unresolvedSiteIds.size.toLocaleString()} site/school IDs were not in the ZIP lookup and were skipped from ZIP stats.`,
      );
    }
    const measures: TransformMeasurePreview[] = Array.from(measureTotals.entries()).map(([measureName, totals]) => {
      const aggregation: TransformAggregation =
        mapping.aggregations?.[measureName] ??
        inferDefaultAggregation(measureName, totals);
      const sampleAreas: TransformMeasurePreview["sampleAreas"] = [];
      for (const [key, bucket] of buckets.entries()) {
        const [bucketMeasure, date, area] = key.split("\u001f");
        if (bucketMeasure !== measureName) continue;
        sampleAreas.push({
          area,
          date,
          value:
            aggregation === "average"
              ? bucket.sum / bucket.count
              : aggregation === "sum"
                ? bucket.sum
                : bucket.count,
        });
        if (sampleAreas.length >= 5) break;
      }
      return {
        measureName,
        aggregation,
        numericValues: totals.numericValues,
        textValues: totals.textValues,
        areaCount: totals.areas.size,
        dateCount: totals.dates.size,
        sampleAreas,
      };
    });

    const statDataRows: StatDataPreviewRow[] = [];
    if (locationKind) {
      const measureRows = statDataMode === "sample" ? measures.slice(0, 4) : measures;
      for (const measure of measureRows) {
        const dates = new Set<string>();
        let measureMin = Number.POSITIVE_INFINITY;
        let measureMax = Number.NEGATIVE_INFINITY;
        for (const key of buckets.keys()) {
          const [bucketMeasure, date] = key.split("\u001f");
          if (bucketMeasure !== measure.measureName) continue;
          dates.add(date);
          const bucket = buckets.get(key);
          if (bucket && bucket.numericValues > 0) {
            measureMin = Math.min(measureMin, bucket.min);
            measureMax = Math.max(measureMax, bucket.max);
          }
        }
        const measureRange =
          Number.isFinite(measureMin) && Number.isFinite(measureMax)
            ? { min: measureMin, max: measureMax }
            : null;
        const inferredStatType = measure.aggregation === "average" ? inferAverageStatType(measure.measureName, measureRange) : "count";
        const statType = mapping.valueTypes?.[measure.measureName] ?? inferredStatType;
        const dateRows = statDataMode === "sample" ? Array.from(dates).slice(0, 2) : Array.from(dates);
        for (const date of dateRows) {
          const data: Record<string, number> = {};
          for (const [key, bucket] of buckets.entries()) {
            const [bucketMeasure, bucketDate, area] = key.split("\u001f");
            if (bucketMeasure !== measure.measureName || bucketDate !== date) continue;
            data[area] =
              measure.aggregation === "average"
                ? bucket.sum / bucket.count
                : measure.aggregation === "sum"
                  ? bucket.sum
                  : bucket.count;
            if (statDataMode === "sample" && Object.keys(data).length >= 8) break;
          }
          statDataRows.push({
            statName: `${mapping.datasetName || "Custom import"} - ${measure.measureName}`,
            name: "root",
            parentArea: locationKind === "ZIP" ? ZIP_PARENT_AREA : "Unresolved custom locations",
            boundaryType: locationKind,
            date,
            type: statType,
            data,
          });
        }
      }
    }

    return {
      sampledRows,
      skippedRows,
      bytesRead,
      totalBytes,
      isComplete: complete,
      locationKind,
      locationColumn,
      dateColumn: dateColumn?.name ?? null,
      measureCount: measureColumns.length,
      measures,
      statDataRows,
      unresolvedLocationValues,
      warnings,
    };
  };

  return { addRow, build };
};

export const previewCsvTransformText = (
  text: string,
  mapping: CsvTransformMapping,
  {
    maxRows = DEFAULT_TRANSFORM_SAMPLE_ROWS,
    truncated = false,
  }: {
    maxRows?: number;
    truncated?: boolean;
  } = {},
): CsvTransformPreview => {
  const parsed = parseCsvRecords(text, { maxRows: maxRows + 1, includePartialRecord: !truncated });
  const [headers = [], ...rows] = parsed.records;
  const warnings = [...parsed.warnings];
  if (truncated) warnings.push("Transform preview used the beginning of the file only.");
  const builder = createTransformBuilder(headers, mapping, warnings, {
    complete: !truncated,
    statDataMode: "sample",
    bytesRead: text.length,
  });
  rows.forEach(builder.addRow);
  return builder.build();
};

export const previewCsvTransformFile = async (
  file: File,
  mapping: CsvTransformMapping,
  {
    maxBytes = DEFAULT_TRANSFORM_SAMPLE_BYTES,
    maxRows = DEFAULT_TRANSFORM_SAMPLE_ROWS,
  }: {
    maxBytes?: number;
    maxRows?: number;
  } = {},
): Promise<CsvTransformPreview> => {
  const sample = file.slice(0, maxBytes);
  const text = await sample.text();
  const preview = previewCsvTransformText(text, mapping, {
    maxRows,
    truncated: file.size > maxBytes,
  });
  return {
    ...preview,
    bytesRead: sample.size,
    totalBytes: file.size,
  };
};

export const transformCsvFile = async (
  file: File,
  mapping: CsvTransformMapping,
  {
    maxRows = Number.POSITIVE_INFINITY,
    onProgress,
  }: {
    maxRows?: number;
    onProgress?: (progress: CsvTransformProgress) => void;
  } = {},
): Promise<CsvTransformPreview> => {
  const decoder = new TextDecoder();
  const reader = file.stream().getReader();
  const warnings: string[] = [];
  let headers: string[] | null = null;
  let builder: ReturnType<typeof createTransformBuilder> | null = null;
  let record: string[] = [];
  let field = "";
  let quoted = false;
  let pendingClosingQuote = false;
  let rowsProcessed = 0;
  let bytesRead = 0;
  let cancelled = false;
  let previousCharWasCr = false;

  const pushRecord = () => {
    record.push(field);
    field = "";
    if (record.length === 1 && record[0] === "") {
      record = [];
      return;
    }
    if (!headers) {
      headers = record;
      builder = createTransformBuilder(headers, mapping, warnings, {
        complete: true,
        statDataMode: "full",
        totalBytes: file.size,
      });
      record = [];
      return;
    }
    if (rowsProcessed < maxRows) {
      builder?.addRow(record);
      rowsProcessed += 1;
      if (rowsProcessed % 5000 === 0) {
        onProgress?.({ rowsProcessed, bytesRead, totalBytes: file.size });
      }
    }
    if (rowsProcessed >= maxRows) {
      cancelled = true;
    }
    record = [];
  };

  const consumeChar = (ch: string) => {
    if (pendingClosingQuote) {
      if (ch === '"') {
        field += '"';
        pendingClosingQuote = false;
        return;
      }
      pendingClosingQuote = false;
      quoted = false;
    }

    if (ch === '"') {
      if (quoted) {
        pendingClosingQuote = true;
      } else {
        quoted = true;
      }
      return;
    }

    if (ch === "," && !quoted) {
      record.push(field);
      field = "";
      return;
    }

    if ((ch === "\n" || ch === "\r") && !quoted) {
      pushRecord();
      return;
    }

    field += ch;
  };

  while (!cancelled) {
    const { done, value } = await reader.read();
    if (done) break;
    bytesRead += value.byteLength;
    const chunk = decoder.decode(value, { stream: true });
    for (let i = 0; i < chunk.length; i += 1) {
      const ch = chunk[i];
      if (ch === "\n" && previousCharWasCr) {
        previousCharWasCr = false;
        continue;
      }
      consumeChar(ch);
      previousCharWasCr = ch === "\r";
      if (cancelled) break;
    }
  }
  if (cancelled) {
    await reader.cancel().catch(() => undefined);
  }
  const tail = decoder.decode();
  for (let i = 0; i < tail.length; i += 1) {
    consumeChar(tail[i]);
  }
  if (pendingClosingQuote) {
    pendingClosingQuote = false;
    quoted = false;
  }
  if (quoted) {
    warnings.push("The file ended inside a quoted field. The final row was ignored.");
  } else if (field.length > 0 || record.length > 0) {
    pushRecord();
  }
  if (cancelled) {
    warnings.push(`Full-file transform stopped after ${rowsProcessed.toLocaleString()} rows.`);
  }
  onProgress?.({ rowsProcessed, bytesRead, totalBytes: file.size });

  const finalBuilder = builder as ReturnType<typeof createTransformBuilder> | null;
  if (!finalBuilder) {
    return {
      sampledRows: 0,
      skippedRows: 0,
      bytesRead,
      totalBytes: file.size,
      isComplete: !cancelled,
      locationKind: null,
      locationColumn: null,
      dateColumn: null,
      measureCount: 0,
      measures: [],
      statDataRows: [],
      unresolvedLocationValues: [],
      warnings,
    };
  }

  const result = finalBuilder.build();
  return {
    ...result,
    bytesRead,
    totalBytes: file.size,
    isComplete: !cancelled,
  };
};
