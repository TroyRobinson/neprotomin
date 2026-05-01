import { useMemo, useState } from "react";
import type { ChangeEvent } from "react";
import { id } from "@instantdb/react";
import {
  AdjustmentsHorizontalIcon,
  CheckCircleIcon,
  ClipboardDocumentIcon,
  DocumentArrowUpIcon,
  TrashIcon,
  ExclamationTriangleIcon,
  TableCellsIcon,
} from "@heroicons/react/24/outline";
import { db } from "../../lib/reactDb";
import {
  collectCsvColumnValuesFile,
  previewCsvTransformFile,
  profileCsvFile,
  sortColumnsForReview,
  transformCsvFile,
  type ColumnProfile,
  type ColumnRole,
  type CsvProfile,
  type CsvTransformProgress,
  type CsvTransformPreview,
  type CustomStatValueType,
  type CustomDataKind,
  type TransformAggregation,
} from "../lib/customDataCsv";

interface Command {
  title: string;
  command: string;
  description: string;
}

type WizardStep = "upload" | "columns" | "mapping" | "preview";

type RoleMap = Record<number, ColumnRole>;

type ImportRecipe = {
  datasetName: string;
  datasetKind: CustomDataKind;
  sourceFile: string;
  sampledRows: number;
  location: string | null;
  entityId: string | null;
  label: string | null;
  date: string | null;
  measures: string[];
  categories: string[];
  roles: Record<string, ColumnRole>;
  aggregations: Record<string, TransformAggregation>;
  valueTypes: Record<string, CustomStatValueType>;
  locationLookups?: {
    siteIdToZip?: Record<string, string>;
  };
};

type CustomDataImportRow = {
  id: string;
  name?: string;
  kind?: string;
  sourceFile?: string;
  status?: string;
  sampledRows?: number;
  columnCount?: number;
  updatedAt?: number;
  recipe?: ImportRecipe;
};

type SiteLookupSample = {
  columnName: string;
  values: string[];
  truncated: boolean;
  sampledRows: number;
};

const commands: Command[] = [
  {
    title: "Clean Synthetic Data",
    command: "npm run ne:clean:synthetic",
    description: "Remove old synthetic/demo data (run this first if you see random data)",
  },
  {
    title: "Clean Unnamed Stats",
    command: "npm run ne:clean:unnamed",
    description: "Remove stats with placeholder names like 'Stat eRGj2qGP' (no proper title from NE)",
  },
  {
    title: "Preview Data Import",
    command: "npm run ne:etl:preview:staging",
    description: "Preview 10 stats from Neighborhood Explorer (no database writes)",
  },
  {
    title: "Quick Bulk Import",
    command: "npm run ne:bulk:zip:import:staging -- --limit=10 --years=3",
    description: "Import 10 recent stats with 3 years of ZIP-level data",
  },
  {
    title: "Import Single Stat",
    command: "npm run ne:geo:series:staging -- --stat=<HASH_ID> --geometry=zip --start=2020-01-01 --end=2024-12-31",
    description: "Import all years for a specific stat (replace <HASH_ID> with actual NE stat ID)",
  },
  {
    title: "Migrate Timestamps",
    command: "npm run ne:migrate:timestamps",
    description: "Backfill createdOn, lastUpdated, and statTitle for existing records (run once after schema update)",
  },
];

const steps: Array<{ id: WizardStep; label: string; icon: typeof DocumentArrowUpIcon }> = [
  { id: "upload", label: "Upload", icon: DocumentArrowUpIcon },
  { id: "columns", label: "Columns", icon: TableCellsIcon },
  { id: "mapping", label: "Mapping", icon: AdjustmentsHorizontalIcon },
  { id: "preview", label: "Preview", icon: CheckCircleIcon },
];

const roleLabels: Record<ColumnRole, string> = {
  ignore: "Ignore",
  entityId: "Entity ID",
  name: "Name or label",
  locationZip: "ZIP",
  locationAddress: "Address",
  locationCity: "City",
  locationState: "State",
  locationSiteId: "Site or school ID",
  date: "Date",
  measure: "Measure",
  category: "Category",
};

const kindLabels: Record<CustomDataKind, string> = {
  attendance: "Attendance",
  people: "People or participants",
  survey: "Survey",
  generic: "Generic metrics",
};

const aggregationLabels: Record<TransformAggregation, string> = {
  average: "Average",
  sum: "Sum",
  count: "Count values",
  responseCount: "Count responses",
};

const aggregationOptions: TransformAggregation[] = ["average", "sum", "count", "responseCount"];
const valueTypeLabels: Record<CustomStatValueType, string> = {
  percent: "Percent",
  rate: "Decimal rate",
  count: "Number/count",
  currency: "Currency",
  years: "Years",
};
const valueTypeOptions: CustomStatValueType[] = ["percent", "rate", "count", "currency", "years"];
const PUBLISH_BATCH_SIZE = 100;
const STAT_DATA_PREVIEW_LIMIT = 20;

const roleOptions: ColumnRole[] = [
  "ignore",
  "entityId",
  "name",
  "locationZip",
  "locationAddress",
  "locationCity",
  "locationState",
  "locationSiteId",
  "date",
  "measure",
  "category",
];

const formatBytes = (bytes: number) => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
};

const getColumnsByRole = (profile: CsvProfile | null, roles: RoleMap, role: ColumnRole): ColumnProfile[] => {
  if (!profile) return [];
  return profile.columns.filter((column) => roles[column.index] === role);
};

const getInitialRoles = (profile: CsvProfile): RoleMap => {
  let hasDate = false;
  return Object.fromEntries(
    profile.columns.map((column) => {
      if (column.suggestedRole !== "date") return [column.index, column.suggestedRole];
      if (hasDate) return [column.index, "ignore"];
      hasDate = true;
      return [column.index, column.suggestedRole];
    }),
  );
};

const normalizeMeasureName = (value: string) => value.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ");

const isProportionMeasureName = (name: string): boolean =>
  /\b(present|attendance|absence|absences|absent|rate|percent|percentage|pct|share|proportion)\b/.test(
    normalizeMeasureName(name),
  );

const isDenominatorMeasureName = (name: string): boolean =>
  /\b(student\s*membership|membership|enrollment|enrolled|eligible|denominator|total\s*students|student\s*count|record\s*count|row\s*count|n)\b/.test(
    normalizeMeasureName(name),
  );

const getDefaultAggregation = (column: ColumnProfile): TransformAggregation => {
  if (column.inferredType === "text") return "responseCount";
  if (isDenominatorMeasureName(column.name)) return "sum";
  return "average";
};

const getDefaultValueType = (column: ColumnProfile): CustomStatValueType => {
  if (column.inferredType === "text") return "count";
  if (isProportionMeasureName(column.name)) return "percent";
  if (isDenominatorMeasureName(column.name)) return "count";
  return "rate";
};

const parseSiteZipLookupText = (text: string): Record<string, string> => {
  const entries: Array<[string, string]> = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const [siteIdPart, zipPart] = trimmed.split(/[,\t]/);
    const siteId = siteIdPart?.trim() ?? "";
    const zip = zipPart?.trim().match(/\d{5}/)?.[0] ?? "";
    if (!siteId || !zip) continue;
    entries.push([siteId, zip]);
  }
  return Object.fromEntries(entries);
};

const roleBadgeClass = (role: ColumnRole) => {
  if (role === "ignore") {
    return "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300";
  }
  if (role === "measure") {
    return "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-200";
  }
  if (role.startsWith("location")) {
    return "bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-200";
  }
  return "bg-violet-50 text-violet-700 dark:bg-violet-950 dark:text-violet-200";
};

const transactInBatches = async (txs: any[]) => {
  for (let index = 0; index < txs.length; index += PUBLISH_BATCH_SIZE) {
    await db.transact(txs.slice(index, index + PUBLISH_BATCH_SIZE));
  }
};

const deleteExistingCustomPreviewRows = async (owner: string, importId: string) => {
  const { data } = await db.queryOnce({
    customDataStats: {
      $: {
        where: { owner, importId },
        fields: ["id"],
      },
    },
    customDataStatData: {
      $: {
        where: { owner, importId },
        fields: ["id"],
      },
    },
    customDataStatSummaries: {
      $: {
        where: { owner, importId },
        fields: ["id"],
      },
    },
  });
  const deleteTxs: any[] = [];
  for (const row of ((data as any)?.customDataStatData ?? []) as any[]) {
    if (typeof row?.id === "string") deleteTxs.push(db.tx.customDataStatData[row.id].delete());
  }
  for (const row of ((data as any)?.customDataStatSummaries ?? []) as any[]) {
    if (typeof row?.id === "string") deleteTxs.push(db.tx.customDataStatSummaries[row.id].delete());
  }
  for (const row of ((data as any)?.customDataStats ?? []) as any[]) {
    if (typeof row?.id === "string") deleteTxs.push(db.tx.customDataStats[row.id].delete());
  }
  await transactInBatches(deleteTxs);
};

export const DataScreen = () => {
  const { user, isLoading: authLoading } = db.useAuth();
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const [step, setStep] = useState<WizardStep>("upload");
  const [profile, setProfile] = useState<CsvProfile | null>(null);
  const [roles, setRoles] = useState<RoleMap>({});
  const [datasetName, setDatasetName] = useState("");
  const [datasetKind, setDatasetKind] = useState<CustomDataKind>("generic");
  const [isProfiling, setIsProfiling] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [showAllColumns, setShowAllColumns] = useState(false);
  const [measureAggregations, setMeasureAggregations] = useState<Record<string, TransformAggregation>>({});
  const [measureValueTypes, setMeasureValueTypes] = useState<Record<string, CustomStatValueType>>({});
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [transformPreview, setTransformPreview] = useState<CsvTransformPreview | null>(null);
  const [transformStatus, setTransformStatus] = useState<"idle" | "running" | "ready" | "error">("idle");
  const [transformMode, setTransformMode] = useState<"sample" | "full">("sample");
  const [transformProgress, setTransformProgress] = useState<CsvTransformProgress | null>(null);
  const [transformError, setTransformError] = useState<string | null>(null);
  const [activeImportId, setActiveImportId] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [publishStatus, setPublishStatus] = useState<"idle" | "publishing" | "published" | "error">("idle");
  const [publishError, setPublishError] = useState<string | null>(null);
  const [deletingImportId, setDeletingImportId] = useState<string | null>(null);
  const [siteZipLookupText, setSiteZipLookupText] = useState("");
  const [siteLookupSample, setSiteLookupSample] = useState<SiteLookupSample | null>(null);
  const [isLoadingSiteLookupSample, setIsLoadingSiteLookupSample] = useState(false);

  const {
    data: customImportResponse,
    isLoading: importsLoading,
    error: importsError,
  } = db.useQuery(
    user?.id
      ? {
          customDataImports: {
            $: {
              where: { owner: user.id },
              order: { updatedAt: "desc" },
              limit: 12,
            },
          },
        }
      : null,
  );

  const savedImports = useMemo(() => {
    return ((customImportResponse as any)?.customDataImports ?? []) as CustomDataImportRow[];
  }, [customImportResponse]);

  const copyToClipboard = (text: string, index: number) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedIndex(index);
      setTimeout(() => setCopiedIndex(null), 2000);
    });
  };

  const handleFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setIsProfiling(true);
    setProfileError(null);
    setShowAllColumns(false);
    setMeasureAggregations({});
    setMeasureValueTypes({});
    setSelectedFile(file);
    setTransformPreview(null);
    setTransformStatus("idle");
    setTransformMode("sample");
    setTransformProgress(null);
    setTransformError(null);
    setSaveStatus("idle");
    setSaveError(null);
    setPublishStatus("idle");
    setPublishError(null);
    setActiveImportId(null);
    setSiteZipLookupText("");
    setSiteLookupSample(null);

    try {
      const nextProfile = await profileCsvFile(file);
      setProfile(nextProfile);
      setRoles(getInitialRoles(nextProfile));
      setMeasureAggregations(
        Object.fromEntries(
          nextProfile.columns
            .filter((column) => column.suggestedRole === "measure")
            .map((column) => [column.name, getDefaultAggregation(column)]),
        ),
      );
      setMeasureValueTypes(
        Object.fromEntries(
          nextProfile.columns
            .filter((column) => column.suggestedRole === "measure")
            .map((column) => [column.name, getDefaultValueType(column)]),
        ),
      );
      setDatasetName(file.name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " "));
      setDatasetKind(nextProfile.detectedKind);
      setStep("columns");
    } catch (error) {
      setProfileError(error instanceof Error ? error.message : "Unable to profile this file.");
    } finally {
      setIsProfiling(false);
    }
  };

  const sortedColumns = useMemo(() => (profile ? sortColumnsForReview(profile.columns) : []), [profile]);
  const displayedColumns = showAllColumns ? sortedColumns : sortedColumns.slice(0, 72);
  const measureColumns = useMemo(() => getColumnsByRole(profile, roles, "measure"), [profile, roles]);
  const effectiveMeasureAggregations = useMemo(() => {
    return Object.fromEntries(
      measureColumns.map((column) => [
        column.name,
        measureAggregations[column.name] ?? getDefaultAggregation(column),
      ]),
    ) as Record<string, TransformAggregation>;
  }, [measureAggregations, measureColumns]);
  const effectiveMeasureValueTypes = useMemo(() => {
    return Object.fromEntries(
      measureColumns.map((column) => [
        column.name,
        measureValueTypes[column.name] ?? getDefaultValueType(column),
      ]),
    ) as Record<string, CustomStatValueType>;
  }, [measureColumns, measureValueTypes]);
  const categoryColumns = useMemo(() => getColumnsByRole(profile, roles, "category"), [profile, roles]);
  const dateColumns = useMemo(() => getColumnsByRole(profile, roles, "date"), [profile, roles]);
  const idColumns = useMemo(() => getColumnsByRole(profile, roles, "entityId"), [profile, roles]);
  const nameColumns = useMemo(() => getColumnsByRole(profile, roles, "name"), [profile, roles]);
  const zipColumns = useMemo(() => getColumnsByRole(profile, roles, "locationZip"), [profile, roles]);
  const siteColumns = useMemo(() => getColumnsByRole(profile, roles, "locationSiteId"), [profile, roles]);
  const addressColumns = useMemo(() => getColumnsByRole(profile, roles, "locationAddress"), [profile, roles]);
  const cityColumns = useMemo(() => getColumnsByRole(profile, roles, "locationCity"), [profile, roles]);
  const stateColumns = useMemo(() => getColumnsByRole(profile, roles, "locationState"), [profile, roles]);
  const siteZipLookup = useMemo(() => parseSiteZipLookupText(siteZipLookupText), [siteZipLookupText]);
  const siteZipLookupCount = Object.keys(siteZipLookup).length;
  const needsSiteZipLookup = siteColumns.length > 0 && zipColumns.length === 0;
  const unresolvedSampleSiteIds = useMemo(() => {
    if (!siteLookupSample) return [];
    const mapped = new Set(Object.keys(siteZipLookup).map((value) => value.trim().toLowerCase()));
    return siteLookupSample.values.filter((value) => !mapped.has(value.trim().toLowerCase()));
  }, [siteLookupSample, siteZipLookup]);

  const mappingIssues = useMemo(() => {
    const issues: string[] = [];
    if (!profile) return issues;
    const hasLocation =
      zipColumns.length > 0 ||
      siteColumns.length > 0 ||
      (addressColumns.length > 0 && cityColumns.length > 0 && stateColumns.length > 0);
    if (!hasLocation) {
      issues.push("Map a ZIP, a site/school ID, or address + city + state.");
    }
    if (measureColumns.length === 0) {
      issues.push("Map at least one numeric, boolean, or answer column as a measure.");
    }
    if (dateColumns.length === 0) {
      issues.push("Map a date column if the dataset should support trends or time filters.");
    }
    if (needsSiteZipLookup && siteZipLookupCount === 0) {
      issues.push("This file uses school IDs instead of ZIPs. Add school ID to ZIP pairs so published stats can appear on the map.");
    }
    return issues;
  }, [addressColumns.length, cityColumns.length, dateColumns.length, measureColumns.length, needsSiteZipLookup, profile, siteColumns.length, siteZipLookupCount, stateColumns.length, zipColumns.length]);

  const hasBlockingIssue = mappingIssues.some((issue) => !issue.startsWith("Map a date"));

  const importRecipe = useMemo(() => {
    if (!profile) return null;
    return {
      datasetName,
      datasetKind,
      sourceFile: profile.fileName,
      sampledRows: profile.sampledRows,
      location:
        zipColumns[0]?.name ??
        siteColumns[0]?.name ??
        (addressColumns[0] && cityColumns[0] && stateColumns[0]
          ? `${addressColumns[0].name}, ${cityColumns[0].name}, ${stateColumns[0].name}`
          : null),
      entityId: idColumns[0]?.name ?? null,
      label: nameColumns[0]?.name ?? null,
      date: dateColumns[0]?.name ?? null,
      measures: measureColumns.map((column) => column.name),
      categories: categoryColumns.map((column) => column.name),
      roles: Object.fromEntries(
        profile.columns.map((column) => [column.name, roles[column.index] ?? column.suggestedRole]),
      ),
      aggregations: effectiveMeasureAggregations,
      valueTypes: effectiveMeasureValueTypes,
      locationLookups: siteZipLookupCount > 0 ? { siteIdToZip: siteZipLookup } : undefined,
    };
  }, [
    addressColumns,
    categoryColumns,
    cityColumns,
    datasetKind,
    datasetName,
    dateColumns,
    idColumns,
    effectiveMeasureAggregations,
    effectiveMeasureValueTypes,
    measureColumns,
    nameColumns,
    profile,
    roles,
    siteColumns,
    siteZipLookup,
    siteZipLookupCount,
    stateColumns,
    zipColumns,
  ]);

  const saveImportDraft = async (): Promise<string | null> => {
    if (!profile || !importRecipe || !user?.id) return null;
    setSaveStatus("saving");
    setSaveError(null);
    const now = Date.now();
    const importId = activeImportId ?? id();
    const importPayload: Record<string, unknown> = {
      name: datasetName.trim() || profile.fileName,
      owner: user.id,
      kind: datasetKind,
      sourceFile: profile.fileName,
      sourceSizeBytes: profile.sizeBytes,
      status: "draft",
      sampledRows: profile.sampledRows,
      columnCount: profile.columnCount,
      recipe: importRecipe,
      profile: {
        detectedKind: profile.detectedKind,
        warnings: profile.warnings,
        columns: profile.columns.map((column) => ({
          name: column.name,
          fillRate: column.fillRate,
          inferredType: column.inferredType,
          suggestedRole: column.suggestedRole,
          examples: column.examples,
        })),
      },
      updatedAt: now,
    };
    if (!activeImportId) {
      importPayload.createdAt = now;
    }
    try {
      await db.transact(db.tx.customDataImports[importId].update(importPayload));
      setActiveImportId(importId);
      setSaveStatus("saved");
      return importId;
    } catch (error) {
      setSaveStatus("error");
      setSaveError(error instanceof Error ? error.message : "Unable to save this import draft.");
      return null;
    }
  };

  const generateTransformPreview = async () => {
    if (!selectedFile || !importRecipe) return;
    setTransformStatus("running");
    setTransformMode("sample");
    setTransformProgress(null);
    setTransformError(null);
    try {
      const nextPreview = await previewCsvTransformFile(selectedFile, {
        datasetName: importRecipe.datasetName,
        roles: importRecipe.roles,
        aggregations: importRecipe.aggregations,
        valueTypes: importRecipe.valueTypes,
        locationLookups: importRecipe.locationLookups,
      });
      setTransformPreview(nextPreview);
      setTransformStatus("ready");
    } catch (error) {
      setTransformStatus("error");
      setTransformError(error instanceof Error ? error.message : "Unable to build transform preview.");
    }
  };

  const generateFullTransform = async () => {
    if (!selectedFile || !importRecipe) return;
    setTransformStatus("running");
    setTransformMode("full");
    setTransformProgress({ rowsProcessed: 0, bytesRead: 0, totalBytes: selectedFile.size });
    setTransformError(null);
    try {
      const nextPreview = await transformCsvFile(
        selectedFile,
        {
          datasetName: importRecipe.datasetName,
          roles: importRecipe.roles,
          aggregations: importRecipe.aggregations,
          valueTypes: importRecipe.valueTypes,
          locationLookups: importRecipe.locationLookups,
        },
        {
          onProgress: setTransformProgress,
        },
      );
      setTransformPreview(nextPreview);
      setTransformStatus("ready");
    } catch (error) {
      setTransformStatus("error");
      setTransformError(error instanceof Error ? error.message : "Unable to process the full file.");
    }
  };

  const publishTransformPreview = async () => {
    if (!transformPreview || !importRecipe || !user?.id || !transformPreview.locationKind) return;
    setPublishStatus("publishing");
    setPublishError(null);
    const importId = await saveImportDraft();
    if (!importId) {
      setPublishStatus("error");
      setPublishError("Save the import draft before publishing preview stats.");
      return;
    }

    const now = Date.now();
    const statIdByName = new Map<string, string>();
    const txs: any[] = [];

    for (const row of transformPreview.statDataRows) {
      if (!statIdByName.has(row.statName)) {
        const customStatId = id();
        statIdByName.set(row.statName, customStatId);
        txs.push(
          db.tx.customDataStats[customStatId].update({
            importId,
            owner: user.id,
            name: row.statName,
            label: row.statName.replace(`${importRecipe.datasetName} - `, ""),
            category: importRecipe.datasetKind,
            type: row.type,
            locationKind: row.boundaryType,
            sourceFile: importRecipe.sourceFile,
            status: "preview",
            createdAt: now,
            updatedAt: now,
          }),
        );
      }

      const customStatId = statIdByName.get(row.statName)!;
      const values = Object.values(row.data).filter((value) => Number.isFinite(value));
      const sum = values.reduce((total, value) => total + value, 0);
      const count = values.length;
      const summaryKey = [user.id, customStatId, row.name, row.parentArea, row.boundaryType, row.date].join("::");
      txs.push(
        db.tx.customDataStatData[id()].update({
          owner: user.id,
          importId,
          customStatId,
          name: row.name,
          parentArea: row.parentArea,
          boundaryType: row.boundaryType,
          date: row.date,
          type: row.type,
          data: row.data,
          sourceFile: importRecipe.sourceFile,
          createdAt: now,
          updatedAt: now,
        }),
        db.tx.customDataStatSummaries[id()].update({
          summaryKey,
          owner: user.id,
          importId,
          customStatId,
          name: row.name,
          parentArea: row.parentArea,
          boundaryType: row.boundaryType,
          date: row.date,
          type: row.type,
          count,
          sum,
          avg: count > 0 ? sum / count : 0,
          min: count > 0 ? Math.min(...values) : 0,
          max: count > 0 ? Math.max(...values) : 0,
          createdAt: now,
          updatedAt: now,
        }),
      );
    }

    txs.push(
      db.tx.customDataImports[importId].update({
        status: "preview_published",
        updatedAt: now,
      }),
    );

    try {
      await deleteExistingCustomPreviewRows(user.id, importId);
      await transactInBatches(txs);
      setPublishStatus("published");
    } catch (error) {
      setPublishStatus("error");
      setPublishError(error instanceof Error ? error.message : "Unable to publish preview stats.");
    }
  };

  const deleteImportDraft = async (importId: string) => {
    setDeletingImportId(importId);
    try {
      if (user?.id) {
        await deleteExistingCustomPreviewRows(user.id, importId);
      }
      await db.transact(db.tx.customDataImports[importId].delete());
    } finally {
      setDeletingImportId(null);
    }
  };

  const nextStep = () => {
    const index = steps.findIndex((entry) => entry.id === step);
    setStep(steps[Math.min(index + 1, steps.length - 1)].id);
  };

  const previousStep = () => {
    const index = steps.findIndex((entry) => entry.id === step);
    setStep(steps[Math.max(index - 1, 0)].id);
  };

  const updateRole = (column: ColumnProfile, role: ColumnRole) => {
    setRoles((current) => {
      const next = { ...current, [column.index]: role };
      if (role === "date") {
        for (const profileColumn of profile?.columns ?? []) {
          if (profileColumn.index !== column.index && next[profileColumn.index] === "date") {
            next[profileColumn.index] = "ignore";
          }
        }
      }
      return next;
    });
    if (role === "measure") {
      setMeasureAggregations((current) => ({
        ...current,
        [column.name]: current[column.name] ?? getDefaultAggregation(column),
      }));
      setMeasureValueTypes((current) => ({
        ...current,
        [column.name]: current[column.name] ?? getDefaultValueType(column),
      }));
    }
    setTransformPreview(null);
    setTransformStatus("idle");
    setTransformProgress(null);
    setSaveStatus("idle");
    setPublishStatus("idle");
    if (role !== "locationSiteId" && roles[column.index] === "locationSiteId") {
      setSiteLookupSample(null);
      setSiteZipLookupText("");
    }
  };

  const updateAggregation = (column: ColumnProfile, aggregation: TransformAggregation) => {
    setMeasureAggregations((current) => ({ ...current, [column.name]: aggregation }));
    setTransformPreview(null);
    setTransformStatus("idle");
    setTransformProgress(null);
    setSaveStatus("idle");
    setPublishStatus("idle");
  };

  const updateValueType = (column: ColumnProfile, valueType: CustomStatValueType) => {
    setMeasureValueTypes((current) => ({ ...current, [column.name]: valueType }));
    setTransformPreview(null);
    setTransformStatus("idle");
    setTransformProgress(null);
    setSaveStatus("idle");
    setPublishStatus("idle");
  };

  const loadSiteLookupSample = async () => {
    const siteColumn = siteColumns[0];
    if (!selectedFile || !siteColumn) return;
    setIsLoadingSiteLookupSample(true);
    try {
      const sample = await collectCsvColumnValuesFile(selectedFile, siteColumn.name);
      setSiteLookupSample(sample);
      if (!siteZipLookupText.trim() && sample.values.length > 0) {
        setSiteZipLookupText(sample.values.map((value) => `${value},`).join("\n"));
      }
    } finally {
      setIsLoadingSiteLookupSample(false);
    }
  };

  const updateSiteZipLookupText = (value: string) => {
    setSiteZipLookupText(value);
    setTransformPreview(null);
    setTransformStatus("idle");
    setTransformProgress(null);
    setSaveStatus("idle");
    setPublishStatus("idle");
  };

  const transformProgressPercent =
    transformProgress && transformProgress.totalBytes > 0
      ? Math.min(100, Math.round((transformProgress.bytesRead / transformProgress.totalBytes) * 100))
      : 0;
  const displayedStatDataRows = transformPreview?.statDataRows.slice(0, STAT_DATA_PREVIEW_LIMIT) ?? [];

  return (
    <div className="mx-auto max-w-6xl p-6">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Data Imports</h1>
        <p className="mt-2 max-w-3xl text-sm text-slate-600 dark:text-slate-400">
          Upload custom files, map columns to the app's area/stat model, and prepare the data for map,
          sidebar, and report views.
        </p>
      </div>

      <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-900">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              <DocumentArrowUpIcon className="h-4 w-4" />
              Custom data wizard
            </div>
            <h2 className="mt-2 text-xl font-semibold text-slate-950 dark:text-white">
              Profile and map a CSV upload
            </h2>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {steps.map((entry) => {
              const Icon = entry.icon;
              const active = entry.id === step;
              const disabled = entry.id !== "upload" && !profile;
              return (
                <button
                  key={entry.id}
                  type="button"
                  disabled={disabled}
                  onClick={() => setStep(entry.id)}
                  className={`flex items-center justify-center gap-2 rounded-md border px-3 py-2 text-sm font-medium ${
                    active
                      ? "border-blue-500 bg-blue-50 text-blue-700 dark:border-blue-400 dark:bg-blue-950 dark:text-blue-200"
                      : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
                  }`}
                >
                  <Icon className="h-4 w-4" />
                  {entry.label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="mt-6 border-t border-slate-200 pt-5 dark:border-slate-700">
          {step === "upload" && (
            <div className="grid gap-5 lg:grid-cols-[minmax(0,1.1fr)_minmax(320px,0.9fr)]">
              <div className="rounded-md border border-dashed border-slate-300 bg-slate-50 p-6 dark:border-slate-700 dark:bg-slate-950">
                <label className="flex cursor-pointer flex-col items-center justify-center gap-3 text-center">
                  <DocumentArrowUpIcon className="h-10 w-10 text-blue-600 dark:text-blue-300" />
                  <span className="text-base font-semibold text-slate-900 dark:text-white">
                    Choose a CSV file
                  </span>
                  <span className="text-sm text-slate-600 dark:text-slate-400">
                    The profiler samples the first {formatBytes(2_000_000)} and keeps the browser responsive.
                  </span>
                  <input type="file" accept=".csv,text/csv" className="sr-only" onChange={handleFileChange} />
                  <span className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700">
                    Select file
                  </span>
                </label>
                {isProfiling && (
                  <div className="mt-4 text-center text-sm text-slate-600 dark:text-slate-400">
                    Profiling sample...
                  </div>
                )}
                {profileError && (
                  <div className="mt-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
                    {profileError}
                  </div>
                )}
              </div>

              <div className="rounded-md border border-slate-200 p-4 dark:border-slate-700">
                <h3 className="font-semibold text-slate-900 dark:text-white">Formats seen in Data Examples</h3>
                <ul className="mt-3 space-y-3 text-sm text-slate-600 dark:text-slate-400">
                  <li>
                    <span className="font-medium text-slate-800 dark:text-slate-200">Attendance rows:</span>{" "}
                    person/site IDs, present/absent flags, dates, and minutes.
                  </li>
                  <li>
                    <span className="font-medium text-slate-800 dark:text-slate-200">Participant rows:</span>{" "}
                    IDs, names, grades, demographics, school/site fields, and ZIP/address fields.
                  </li>
                  <li>
                    <span className="font-medium text-slate-800 dark:text-slate-200">Survey rows:</span>{" "}
                    site/person IDs, survey dates, pre/post labels, and many wide question columns.
                  </li>
                </ul>
              </div>
            </div>
          )}

          {step === "columns" && profile && (
            <div className="space-y-5">
              <div className="grid gap-3 md:grid-cols-4">
                <div className="rounded-md bg-slate-50 p-4 dark:bg-slate-950">
                  <div className="text-xs font-medium uppercase text-slate-500 dark:text-slate-400">File</div>
                  <div className="mt-1 truncate font-semibold text-slate-900 dark:text-white">{profile.fileName}</div>
                  <div className="text-xs text-slate-500 dark:text-slate-400">{formatBytes(profile.sizeBytes)}</div>
                </div>
                <div className="rounded-md bg-slate-50 p-4 dark:bg-slate-950">
                  <div className="text-xs font-medium uppercase text-slate-500 dark:text-slate-400">Sample</div>
                  <div className="mt-1 font-semibold text-slate-900 dark:text-white">{profile.sampledRows.toLocaleString()} rows</div>
                  <div className="text-xs text-slate-500 dark:text-slate-400">{profile.columnCount} columns</div>
                </div>
                <div className="rounded-md bg-slate-50 p-4 dark:bg-slate-950">
                  <div className="text-xs font-medium uppercase text-slate-500 dark:text-slate-400">Detected</div>
                  <div className="mt-1 font-semibold text-slate-900 dark:text-white">{kindLabels[profile.detectedKind]}</div>
                  <div className="text-xs text-slate-500 dark:text-slate-400">Editable in mapping</div>
                </div>
                <div className="rounded-md bg-slate-50 p-4 dark:bg-slate-950">
                  <div className="text-xs font-medium uppercase text-slate-500 dark:text-slate-400">Suggested measures</div>
                  <div className="mt-1 font-semibold text-slate-900 dark:text-white">
                    {profile.columns.filter((column) => column.suggestedRole === "measure").length}
                  </div>
                  <div className="text-xs text-slate-500 dark:text-slate-400">Review before import</div>
                </div>
              </div>

              {profile.warnings.length > 0 && (
                <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
                  {profile.warnings.map((warning) => (
                    <div key={warning} className="flex gap-2">
                      <ExclamationTriangleIcon className="mt-0.5 h-4 w-4 flex-none" />
                      <span>{warning}</span>
                    </div>
                  ))}
                </div>
              )}

              <ColumnTable
                columns={displayedColumns}
                roles={roles}
                onRoleChange={updateRole}
                showRoleSelect={false}
              />
              {sortedColumns.length > displayedColumns.length && (
                <button
                  type="button"
                  onClick={() => setShowAllColumns(true)}
                  className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                >
                  Show all {sortedColumns.length} columns
                </button>
              )}
            </div>
          )}

          {step === "mapping" && profile && (
            <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
              <div className="space-y-4">
                <div className="grid gap-3 md:grid-cols-2">
                  <label className="block">
                    <span className="text-sm font-medium text-slate-700 dark:text-slate-200">Dataset name</span>
                    <input
                      value={datasetName}
                      onChange={(event) => setDatasetName(event.target.value)}
                      className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                    />
                  </label>
                  <label className="block">
                    <span className="text-sm font-medium text-slate-700 dark:text-slate-200">Dataset type</span>
                    <select
                      value={datasetKind}
                      onChange={(event) => setDatasetKind(event.target.value as CustomDataKind)}
                      className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                    >
                      {Object.entries(kindLabels).map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>

                <ColumnTable columns={displayedColumns} roles={roles} onRoleChange={updateRole} showRoleSelect />
                {sortedColumns.length > displayedColumns.length && (
                  <button
                    type="button"
                    onClick={() => setShowAllColumns(true)}
                    className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                  >
                    Show all {sortedColumns.length} columns
                  </button>
                )}
              </div>

              <div className="rounded-md border border-slate-200 p-4 dark:border-slate-700">
                <h3 className="font-semibold text-slate-900 dark:text-white">Mapping status</h3>
                <div className="mt-3 space-y-2 text-sm">
                  {mappingIssues.length === 0 ? (
                    <div className="flex gap-2 rounded-md bg-emerald-50 p-3 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-200">
                      <CheckCircleIcon className="h-5 w-5 flex-none" />
                      Ready to preview the import recipe.
                    </div>
                  ) : (
                    mappingIssues.map((issue) => (
                      <div
                        key={issue}
                        className="flex gap-2 rounded-md bg-amber-50 p-3 text-amber-800 dark:bg-amber-950 dark:text-amber-200"
                      >
                        <ExclamationTriangleIcon className="h-5 w-5 flex-none" />
                        {issue}
                      </div>
                    ))
                  )}
                </div>

                <div className="mt-4 space-y-3 text-sm text-slate-600 dark:text-slate-400">
                  <MappingCount label="Measures" value={measureColumns.length} />
                  <MappingCount label="Categories" value={categoryColumns.length} />
                  <MappingCount label="Dates" value={dateColumns.length} />
                  <MappingCount label="Entity IDs" value={idColumns.length} />
                  <MappingCount label="Location fields" value={zipColumns.length + siteColumns.length + addressColumns.length + cityColumns.length + stateColumns.length} />
                </div>

                {needsSiteZipLookup && (
                  <div className="mt-5 border-t border-slate-200 pt-4 dark:border-slate-700">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <h4 className="text-sm font-semibold text-slate-900 dark:text-white">Site ZIP lookup</h4>
                        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                          Paste one school ID and ZIP per line. {siteZipLookupCount.toLocaleString()} mapped.
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={loadSiteLookupSample}
                        disabled={isLoadingSiteLookupSample || !selectedFile}
                        className="rounded-md border border-slate-300 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                      >
                        {isLoadingSiteLookupSample ? "Loading..." : "Sample IDs"}
                      </button>
                    </div>
                    <textarea
                      value={siteZipLookupText}
                      onChange={(event) => updateSiteZipLookupText(event.target.value)}
                      placeholder={"650,74106\n200,74120"}
                      className="mt-3 h-36 w-full resize-y rounded-md border border-slate-300 bg-white px-3 py-2 font-mono text-xs text-slate-900 focus:border-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                    />
                    <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                      The attendance file has school IDs, but the map needs ZIPs. Rows with unmapped school IDs are skipped from ZIP-based stats.
                    </p>
                    {siteLookupSample && (
                      <div className="mt-3 rounded-md bg-slate-50 p-3 text-xs text-slate-600 dark:bg-slate-950 dark:text-slate-400">
                        <div className="font-medium text-slate-800 dark:text-slate-200">
                          {siteLookupSample.values.length.toLocaleString()} sampled IDs from {siteLookupSample.columnName}
                        </div>
                        {unresolvedSampleSiteIds.length > 0 ? (
                          <div className="mt-2">
                            These sampled school IDs do not have ZIPs yet: {unresolvedSampleSiteIds.slice(0, 12).join(", ")}
                            {unresolvedSampleSiteIds.length > 12 ? ` +${unresolvedSampleSiteIds.length - 12}` : ""}
                          </div>
                        ) : (
                          <div className="mt-2 text-emerald-700 dark:text-emerald-300">Sampled site IDs have ZIP mappings.</div>
                        )}
                        {siteLookupSample.truncated && (
                          <div className="mt-2">This list is capped at 200 sampled IDs; full-file processing may find more unmapped school IDs.</div>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {measureColumns.length > 0 && (
                  <div className="mt-5 border-t border-slate-200 pt-4 dark:border-slate-700">
                    <h4 className="text-sm font-semibold text-slate-900 dark:text-white">Measure setup</h4>
                    <div className="mt-3 space-y-3">
                      {measureColumns.slice(0, 12).map((column) => (
                        <div key={column.name} className="grid gap-2 sm:grid-cols-2">
                          <div className="sm:col-span-2 truncate text-xs font-medium text-slate-600 dark:text-slate-300">
                            {column.name}
                          </div>
                          <label className="block">
                            <span className="block text-[11px] uppercase tracking-wide text-slate-500 dark:text-slate-400">
                              Aggregation
                            </span>
                            <select
                              value={effectiveMeasureAggregations[column.name] ?? getDefaultAggregation(column)}
                              onChange={(event) =>
                                updateAggregation(column, event.target.value as TransformAggregation)
                              }
                              className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2 py-1 text-sm text-slate-900 focus:border-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                            >
                              {aggregationOptions.map((option) => (
                                <option key={option} value={option}>
                                  {aggregationLabels[option]}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label className="block">
                            <span className="block text-[11px] uppercase tracking-wide text-slate-500 dark:text-slate-400">
                              Display as
                            </span>
                            <select
                              value={effectiveMeasureValueTypes[column.name] ?? getDefaultValueType(column)}
                              onChange={(event) =>
                                updateValueType(column, event.target.value as CustomStatValueType)
                              }
                              className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2 py-1 text-sm text-slate-900 focus:border-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                            >
                              {valueTypeOptions.map((option) => (
                                <option key={option} value={option}>
                                  {valueTypeLabels[option]}
                                </option>
                              ))}
                            </select>
                          </label>
                        </div>
                      ))}
                    </div>
                    {measureColumns.length > 12 && (
                      <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                        Showing the first 12 mapped measures. Use fewer measure columns for this preview slice.
                      </p>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

          {step === "preview" && profile && importRecipe && (
            <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
              <div className="rounded-md border border-slate-200 p-4 dark:border-slate-700">
                <h3 className="font-semibold text-slate-900 dark:text-white">Import recipe</h3>
                <pre className="mt-3 max-h-[460px] overflow-auto rounded-md bg-slate-950 p-4 text-xs text-slate-100">
                  {JSON.stringify(importRecipe, null, 2)}
                </pre>
              </div>
              <div className="space-y-4">
                <div className="rounded-md border border-slate-200 p-4 dark:border-slate-700">
                  <h3 className="font-semibold text-slate-900 dark:text-white">Next integration slice</h3>
                  <ul className="mt-3 space-y-2 text-sm text-slate-600 dark:text-slate-400">
                    <li>Persist this recipe as a user-owned import dataset.</li>
                    <li>Transform measures into private stats and statData rows.</li>
                    <li>Resolve site/school IDs or addresses into ZIP/area keys before map rendering.</li>
                    <li>Expose imported stats in sidebar charts and report highlights.</li>
                  </ul>
                </div>
                {hasBlockingIssue && (
                  <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
                    Resolve the required mapping items before persistence is enabled.
                  </div>
                )}
                <button
                  type="button"
                  onClick={saveImportDraft}
                  disabled={hasBlockingIssue || saveStatus === "saving" || !user?.id}
                  className="w-full rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {saveStatus === "saving" ? "Saving..." : "Save import draft"}
                </button>
                {!user?.id && !authLoading && (
                  <p className="text-sm text-amber-700 dark:text-amber-300">
                    Sign-in or guest auth must finish before drafts can be saved.
                  </p>
                )}
                {saveStatus === "saved" && (
                  <p className="text-sm text-emerald-700 dark:text-emerald-300">
                    Draft saved. It is private to your account.
                  </p>
                )}
                {saveStatus === "error" && saveError && (
                  <p className="text-sm text-red-700 dark:text-red-300">{saveError}</p>
                )}
              </div>
            </div>
          )}

          <div className="mt-6 flex items-center justify-between border-t border-slate-200 pt-4 dark:border-slate-700">
            <button
              type="button"
              onClick={previousStep}
              disabled={step === "upload"}
              className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              Back
            </button>
            <button
              type="button"
              onClick={nextStep}
              disabled={!profile || step === "preview"}
              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Continue
            </button>
          </div>
        </div>
      </section>

      {step === "preview" && profile && importRecipe && (
        <section className="mt-8 rounded-lg border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h2 className="text-xl font-semibold text-slate-900 dark:text-white">Transform Preview</h2>
              <p className="mt-1 max-w-3xl text-sm text-slate-600 dark:text-slate-400">
                Generate a fast sample first, then process the full file when the mapping looks right. Nothing is written until you publish.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={generateTransformPreview}
                disabled={hasBlockingIssue || transformStatus === "running" || !selectedFile}
                className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                {transformStatus === "running" && transformMode === "sample" ? "Generating..." : "Generate sample"}
              </button>
              <button
                type="button"
                onClick={generateFullTransform}
                disabled={hasBlockingIssue || transformStatus === "running" || !selectedFile}
                className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-200"
              >
                {transformStatus === "running" && transformMode === "full" ? "Processing..." : "Process full file"}
              </button>
            </div>
          </div>

          {transformStatus === "running" && transformMode === "full" && transformProgress && (
            <div className="mt-4 rounded-md border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800 dark:border-blue-900 dark:bg-blue-950 dark:text-blue-200">
              <div className="flex items-center justify-between gap-3">
                <span>{transformProgress.rowsProcessed.toLocaleString()} rows processed</span>
                <span>
                  {formatBytes(transformProgress.bytesRead)} / {formatBytes(transformProgress.totalBytes)} ({transformProgressPercent}%)
                </span>
              </div>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-blue-100 dark:bg-blue-900">
                <div className="h-full bg-blue-600" style={{ width: `${transformProgressPercent}%` }} />
              </div>
            </div>
          )}

          {transformStatus === "error" && transformError && (
            <div className="mt-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
              {transformError}
            </div>
          )}

          {transformPreview ? (
            <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
              <div className="space-y-4">
                <div className="grid gap-3 md:grid-cols-4">
                  <PreviewMetric label={transformPreview.isComplete ? "Rows processed" : "Rows sampled"} value={transformPreview.sampledRows.toLocaleString()} />
                  <PreviewMetric label="Rows skipped" value={transformPreview.skippedRows.toLocaleString()} />
                  <PreviewMetric label="Location" value={transformPreview.locationKind ?? "None"} />
                  <PreviewMetric label="Measures" value={transformPreview.measureCount.toLocaleString()} />
                </div>

                {transformPreview.warnings.length > 0 && (
                  <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
                    {transformPreview.warnings.map((warning) => (
                      <div key={warning} className="flex gap-2">
                        <ExclamationTriangleIcon className="mt-0.5 h-4 w-4 flex-none" />
                        <span>{warning}</span>
                      </div>
                    ))}
                  </div>
                )}

                {transformPreview.unresolvedLocationValues.length > 0 && (
                  <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
                    <div className="font-medium">Add ZIPs for these school IDs, then regenerate the transform.</div>
                    <p className="mt-1">
                      Showing up to 200 unmapped IDs found during this run. Paste these into the Site ZIP lookup on the Mapping step and add ZIPs after each comma.
                    </p>
                    <pre className="mt-2 max-h-40 overflow-auto rounded bg-amber-100/70 p-2 font-mono text-xs dark:bg-amber-900/40">
                      {transformPreview.unresolvedLocationValues.map((value) => `${value},`).join("\n")}
                    </pre>
                  </div>
                )}

                <div className="overflow-hidden rounded-md border border-slate-200 dark:border-slate-700">
                  <table className="min-w-full divide-y divide-slate-200 text-sm dark:divide-slate-700">
                    <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500 dark:bg-slate-950 dark:text-slate-400">
                      <tr>
                        <th className="px-3 py-2 font-medium">Measure</th>
                        <th className="px-3 py-2 font-medium">Aggregation</th>
                        <th className="px-3 py-2 font-medium">Areas</th>
                        <th className="px-3 py-2 font-medium">Dates</th>
                        <th className="px-3 py-2 font-medium">Sample values</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 bg-white dark:divide-slate-800 dark:bg-slate-900">
                      {transformPreview.measures.map((measure) => (
                        <tr key={measure.measureName}>
                          <td className="max-w-[260px] px-3 py-2 align-top font-medium text-slate-900 dark:text-white">
                            {measure.measureName}
                          </td>
                          <td className="whitespace-nowrap px-3 py-2 align-top text-slate-600 dark:text-slate-300">
                            {measure.aggregation}
                          </td>
                          <td className="whitespace-nowrap px-3 py-2 align-top text-slate-600 dark:text-slate-300">
                            {measure.areaCount}
                          </td>
                          <td className="whitespace-nowrap px-3 py-2 align-top text-slate-600 dark:text-slate-300">
                            {measure.dateCount}
                          </td>
                          <td className="px-3 py-2 align-top text-slate-600 dark:text-slate-300">
                            {measure.sampleAreas
                              .map((sample) => `${sample.area} ${sample.date}: ${sample.value.toFixed(2)}`)
                              .join(", ")}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="rounded-md border border-slate-200 p-4 dark:border-slate-700">
                <h3 className="font-semibold text-slate-900 dark:text-white">statData-shaped rows</h3>
                <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
                  Showing {displayedStatDataRows.length.toLocaleString()} of {transformPreview.statDataRows.length.toLocaleString()} rows. Publish writes the full current transform as private preview stats.
                </p>
                <pre className="mt-3 max-h-[520px] overflow-auto rounded-md bg-slate-950 p-4 text-xs text-slate-100">
                  {JSON.stringify(displayedStatDataRows, null, 2)}
                </pre>
                <button
                  type="button"
                  onClick={publishTransformPreview}
                  disabled={
                    publishStatus === "publishing" ||
                    publishStatus === "published" ||
                    transformPreview.statDataRows.length === 0 ||
                    !user?.id
                  }
                  className="mt-4 w-full rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {publishStatus === "publishing"
                    ? "Publishing..."
                    : publishStatus === "published"
                      ? "Preview stats published"
                      : "Publish private preview stats"}
                </button>
                {publishStatus === "published" && (
                  <p className="mt-2 text-sm text-emerald-700 dark:text-emerald-300">
                    Preview stats were written to private custom-data tables.
                  </p>
                )}
                {publishStatus === "error" && publishError && (
                  <p className="mt-2 text-sm text-red-700 dark:text-red-300">{publishError}</p>
                )}
              </div>
            </div>
          ) : (
            <div className="mt-4 rounded-md bg-slate-50 p-4 text-sm text-slate-600 dark:bg-slate-950 dark:text-slate-400">
              No transform preview generated yet.
            </div>
          )}
        </section>
      )}

      <section className="mt-8 rounded-lg border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-xl font-semibold text-slate-900 dark:text-white">Saved Custom Imports</h2>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
              Private import recipes and preview stats saved from the wizard.
            </p>
          </div>
          <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">
            {savedImports.length} imports
          </span>
        </div>

        <div className="mt-4">
          {importsLoading || authLoading ? (
            <div className="rounded-md bg-slate-50 p-4 text-sm text-slate-600 dark:bg-slate-950 dark:text-slate-400">
              Loading saved imports...
            </div>
          ) : importsError ? (
            <div className="rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
              Saved imports are unavailable until the customDataImports schema and permissions are pushed.
            </div>
          ) : savedImports.length === 0 ? (
            <div className="rounded-md bg-slate-50 p-4 text-sm text-slate-600 dark:bg-slate-950 dark:text-slate-400">
              No saved custom import drafts yet.
            </div>
          ) : (
            <div className="overflow-hidden rounded-md border border-slate-200 dark:border-slate-700">
              <table className="min-w-full divide-y divide-slate-200 text-sm dark:divide-slate-700">
                <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500 dark:bg-slate-950 dark:text-slate-400">
                  <tr>
                    <th className="px-3 py-2 font-medium">Name</th>
                    <th className="px-3 py-2 font-medium">Type</th>
                    <th className="px-3 py-2 font-medium">Measures</th>
                    <th className="px-3 py-2 font-medium">Updated</th>
                    <th className="px-3 py-2 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white dark:divide-slate-800 dark:bg-slate-900">
                  {savedImports.map((row) => (
                    <tr key={row.id}>
                      <td className="px-3 py-2 align-top">
                        <div className="font-medium text-slate-900 dark:text-white">{row.name || "Untitled import"}</div>
                        <div className="text-xs text-slate-500 dark:text-slate-400">{row.sourceFile || "Unknown file"}</div>
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 align-top text-slate-600 dark:text-slate-300">
                        {kindLabels[(row.kind as CustomDataKind) || "generic"] ?? row.kind ?? "Custom"}
                      </td>
                      <td className="px-3 py-2 align-top text-slate-600 dark:text-slate-300">
                        {row.recipe?.measures?.length ? row.recipe.measures.slice(0, 3).join(", ") : "No measures"}
                        {(row.recipe?.measures?.length ?? 0) > 3 ? ` +${(row.recipe?.measures?.length ?? 0) - 3}` : ""}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 align-top text-slate-600 dark:text-slate-300">
                        {row.updatedAt ? new Date(row.updatedAt).toLocaleString() : "Unknown"}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 align-top">
                        <button
                          type="button"
                          onClick={() => deleteImportDraft(row.id)}
                          disabled={deletingImportId === row.id}
                          className="inline-flex items-center gap-1 rounded-md border border-slate-300 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                          title="Delete import and preview stats"
                        >
                          <TrashIcon className="h-3.5 w-3.5" />
                          Delete
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>

      <section className="mt-8">
        <div className="mb-4">
          <h2 className="text-xl font-semibold text-slate-900 dark:text-white">Admin Import Commands</h2>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
            Existing terminal tools for Neighborhood Explorer and Census-backed imports.
          </p>
        </div>

        <div className="space-y-4">
          {commands.map((cmd, index) => (
            <div
              key={index}
              className="rounded-lg border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900"
            >
              <div className="mb-3 flex items-start justify-between gap-4">
                <div>
                  <h3 className="font-semibold text-slate-900 dark:text-white">{cmd.title}</h3>
                  <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">{cmd.description}</p>
                </div>
              </div>

              <div className="relative">
                <pre className="overflow-x-auto rounded-md bg-slate-50 p-3 text-sm text-slate-800 dark:bg-slate-800 dark:text-slate-200">
                  <code>{cmd.command}</code>
                </pre>
                <button
                  onClick={() => copyToClipboard(cmd.command, index)}
                  className="absolute right-2 top-2 flex items-center gap-1 rounded-md bg-white px-2 py-1 text-xs text-slate-600 shadow-sm hover:bg-slate-100 dark:bg-slate-700 dark:text-slate-300 dark:hover:bg-slate-600"
                  title="Copy to clipboard"
                >
                  <ClipboardDocumentIcon className="h-3.5 w-3.5" />
                  {copiedIndex === index ? "Copied" : "Copy"}
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>

      <div className="mt-8 rounded-lg border border-blue-200 bg-blue-50 p-5 dark:border-blue-900 dark:bg-blue-950">
        <h3 className="font-semibold text-blue-900 dark:text-blue-100">Documentation</h3>
        <p className="mt-2 text-sm text-blue-800 dark:text-blue-200">For complete documentation, see:</p>
        <ul className="mt-2 space-y-1 text-sm text-blue-800 dark:text-blue-200">
          <li>
            <code className="rounded bg-blue-100 px-1 py-0.5 dark:bg-blue-900">ETL_USER_GUIDE.md</code> -
            Complete user guide with step-by-step instructions
          </li>
          <li>
            <code className="rounded bg-blue-100 px-1 py-0.5 dark:bg-blue-900">
              TROUBLESHOOTING_SYNTHETIC_DATA.md
            </code>{" "}
            - Fix synthetic data issues
          </li>
          <li>
            <code className="rounded bg-blue-100 px-1 py-0.5 dark:bg-blue-900">ETL_terminal_tools.md</code> -
            Technical reference
          </li>
        </ul>
      </div>

      <div className="mt-6 rounded-lg border border-amber-200 bg-amber-50 p-5 dark:border-amber-900 dark:bg-amber-950">
        <h3 className="font-semibold text-amber-900 dark:text-amber-100">Important Notes</h3>
        <ul className="mt-2 space-y-2 text-sm text-amber-800 dark:text-amber-200">
          <li>
            <strong>First time setup?</strong> Run{" "}
            <code className="rounded bg-amber-100 px-1 py-0.5 dark:bg-amber-900">npm run ne:clean:synthetic</code>{" "}
            to remove demo data before importing real data.
          </li>
          <li>
            <strong>All imports are idempotent</strong> - safe to run multiple times and will not create duplicates.
          </li>
          <li>
            <strong>Test with dry runs</strong> - Add{" "}
            <code className="rounded bg-amber-100 px-1 py-0.5 dark:bg-amber-900">:dry</code> to command names to
            preview changes.
          </li>
          <li>
            <strong>Environment required</strong> - Ensure your{" "}
            <code className="rounded bg-amber-100 px-1 py-0.5 dark:bg-amber-900">.env</code> file has{" "}
            <code className="rounded bg-amber-100 px-1 py-0.5 dark:bg-amber-900">VITE_INSTANT_APP_ID</code> and{" "}
            <code className="rounded bg-amber-100 px-1 py-0.5 dark:bg-amber-900">INSTANT_APP_ADMIN_TOKEN</code>.
          </li>
        </ul>
      </div>
    </div>
  );
};

const MappingCount = ({ label, value }: { label: string; value: number }) => (
  <div className="flex items-center justify-between border-b border-slate-100 pb-2 last:border-0 dark:border-slate-800">
    <span>{label}</span>
    <span className="font-semibold text-slate-900 dark:text-white">{value}</span>
  </div>
);

const PreviewMetric = ({ label, value }: { label: string; value: string }) => (
  <div className="rounded-md bg-slate-50 p-4 dark:bg-slate-950">
    <div className="text-xs font-medium uppercase text-slate-500 dark:text-slate-400">{label}</div>
    <div className="mt-1 font-semibold text-slate-900 dark:text-white">{value}</div>
  </div>
);

const ColumnTable = ({
  columns,
  roles,
  onRoleChange,
  showRoleSelect,
}: {
  columns: ColumnProfile[];
  roles: RoleMap;
  onRoleChange: (column: ColumnProfile, role: ColumnRole) => void;
  showRoleSelect: boolean;
}) => (
  <div className="overflow-hidden rounded-md border border-slate-200 dark:border-slate-700">
    <div className="max-h-[520px] overflow-auto">
      <table className="min-w-full divide-y divide-slate-200 text-sm dark:divide-slate-700">
        <thead className="sticky top-0 bg-slate-50 text-left text-xs uppercase text-slate-500 dark:bg-slate-950 dark:text-slate-400">
          <tr>
            <th className="px-3 py-2 font-medium">Column</th>
            <th className="px-3 py-2 font-medium">Fill</th>
            <th className="px-3 py-2 font-medium">Type</th>
            <th className="px-3 py-2 font-medium">Role</th>
            <th className="px-3 py-2 font-medium">Examples</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 bg-white dark:divide-slate-800 dark:bg-slate-900">
          {columns.map((column) => {
            const role = roles[column.index] ?? column.suggestedRole;
            return (
              <tr key={`${column.index}-${column.name}`}>
                <td className="max-w-[240px] px-3 py-2 align-top">
                  <div className="font-medium text-slate-900 dark:text-white">{column.name}</div>
                  <div className="text-xs text-slate-500 dark:text-slate-400">#{column.index + 1}</div>
                </td>
                <td className="whitespace-nowrap px-3 py-2 align-top text-slate-600 dark:text-slate-300">
                  {Math.round(column.fillRate * 100)}%
                </td>
                <td className="whitespace-nowrap px-3 py-2 align-top text-slate-600 dark:text-slate-300">
                  {column.inferredType}
                </td>
                <td className="min-w-[180px] px-3 py-2 align-top">
                  {showRoleSelect ? (
                    <select
                      value={role}
                      onChange={(event) => onRoleChange(column, event.target.value as ColumnRole)}
                      className="w-full rounded-md border border-slate-300 bg-white px-2 py-1 text-sm text-slate-900 focus:border-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                    >
                      {roleOptions.map((option) => (
                        <option key={option} value={option}>
                          {roleLabels[option]}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span className={`inline-flex rounded-full px-2 py-1 text-xs font-medium ${roleBadgeClass(role)}`}>
                      {roleLabels[role]}
                    </span>
                  )}
                </td>
                <td className="min-w-[260px] px-3 py-2 align-top text-slate-600 dark:text-slate-300">
                  {column.examples.length > 0 ? column.examples.join(", ") : "No sampled values"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  </div>
);

export default DataScreen;
