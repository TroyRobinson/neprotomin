import { useMemo, useState, useCallback, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { id as createId, lookup } from "@instantdb/react";
import { db } from "../../lib/reactDb";
import {
  buildRootStatDataRowKey,
  buildStatDataSummaryKey,
  computeDerivedValues,
  computeSummaryFromData,
  normalizeDataMap,
  type RootStatDataRow,
} from "../../lib/derivedStats";
import type { Category } from "../../types/organization";
import { UNDEFINED_STAT_ATTRIBUTE } from "../../types/stat";
import type { ImportQueueItem, ImportRelationship } from "../types/censusImport";
import { CustomSelect } from "./CustomSelect";
import { useCensusImportQueue } from "../hooks/useCensusImportQueue";
import { GroupSearchInput, HighlightMatch } from "./AdminCensusGroupSearchInput";
import {
  DEFAULT_CENSUS_DATASET,
  filterStatsBySearch,
  getConceptDisplay,
  getPendingSelections,
  getPredicateTypeSummary,
  getRelationshipConfigError,
  getYearRange,
  inferDatasetForGroup,
  inferUniverseFromConcept,
  looksLikeGroupId,
  type CensusPreviewMeta,
  type CensusVariablePreview,
  type StatItem,
  type VariableSelection,
} from "./adminNewStatModalUtils";

const MAX_DERIVED_TX_BATCH = 10;

export interface NewStatModalProps {
  isOpen: boolean;
  onClose: () => void;
  onImported: (statIds: string[]) => void;
  categoryOptions: Array<{ value: string; label: string }>;
  user?: { id?: string | null } | null;
  existingCensusStats: Map<
    string,
    { id: string; name: string; label: string | null | undefined }
  >;
  availableStats: StatItem[];
}

export const NewStatModal = ({
  isOpen,
  onClose,
  onImported,
  categoryOptions,
  user,
  existingCensusStats,
  availableStats,
}: NewStatModalProps) => {
  const modalRef = useRef<HTMLDivElement>(null);
  const groupInputRef = useRef<HTMLInputElement>(null);
  const [runGroupSearch, setRunGroupSearch] = useState<(() => void) | null>(null);
  const [dataset, setDataset] = useState(DEFAULT_CENSUS_DATASET);
  const [group, setGroup] = useState("");
  const [year, setYear] = useState(2023);
  const [limit, setLimit] = useState(50);
  const [category, setCategory] = useState<Category | null>(null);
  const [step, setStep] = useState<1 | 2>(1);
  const [resultsFilter, setResultsFilter] = useState("");

  const [isPreviewLoading, setIsPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewTotal, setPreviewTotal] = useState(0);
  const [variables, setVariables] = useState<CensusVariablePreview[]>([]);
  const [previewMeta, setPreviewMeta] = useState<CensusPreviewMeta | null>(null);

  const filteredVariables = useMemo(() => {
    if (!resultsFilter.trim()) return variables;
    const terms = resultsFilter.toLowerCase().split(/\s+/).filter(Boolean);
    return variables.filter((v) => {
      const name = v.statName.toLowerCase();
      return terms.every((term) => name.includes(term));
    });
  }, [variables, resultsFilter]);
  const [selection, setSelection] = useState<Record<string, VariableSelection>>({});
  const {
    queueItems,
    setQueueItems,
    isRunning,
    setIsRunning,
    setCurrentItemId,
    setCurrentYearProcessing,
    setDerivedStatusLabel,
    openDropdown,
  } = useCensusImportQueue();
  const queueItemsRef = useRef<ImportQueueItem[]>(queueItems);
  const isProcessingRef = useRef(false);
  const [lastSubmittedGroup, setLastSubmittedGroup] = useState<string>(""); // Track last previewed group
  const [isParentSearchOpen, setIsParentSearchOpen] = useState(false);
  const [parentSearch, setParentSearch] = useState("");
  const [manualParent, setManualParent] = useState<{ id: string; name: string; label: string | null; category?: string } | null>(null);
  const [addPercent, setAddPercent] = useState(false);
  const [addChange, setAddChange] = useState(true);
  const [_hasManuallyToggledChange, setHasManuallyToggledChange] = useState(false);
  const [percentDenominatorId, setPercentDenominatorId] = useState<string>("");
  const [isDenominatorSearchOpen, setIsDenominatorSearchOpen] = useState(false);
  const [denominatorSearch, setDenominatorSearch] = useState("");

  const predicateTypeSummary = useMemo(() => {
    return getPredicateTypeSummary(variables);
  }, [variables]);

  const conceptDisplay = useMemo(() => {
    return getConceptDisplay(variables, previewMeta?.concept);
  }, [previewMeta?.concept, variables]);

  useEffect(() => {
    queueItemsRef.current = queueItems;
  }, [queueItems]);

  const resetModalState = useCallback(
    (shouldFocus: boolean) => {
      setDataset(DEFAULT_CENSUS_DATASET);
      setGroup("");
      setYear(2023);
      setLimit(50);
      setCategory(null);
      setStep(1);
      setIsPreviewLoading(false);
      setPreviewError(null);
      setPreviewTotal(0);
      setVariables([]);
      setPreviewMeta(null);
      setSelection({});
      setLastSubmittedGroup("");
      setRunGroupSearch(null);
      setIsParentSearchOpen(false);
      setParentSearch("");
      setManualParent(null);
      setResultsFilter("");
      setAddPercent(false);
      setAddChange(true);
      setHasManuallyToggledChange(false);
      setPercentDenominatorId("");
      setIsDenominatorSearchOpen(false);
      setDenominatorSearch("");
      if (shouldFocus) {
        setTimeout(() => groupInputRef.current?.focus(), 50);
      }
    },
    [],
  );

  useEffect(() => {
    if (!isOpen) return;
    resetModalState(true);
  }, [isOpen, resetModalState]);

  const getDefaultSelection = useCallback(
    (overrides?: Partial<VariableSelection>): VariableSelection => ({
      selected: false,
      yearEnd: year,
      yearStart: null,
      relationship: "none",
      statAttribute: "",
      lockedImported: false,
      importedStatId: null,
      importedStatLabel: null,
      importedStatName: null,
      ...(overrides ?? {}),
    }),
    [year],
  );

  const mergeQueueItems = useCallback(
    (prevQueue: ImportQueueItem[], items: ImportQueueItem[]) => {
      if (items.length === 0) return prevQueue;
      const existing = new Set(prevQueue.map((item) => item.id));
      const nextItems = items.filter((item) => !existing.has(item.id));
      if (nextItems.length === 0) return prevQueue;
      return isRunning ? [...nextItems, ...prevQueue] : [...prevQueue, ...nextItems];
    },
    [isRunning],
  );

  const clearParentSelections = useCallback(() => {
    setQueueItems((prevQueue) =>
      prevQueue.map((item) =>
        item.relationship === "parent" ? { ...item, relationship: "none" as const } : item,
      ),
    );
    setSelection((prev) => {
      const next = { ...prev };
      for (const [key, value] of Object.entries(prev)) {
        if (value?.relationship === "parent") {
          next[key] = { ...value, relationship: "none" };
        }
      }
      return next;
    });
  }, []);

  const parentSearchResults = useMemo(() => {
    return filterStatsBySearch(availableStats, parentSearch);
  }, [availableStats, parentSearch]);

  const handleSelectManualParent = useCallback(
    (stat: StatItem) => {
      setManualParent({ id: stat.id, name: stat.name, label: stat.label ?? null, category: stat.category });
      clearParentSelections();
      // If the user chooses a manual parent after selecting variables,
      // default existing queued imports to Child so they get linked.
      setQueueItems((prevQueue) =>
        prevQueue.map((item) =>
          item.relationship === "none" || item.relationship == null
            ? { ...item, relationship: "child" as const }
            : item,
        ),
      );
      setSelection((prev) => {
        const next = { ...prev };
        for (const [key, value] of Object.entries(prev)) {
          if (!value?.selected || value.lockedImported) continue;
          if (value.relationship === "none") {
            next[key] = { ...value, relationship: "child" };
          }
        }
        return next;
      });
      setIsParentSearchOpen(false);
    },
    [clearParentSelections],
  );

  const handleClearManualParent = useCallback(() => {
    setManualParent(null);
  }, []);

  const pendingSelections = useMemo(() => {
    return getPendingSelections(variables, selection, year);
  }, [selection, variables, year]);

  const pendingSelectionCount = pendingSelections.length;

  const variableMetaByName = useMemo(() => {
    return new Map(variables.map((variable) => [variable.name, variable]));
  }, [variables]);

  const pendingGroupLabel = useMemo(() => {
    const trimmedLast = lastSubmittedGroup.trim();
    const trimmedGroup = group.trim();
    return trimmedLast || trimmedGroup || "";
  }, [group, lastSubmittedGroup]);

  const previewDataset = previewMeta?.dataset ?? dataset;
  const previewYear = previewMeta?.year ?? year;
  const previewUniverse =
    previewMeta?.universe?.trim() || inferUniverseFromConcept(conceptDisplay.shared) || "";

  const changeOptionDisabled = useMemo(() => {
    if (pendingSelections.length === 0) return true;
    return pendingSelections.some((item) => item.years <= 1);
  }, [pendingSelections]);

  useEffect(() => {
    if (!isOpen) return;
    // We keep addChange as requested by user, it will be disabled by UI
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    if (!addPercent) {
      setPercentDenominatorId("");
      setIsDenominatorSearchOpen(false);
      setDenominatorSearch("");
    }
  }, [addPercent, isOpen]);

  const denominatorStats = useMemo(() => {
    return availableStats.filter((stat) => typeof stat.neId === "string" && stat.neId.startsWith("census:"));
  }, [availableStats]);

  const selectedDenominator = useMemo(() => {
    if (!percentDenominatorId) return null;
    return availableStats.find((s) => s.id === percentDenominatorId) ?? null;
  }, [availableStats, percentDenominatorId]);

  const denominatorSearchResults = useMemo(() => {
    return filterStatsBySearch(denominatorStats, denominatorSearch);
  }, [denominatorSearch, denominatorStats]);

  const handleSelectDenominator = useCallback(
    (stat: StatItem) => {
      setPercentDenominatorId(stat.id);
      setIsDenominatorSearchOpen(false);
    },
    [],
  );

  // Handle click outside to close modal
  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (e: globalThis.MouseEvent) => {
      if (modalRef.current && !modalRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    // Delay to avoid immediate trigger from the click that opened the modal
    const timeout = setTimeout(() => {
      document.addEventListener("mousedown", handleClickOutside);
    }, 0);
    return () => {
      clearTimeout(timeout);
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isOpen, onClose]);

  // Handle ESC key to close modal
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen, onClose]);

  const handlePreview = useCallback(async (groupOverride?: string, suggestedStatIds?: string[] | null) => {
    const trimmedGroup = (groupOverride ?? group).trim();
    if (!trimmedGroup) {
      setPreviewError("Census group is required.");
      return;
    }
    const { dataset: resolvedDataset, changed } = inferDatasetForGroup(trimmedGroup, dataset);
    if (changed) {
      setDataset(resolvedDataset);
    }
    setIsPreviewLoading(true);
    setPreviewError(null);
    try {
      const params = new URLSearchParams({
        dataset: resolvedDataset,
        group: trimmedGroup,
        year: String(year),
        limit: String(limit),
      });
      const response = await fetch(`/api/census-preview?${params.toString()}`);
      const payload = (await response.json().catch(() => null)) as any;
      if (!response.ok || !payload) {
        const baseMessage = "Failed to load Census preview.";
        const apiError = payload && typeof payload.error === "string" ? payload.error : null;
        const details = payload && typeof payload.details === "string" ? payload.details : null;
        const parts: string[] = [];
        parts.push(baseMessage);
        if (apiError && apiError !== baseMessage) parts.push(apiError);
        if (details) parts.push(details);
        setPreviewError(parts.join(" "));
        return;
      }
      const vars = Array.isArray(payload.variables) ? payload.variables : [];
      const total =
        typeof payload.totalVariables === "number" ? payload.totalVariables : vars.length;
      const parsed: CensusVariablePreview[] = vars.map((entry: any) => ({
        name: String(entry.name),
        label: typeof entry.label === "string" ? entry.label : "",
        concept: typeof entry.concept === "string" ? entry.concept : undefined,
        predicateType:
          typeof entry.predicateType === "string" ? entry.predicateType : undefined,
        inferredType:
          typeof entry.inferredType === "string" ? entry.inferredType : "",
        statName:
          typeof entry.statName === "string" ? entry.statName : String(entry.name),
        statLabel:
          typeof entry.statLabel === "string" ? entry.statLabel : undefined,
        zipCount: typeof entry.zipCount === "number" ? entry.zipCount : 0,
        countyCount: typeof entry.countyCount === "number" ? entry.countyCount : 0,
      }));
      setVariables(parsed);
      setPreviewTotal(total);
      setLastSubmittedGroup(trimmedGroup); // Track what was previewed
      setPreviewMeta({
        dataset: typeof payload.dataset === "string" ? payload.dataset : resolvedDataset,
        group: typeof payload.group === "string" ? payload.group : trimmedGroup,
        year: typeof payload.year === "number" ? payload.year : year,
        universe: typeof payload.universe === "string" ? payload.universe : null,
        concept: typeof payload.concept === "string" ? payload.concept : null,
      });

      const defaults: Record<string, VariableSelection> = {};
      const suggestedSet = new Set((suggestedStatIds ?? []).filter(Boolean));
      const autoSelected: Array<{ name: string; yearEnd: number; yearStart: number | null }> = [];
      for (const v of parsed) {
        const importedStat = existingCensusStats.get(v.name);
        const isImported = Boolean(importedStat);
        // Auto-select any AI-suggested variables that exist in this group preview.
        const shouldSelect = isImported || (suggestedSet.size > 0 && suggestedSet.has(v.name));
        const entry = getDefaultSelection({
          selected: shouldSelect,
          yearEnd: year,
          yearStart: isImported ? null : year - 2,
          lockedImported: isImported,
          importedStatId: importedStat?.id ?? null,
          importedStatLabel: importedStat?.label ?? null,
          importedStatName: importedStat?.name ?? null,
        });
        defaults[v.name] = entry;
        if (shouldSelect && !isImported && typeof entry.yearEnd === "number") {
          autoSelected.push({ name: v.name, yearEnd: entry.yearEnd, yearStart: entry.yearStart });
        }
      }

      const variableByName = new Map(parsed.map((entry) => [entry.name, entry]));

      // Mirror the manual checkbox behavior: if we auto-select variables, add them to the queue too.
      if (autoSelected.length) {
        const nextItems = autoSelected.map((sel) => {
          const qYear = sel.yearEnd;
          const qYears =
            sel.yearStart !== null ? Math.max(1, sel.yearEnd - sel.yearStart + 1) : 1;
          const key = `${resolvedDataset}::${trimmedGroup}::${sel.name}`;
          const variableMeta = variableByName.get(sel.name);
          return {
            id: key,
            dataset: resolvedDataset,
            group: trimmedGroup,
            variable: sel.name,
            statLabel: variableMeta?.statLabel || variableMeta?.statName || variableMeta?.label || sel.name,
            year: qYear,
            years: qYears,
            includeMoe: true,
            relationship: "none" as const,
            statAttribute: "",
            status: "pending" as const,
          };
        });
        setQueueItems((prevQueue) => mergeQueueItems(prevQueue, nextItems));
      }

      setSelection(defaults);
      setStep(2);
    } catch (err) {
      console.error("Failed to load Census preview", err);
      const message =
        err instanceof Error
          ? err.message
          : typeof err === "string"
          ? err
          : null;
      setPreviewError(message ? `Failed to load Census preview: ${message}` : "Failed to load Census preview.");
    } finally {
      setIsPreviewLoading(false);
    }
  }, [dataset, existingCensusStats, getDefaultSelection, group, limit, mergeQueueItems, year]);

  const toggleVariableSelected = useCallback((name: string) => {
    const trimmedGroup = group.trim();
    setSelection((prev) => {
      const current = prev[name] ?? getDefaultSelection();
      if (current.lockedImported) return prev;
      const newSelected = !current.selected;
      const effectiveRelationship: ImportRelationship =
        newSelected && manualParent && current.relationship === "none"
          ? "child"
          : current.relationship;
      
      // If selecting, add to queue
      if (newSelected && trimmedGroup) {
        const { year: qYear, years: qYears } = getYearRange(current, year);
        const key = `${dataset}::${trimmedGroup}::${name}`;
        const variableMeta = variableMetaByName.get(name);
        const nextItem: ImportQueueItem = {
          id: key,
          dataset,
          group: trimmedGroup,
          variable: name,
          statLabel: variableMeta?.statLabel || variableMeta?.statName || variableMeta?.label || name,
          year: qYear,
          years: qYears,
          includeMoe: true,
          relationship: effectiveRelationship ?? "none",
          statAttribute: current.statAttribute ?? "",
          status: "pending",
        };
        setQueueItems((prevQueue) => mergeQueueItems(prevQueue, [nextItem]));
      }
      // If deselecting, remove from queue
      if (!newSelected && trimmedGroup) {
        setQueueItems((prevQueue) =>
          prevQueue.filter((item) => item.variable !== name || item.group !== trimmedGroup),
        );
      }
      
      return {
        ...prev,
        [name]: {
          ...current,
          selected: newSelected,
          relationship: newSelected ? effectiveRelationship : "none",
          statAttribute: newSelected ? current.statAttribute : "",
        },
      };
    });
  }, [dataset, getDefaultSelection, getYearRange, group, manualParent, mergeQueueItems, variableMetaByName, year, setQueueItems]);

  const handleSelectAllFiltered = useCallback(() => {
    const trimmedGroup = group.trim();
    if (!trimmedGroup) return;

    const toSelect = filteredVariables.filter((v) => {
      const sel = selection[v.name] ?? getDefaultSelection();
      return !sel.lockedImported && !sel.selected;
    });

    if (toSelect.length === 0) return;

    const newQueueItems: ImportQueueItem[] = [];
    const updates: Record<string, VariableSelection> = {};

    toSelect.forEach((v) => {
      const current = selection[v.name] ?? getDefaultSelection();
      const effectiveRelationship: ImportRelationship =
        manualParent && current.relationship === "none" ? "child" : current.relationship;

      const { year: qYear, years: qYears } = getYearRange(current, year);
      const key = `${dataset}::${trimmedGroup}::${v.name}`;
      const variableMeta = variableMetaByName.get(v.name);

      newQueueItems.push({
        id: key,
        dataset,
        group: trimmedGroup,
        variable: v.name,
        statLabel: variableMeta?.statLabel || variableMeta?.statName || variableMeta?.label || v.name,
        year: qYear,
        years: qYears,
        includeMoe: true,
        relationship: effectiveRelationship ?? "none",
        statAttribute: current.statAttribute ?? "",
        status: "pending",
      });

      updates[v.name] = {
        ...current,
        selected: true,
        relationship: effectiveRelationship,
      };
    });

    setSelection((prev) => ({ ...prev, ...updates }));
    setQueueItems((prevQueue) => mergeQueueItems(prevQueue, newQueueItems));
  }, [
    dataset,
    filteredVariables,
    getDefaultSelection,
    getYearRange,
    group,
    manualParent,
    mergeQueueItems,
    selection,
    variableMetaByName,
    year,
    setQueueItems,
  ]);

  const handleClearSelection = useCallback(() => {
    const trimmedGroup = group.trim();
    if (!trimmedGroup) return;

    setSelection((prev) => {
      const next = { ...prev };
      Object.keys(next).forEach((name) => {
        const item = next[name];
        if (item && !item.lockedImported && item.selected) {
          next[name] = {
            ...item,
            selected: false,
            relationship: "none",
            statAttribute: "",
          };
        }
      });
      return next;
    });

    setQueueItems((prevQueue) =>
      prevQueue.filter((item) => item.group !== trimmedGroup),
    );
  }, [group, setQueueItems]);

  const updateSelectionField = useCallback(
    (name: string, field: "yearEnd" | "yearStart", value: number | null) => {
      const trimmedGroup = group.trim();
      setSelection((prev) => {
        const current = prev[name] ?? getDefaultSelection({ selected: true });
        if (current.lockedImported) return prev;
        const updated = { ...current, [field]: value };
        
        // Update corresponding queue item if selected
        if (current.selected && trimmedGroup) {
          const { year: qYear, years: qYears } = getYearRange(updated, year);
          setQueueItems((prevQueue) =>
            prevQueue.map((item) =>
              item.variable === name && item.group === trimmedGroup
                ? { ...item, year: qYear, years: qYears }
                : item,
            ),
          );
        }
        
        return {
          ...prev,
          [name]: updated,
        };
      });
    },
    [year, group, getDefaultSelection],
  );

  const setVariableRelationship = useCallback(
    (name: string, relationship: ImportRelationship) => {
      const trimmedGroup = group.trim();

      setSelection((prev) => {
        const current = prev[name] ?? getDefaultSelection();
        const normalizedRelationship =
          current.lockedImported && relationship === "child" ? "none" : relationship;
        const nextSelected = current.lockedImported ? true : current.selected ? current.selected : true;

        const nextForName: VariableSelection = {
          ...current,
          selected: nextSelected,
          relationship: normalizedRelationship,
          statAttribute: normalizedRelationship === "child" ? current.statAttribute : "",
        };

        const next: Record<string, VariableSelection> = { ...prev, [name]: nextForName };

        // Enforce: only one "parent" per import.
        if (normalizedRelationship === "parent") {
          if (manualParent) {
            setManualParent(null);
          }
          for (const [key, value] of Object.entries(next)) {
            if (key === name) continue;
            if (value?.relationship === "parent") {
              next[key] = { ...value, relationship: "none" };
            }
          }
        }

        // Already-imported stats should not be added to the queue, but can be chosen as Parent.
        if (current.lockedImported) {
          if (normalizedRelationship === "parent" && trimmedGroup) {
            // Clear any queued parent selections.
            setQueueItems((prevQueue) =>
              prevQueue.map((item) =>
                item.relationship === "parent" ? { ...item, relationship: "none" as const } : item,
              ),
            );
          }
          return next;
        }

        // Keep queue in sync (add if needed, update relationship, clear other parents).
        if (trimmedGroup) {
          const { year: qYear, years: qYears } = getYearRange(nextForName, year);
          const id = `${dataset}::${trimmedGroup}::${name}`;
          const variableMeta = variableMetaByName.get(name);
          setQueueItems((prevQueue) => {
            const hasItem = prevQueue.some((item) => item.id === id);
            let nextQueue = hasItem
              ? prevQueue.map((item) =>
                  item.id === id
                    ? {
                        ...item,
                        year: qYear,
                        years: qYears,
                        relationship: normalizedRelationship,
                        statAttribute: nextForName.statAttribute,
                      }
                    : item,
                )
              : mergeQueueItems(prevQueue, [
                  {
                    id,
                    dataset,
                    group: trimmedGroup,
                    variable: name,
                    statLabel: variableMeta?.statLabel || variableMeta?.statName || variableMeta?.label || name,
                    year: qYear,
                    years: qYears,
                    includeMoe: true,
                    relationship: normalizedRelationship,
                    statAttribute: nextForName.statAttribute,
                    status: "pending",
                  },
                ]);

            if (normalizedRelationship === "parent") {
              nextQueue = nextQueue.map((item) =>
                item.id !== id && item.relationship === "parent"
                  ? { ...item, relationship: "none" as const }
                  : item,
              );
            }
            return nextQueue;
          });
        }

        return next;
      });
    },
    [dataset, getDefaultSelection, getYearRange, group, manualParent, mergeQueueItems, variableMetaByName, year],
  );

  const updateVariableStatAttribute = useCallback(
    (name: string, statAttribute: string) => {
      const trimmedGroup = group.trim();
      setSelection((prev) => {
        const current = prev[name] ?? getDefaultSelection();
        if (current.lockedImported) return prev;
        const nextSelected = current.selected ? current.selected : true;
        const nextForName: VariableSelection = {
          ...current,
          selected: nextSelected,
          relationship: "child",
          statAttribute,
        };
        const next = { ...prev, [name]: nextForName };

        if (trimmedGroup) {
          setQueueItems((prevQueue) =>
            prevQueue.map((item) =>
              item.variable === name && item.group === trimmedGroup
                ? { ...item, relationship: "child", statAttribute }
                : item,
            ),
          );
        }

        return next;
      });
    },
    [getDefaultSelection, group],
  );

  const relationshipConfigError = useMemo(() => {
    return getRelationshipConfigError({
      selection,
      hasManualParent: Boolean(manualParent),
      pendingSelectionCount,
    });
  }, [manualParent, pendingSelectionCount, selection]);

  const createChangeDerivedChild = useCallback(
    async (parentStatId: string, startYear: string, endYear: string): Promise<string | null> => {
      if (!parentStatId || !startYear || !endYear || startYear >= endYear) return null;

      try {
        const { data: existingRelData } = await db.queryOnce({
          statRelations: {
            $: {
              where: { parentStatId, statAttribute: "Change" },
              fields: ["childStatId"],
            },
          },
        });
        const existingRel = Array.isArray((existingRelData as any)?.statRelations)
          ? (existingRelData as any).statRelations.find((r: any) => typeof r?.childStatId === "string")
          : null;
        if (existingRel?.childStatId) return existingRel.childStatId as string;

        const { data: parentStatsData } = await db.queryOnce({
          stats: { $: { where: { id: parentStatId }, fields: ["id", "name", "label", "category"] } },
        });
        const parentMeta = Array.isArray((parentStatsData as any)?.stats)
          ? (parentStatsData as any).stats[0]
          : null;
        if (!parentMeta || typeof parentMeta?.name !== "string") return null;

        const baseName = String(parentMeta.name);
        const baseLabel = typeof parentMeta.label === "string" && parentMeta.label.trim() ? parentMeta.label : baseName;
        const derivedName = `${baseName} (change)`;
        const derivedLabel = `${baseLabel} [Change]`;
        const derivedCategory = typeof parentMeta.category === "string" ? parentMeta.category : "";
        const derivedSource = "Derived, Census";

        const { data: statDataResponse } = await db.queryOnce({
          statData: {
            $: {
              where: { statId: parentStatId, name: "root" },
              fields: ["parentArea", "boundaryType", "date", "data"],
            },
          },
        });
        const rawRows = Array.isArray((statDataResponse as any)?.statData)
          ? ((statDataResponse as any).statData as any[])
          : [];

        type RowsByDate = Map<string, Record<string, number>>;
        const byContext = new Map<
          string,
          { parentArea: string | null; boundaryType: string | null; rowsByDate: RowsByDate }
        >();

        for (const row of rawRows) {
          if (!row || typeof row !== "object") continue;
          const parentArea = typeof row.parentArea === "string" ? row.parentArea : null;
          const boundaryType = typeof row.boundaryType === "string" ? row.boundaryType : null;
          const date = typeof row.date === "string" ? row.date : typeof row.date === "number" ? String(row.date) : null;
          if (!date) continue;
          const dataMap = normalizeDataMap(row.data);
          const ctxKey = `${parentArea ?? ""}|${boundaryType ?? ""}`;
          if (!byContext.has(ctxKey)) {
            byContext.set(ctxKey, { parentArea, boundaryType, rowsByDate: new Map() });
          }
          byContext.get(ctxKey)!.rowsByDate.set(date, dataMap);
        }

        const derivedRows: RootStatDataRow[] = [];
        let nonEmptyCount = 0;
        const isFiniteNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

        for (const ctx of byContext.values()) {
          const startData = ctx.rowsByDate.get(startYear);
          const endData = ctx.rowsByDate.get(endYear);
          if (!startData || !endData) continue;
          const changeData: Record<string, number> = {};
          for (const [area, startVal] of Object.entries(startData)) {
            const endVal = endData[area];
            if (!isFiniteNum(startVal) || !isFiniteNum(endVal) || startVal === 0) continue;
            changeData[area] = (endVal - startVal) / startVal;
          }
          if (Object.keys(changeData).length > 0) {
            nonEmptyCount += 1;
          }
          derivedRows.push({
            parentArea: ctx.parentArea,
            boundaryType: ctx.boundaryType,
            date: `${startYear}-${endYear}`,
            data: changeData,
          });
        }

        if (nonEmptyCount === 0) return null;

        const now = Date.now();
        const newStatId = createId();
        const relationKey = `${parentStatId}::${newStatId}::Change`;
        const txs: any[] = [
          db.tx.stats[newStatId].update({
            name: derivedName,
            label: derivedLabel,
            category: derivedCategory,
            source: derivedSource,
            goodIfUp: null,
            featured: false,
            homeFeatured: false,
            visibility: null,
            createdOn: now,
            lastUpdated: now,
          }),
          db.tx.statRelations[createId()].update({
            relationKey,
            parentStatId,
            childStatId: newStatId,
            statAttribute: "Change",
            createdAt: now,
            updatedAt: now,
          }),
        ];

        const sortedDerivedRows = [...derivedRows].sort((a, b) => String(a.date ?? "").localeCompare(String(b.date ?? "")));
        for (const row of sortedDerivedRows) {
          const parentArea = row.parentArea ?? undefined;
          const boundaryType = row.boundaryType ?? undefined;
          const date = row.date ?? undefined;
          const summaryKey =
            parentArea && boundaryType ? buildStatDataSummaryKey(newStatId, "root", parentArea, boundaryType) : null;
          const summary = computeSummaryFromData(row.data);
          txs.push(
            db.tx.statData[createId()].update({
              statId: newStatId,
              name: "root",
              parentArea,
              boundaryType,
              date,
              type: "percent_change",
              data: row.data,
              source: derivedSource,
              statTitle: derivedLabel,
              createdOn: now,
              lastUpdated: now,
            }),
          );
          if (summaryKey && date) {
            txs.push(
              db.tx.statDataSummaries[lookup("summaryKey", summaryKey)].update({
                statId: newStatId,
                name: "root",
                parentArea,
                boundaryType,
                date,
                minDate: date,
                maxDate: date,
                type: "percent_change",
                count: summary.count,
                sum: summary.sum,
                avg: summary.avg,
                min: summary.min,
                max: summary.max,
                updatedAt: now,
              }),
            );
          }
        }

        for (let i = 0; i < txs.length; i += MAX_DERIVED_TX_BATCH) {
          await db.transact(txs.slice(i, i + MAX_DERIVED_TX_BATCH));
        }

        return newStatId;
      } catch (err) {
        console.error("Failed to create change-over-time derived stat during import", err);
        return null;
      }
    },
    [],
  );

  const createPercentDerivedChild = useCallback(
    async (parentStatId: string, denominatorStatId: string): Promise<string | null> => {
      if (!parentStatId || !denominatorStatId) return null;

      try {
        const { data: existingRelData } = await db.queryOnce({
          statRelations: {
            $: {
              where: { parentStatId, statAttribute: "Percent" },
              fields: ["childStatId"],
            },
          },
        });
        const existingRel = Array.isArray((existingRelData as any)?.statRelations)
          ? (existingRelData as any).statRelations.find((r: any) => typeof r?.childStatId === "string")
          : null;
        if (existingRel?.childStatId) return existingRel.childStatId as string;

        const { data: statsData } = await db.queryOnce({
          stats: {
            $: {
              where: { id: { $in: [parentStatId, denominatorStatId] } },
              fields: ["id", "name", "label", "category"],
            },
          },
        });
        const rows = Array.isArray((statsData as any)?.stats) ? ((statsData as any).stats as any[]) : [];
        const parentMeta = rows.find((r) => r?.id === parentStatId);
        const denominatorMeta = rows.find((r) => r?.id === denominatorStatId);
        if (!parentMeta || !denominatorMeta) return null;

        const baseName = String(parentMeta.name);
        const baseLabel =
          typeof parentMeta.label === "string" && parentMeta.label.trim() ? parentMeta.label : baseName;
        const derivedName = `${baseName} (percent)`;
        const derivedLabel = `${baseLabel} [Percent]`;
        const derivedCategory = typeof parentMeta.category === "string" ? parentMeta.category : "";
        const derivedSource = "Derived, Census";

        const { data: statDataResponse } = await db.queryOnce({
          statData: {
            $: {
              where: { name: "root", statId: { $in: [parentStatId, denominatorStatId] } },
              fields: ["statId", "parentArea", "boundaryType", "date", "data"],
            },
          },
        });
        const rawRows = Array.isArray((statDataResponse as any)?.statData)
          ? ((statDataResponse as any).statData as any[])
          : [];

        const perStat = new Map<string, Map<string, RootStatDataRow>>();
        for (const row of rawRows) {
          if (!row || typeof row !== "object") continue;
          const statId = typeof row.statId === "string" ? row.statId : null;
          if (!statId) continue;
          const parentArea = typeof row.parentArea === "string" ? row.parentArea : null;
          const boundaryType = typeof row.boundaryType === "string" ? row.boundaryType : null;
          const rawDate = row.date;
          const date = typeof rawDate === "string" ? rawDate : typeof rawDate === "number" ? String(rawDate) : null;
          const dataMap = normalizeDataMap((row as any).data);
          const normalized: RootStatDataRow = { parentArea, boundaryType, date, data: dataMap };
          const key = buildRootStatDataRowKey(normalized);
          if (!perStat.has(statId)) perStat.set(statId, new Map());
          perStat.get(statId)!.set(key, normalized);
        }

        const numeratorRows = perStat.get(parentStatId);
        const denominatorRows = perStat.get(denominatorStatId);
        if (!numeratorRows?.size || !denominatorRows?.size) return null;

        const derivedRows: RootStatDataRow[] = [];
        let nonEmptyCount = 0;
        for (const [key, bRow] of denominatorRows.entries()) {
          const aRow = numeratorRows.get(key);
          if (!aRow) continue;
          const derivedData = computeDerivedValues(aRow.data ?? {}, bRow.data ?? {}, "percent");
          if (Object.keys(derivedData).length > 0) {
            nonEmptyCount += 1;
          }
          derivedRows.push({
            parentArea: bRow.parentArea,
            boundaryType: bRow.boundaryType,
            date: bRow.date,
            data: derivedData,
          });
        }

        if (nonEmptyCount === 0) return null;

        const now = Date.now();
        const newStatId = createId();
        const relationKey = `${parentStatId}::${newStatId}::Percent`;
        const txs: any[] = [
          db.tx.stats[newStatId].update({
            name: derivedName,
            label: derivedLabel,
            category: derivedCategory,
            source: derivedSource,
            goodIfUp: null,
            featured: false,
            homeFeatured: false,
            visibility: null,
            createdOn: now,
            lastUpdated: now,
          }),
          db.tx.statRelations[createId()].update({
            relationKey,
            parentStatId,
            childStatId: newStatId,
            statAttribute: "Percent",
            createdAt: now,
            updatedAt: now,
          }),
        ];

        const sortedDerivedRows = [...derivedRows].sort((a, b) => String(a.date ?? "").localeCompare(String(b.date ?? "")));
        for (const row of sortedDerivedRows) {
          const parentArea = row.parentArea ?? undefined;
          const boundaryType = row.boundaryType ?? undefined;
          const date = row.date ?? undefined;
          const summaryKey =
            parentArea && boundaryType ? buildStatDataSummaryKey(newStatId, "root", parentArea, boundaryType) : null;
          const summary = computeSummaryFromData(row.data);
          txs.push(
            db.tx.statData[createId()].update({
              statId: newStatId,
              name: "root",
              parentArea,
              boundaryType,
              date,
              type: "percent",
              data: row.data,
              source: derivedSource,
              statTitle: derivedLabel,
              createdOn: now,
              lastUpdated: now,
            }),
          );
          if (summaryKey && date) {
            txs.push(
              db.tx.statDataSummaries[lookup("summaryKey", summaryKey)].update({
                statId: newStatId,
                name: "root",
                parentArea,
                boundaryType,
                date,
                minDate: date,
                maxDate: date,
                type: "percent",
                count: summary.count,
                sum: summary.sum,
                avg: summary.avg,
                min: summary.min,
                max: summary.max,
                updatedAt: now,
              }),
            );
          }
        }

        for (let i = 0; i < txs.length; i += MAX_DERIVED_TX_BATCH) {
          await db.transact(txs.slice(i, i + MAX_DERIVED_TX_BATCH));
        }

        return newStatId;
      } catch (err) {
        console.error("Failed to create percent derived stat during import", err);
        return null;
      }
    },
    [],
  );

  const handleRunQueue = useCallback(async () => {
    if (pendingSelectionCount === 0) return;
    if (relationshipConfigError) {
      setPreviewError(relationshipConfigError);
      return;
    }
    if (addPercent && !percentDenominatorId) {
      setPreviewError("Select a denominator before starting imports.");
      return;
    }
    resetModalState(true);
    if (isRunning || isProcessingRef.current) return;

    setIsRunning(true);
    setCurrentItemId(null);
    setCurrentYearProcessing(null);
    isProcessingRef.current = true;
    onClose();
    openDropdown();

    const importedStatIds: string[] = [];
    const importedByItemId = new Map<string, string>();
    const erroredItemIds = new Set<string>();

    try {
      while (true) {
        const nextItem = queueItemsRef.current.find((item) => item.status === "pending");
        if (!nextItem) break;

        setCurrentItemId(nextItem.id);
        setQueueItems((prev) =>
          prev.map((q) =>
            q.id === nextItem.id ? { ...q, status: "running", errorMessage: undefined } : q,
          ),
        );

        // When importing multiple years, split into per-year requests to keep each server call small.
        let itemErrored = false;
        let itemStatId: string | null = null;
        const yearsToProcess =
          nextItem.years > 1
            ? Array.from({ length: nextItem.years }, (_, idx) => nextItem.year - idx)
            : [nextItem.year];

        for (const year of yearsToProcess) {
          try {
            setCurrentYearProcessing(year);
            const response = await fetch("/api/census-import", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                dataset: nextItem.dataset,
                group: nextItem.group,
                variable: nextItem.variable,
                year,
                years: 1,
                includeMoe: nextItem.includeMoe,
                category: category,
                visibility: "private",
                createdBy: user?.id ?? null,
              }),
            });
            const payload = (await response.json().catch(() => null)) as any;
            if (!response.ok || !payload || payload.ok === false || payload.error) {
              const message =
                (payload && typeof payload.error === "string" && payload.error) ||
                `Import failed with status ${response.status}.`;
              setQueueItems((prev) =>
                prev.map((q) =>
                  q.id === nextItem.id ? { ...q, status: "error", errorMessage: message } : q,
                ),
              );
              // Stop processing remaining years for this item on error
              itemErrored = true;
              erroredItemIds.add(nextItem.id);
              throw new Error(message);
            }
            const statId = typeof payload.statId === "string" ? payload.statId : null;
            if (statId && !importedStatIds.includes(statId)) {
              importedStatIds.push(statId);
            }
            if (statId) {
              itemStatId = statId;
              importedByItemId.set(nextItem.id, statId);
              setQueueItems((prev) =>
                prev.map((q) =>
                  q.id === nextItem.id ? { ...q, importedStatId: statId } : q,
                ),
              );
            }
            setCurrentYearProcessing(null);
          } catch (err) {
            console.error("Census import request failed", err);
            setQueueItems((prev) =>
              prev.map((q) =>
                q.id === nextItem.id
                  ? { ...q, status: "error", errorMessage: "Network error during import." }
                  : q,
              ),
            );
            itemErrored = true;
            erroredItemIds.add(nextItem.id);
            setCurrentYearProcessing(null);
            break;
          }
        }

        if (!itemErrored && itemStatId) {
          if (addPercent && percentDenominatorId) {
            const percentYearLabel =
              nextItem.years > 1
                ? `${nextItem.year - nextItem.years + 1}-${nextItem.year}`
                : String(nextItem.year);
            setDerivedStatusLabel(`Percentage ${percentYearLabel}`);
            const derivedId = await createPercentDerivedChild(itemStatId, percentDenominatorId);
            setDerivedStatusLabel(null);
            if (derivedId && !importedStatIds.includes(derivedId)) {
              importedStatIds.push(derivedId);
            }
          }
          if (addChange && nextItem.years > 1) {
            setDerivedStatusLabel("Change");
            const endYear = String(nextItem.year);
            const startYear = String(nextItem.year - nextItem.years + 1);
            const derivedId = await createChangeDerivedChild(itemStatId, startYear, endYear);
            setDerivedStatusLabel(null);
            if (derivedId && !importedStatIds.includes(derivedId)) {
              importedStatIds.push(derivedId);
            }
          }
        }

        // If we never marked this item as error, treat it as success (after derived work).
        setQueueItems((prev) =>
          prev.map((q) =>
            q.id === nextItem.id && !itemErrored
              ? {
                  ...q,
                  status: "success",
                  errorMessage: undefined,
                  importedStatId: itemStatId ?? q.importedStatId,
                }
              : q,
          ),
        );
      }

      const itemsSnapshot = queueItemsRef.current.slice();
      // Create parent/child stat relationships if configured.
      const parentItem = itemsSnapshot.find(
        (q) => q.relationship === "parent" && !erroredItemIds.has(q.id) && importedByItemId.has(q.id),
      );
      const importedParentSelection = Object.values(selection).find(
        (s) => s.relationship === "parent" && s.lockedImported && s.importedStatId,
      );
      const childItems = itemsSnapshot.filter(
        (q) => q.relationship === "child" && !erroredItemIds.has(q.id) && importedByItemId.has(q.id),
      );
      const parentStatId = manualParent?.id
        ? manualParent.id
        : parentItem
          ? importedByItemId.get(parentItem.id)
          : importedParentSelection?.importedStatId ?? null;
      if (childItems.length > 0 && parentStatId) {
        setDerivedStatusLabel("Grouping relationships");
        try {
          const parentId = parentStatId;
          const now = Date.now();
          const candidates = childItems
            .map((child) => {
              const childStatId = importedByItemId.get(child.id)!;
              if (!childStatId || childStatId === parentId) return null;
              const rawAttr = typeof child.statAttribute === "string" ? child.statAttribute.trim() : "";
              const statAttribute = rawAttr ? rawAttr : UNDEFINED_STAT_ATTRIBUTE;
              const relationKey = `${parentId}::${childStatId}::${statAttribute}`;
              return { relationKey, parentStatId: parentId, childStatId, statAttribute };
            })
            .filter(
              (v): v is { relationKey: string; parentStatId: string; childStatId: string; statAttribute: string } =>
                v !== null,
            );

          const uniqueByKey = new Map<string, (typeof candidates)[number]>();
          for (const c of candidates) uniqueByKey.set(c.relationKey, c);
          const unique = Array.from(uniqueByKey.values());

          if (unique.length > 0) {
            try {
              const { data } = await db.queryOnce({
                statRelations: {
                  $: {
                    where: { relationKey: { $in: unique.map((u) => u.relationKey) } },
                    fields: ["relationKey"],
                  },
                },
              });
              const existing = new Set(
                Array.isArray((data as any)?.statRelations)
                  ? (data as any).statRelations
                      .map((r: any) => (typeof r?.relationKey === "string" ? r.relationKey : null))
                      .filter(Boolean)
                  : [],
              );
              const txs = unique
                .filter((u) => !existing.has(u.relationKey))
                .map((u) =>
                  db.tx.statRelations[createId()].update({
                    relationKey: u.relationKey,
                    parentStatId: u.parentStatId,
                    childStatId: u.childStatId,
                    statAttribute: u.statAttribute,
                    createdAt: now,
                    updatedAt: now,
                  }),
                );
              const childVisibilityUpdates = Array.from(
                new Set(unique.map((u) => u.childStatId)),
              ).map((childStatId) => db.tx.stats[childStatId].update({ visibility: null }));
              if (txs.length > 0) {
                await db.transact([...txs, ...childVisibilityUpdates]);
              }
            } catch (err) {
              console.error("Failed to create stat relationships after import", err);
            }
          }
        } finally {
          setDerivedStatusLabel(null);
        }
      }
    } finally {
      setIsRunning(false);
      setCurrentItemId(null);
      setCurrentYearProcessing(null);
      setDerivedStatusLabel(null);
      isProcessingRef.current = false;
      if (importedStatIds.length > 0) {
        onImported(importedStatIds);
      }
    }
  }, [
    addChange,
    addPercent,
    category,
    createChangeDerivedChild,
    createPercentDerivedChild,
    isRunning,
    manualParent,
    onImported,
    pendingSelectionCount,
    percentDenominatorId,
    resetModalState,
    relationshipConfigError,
    setDerivedStatusLabel,
    selection,
    user?.id,
  ]);

  if (!isOpen) return null;

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center overflow-y-auto bg-slate-950/50 p-4">
      <div ref={modalRef} className="relative my-auto w-full max-w-4xl rounded-2xl bg-white p-4 shadow-xl sm:p-6 dark:bg-slate-900">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
              Import Census stats
            </h2>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              Choose a Census group, preview available variables, add them to an import queue,
              and run them one by one.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-1 text-slate-500 transition hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="mt-4 flex flex-col gap-4 md:grid md:grid-cols-[minmax(0,1.2fr)_minmax(0,1.2fr)]">
          <div className="order-1 h-fit space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-4 md:order-2 dark:border-slate-700 dark:bg-slate-900/40">
            <div className="space-y-3">
              {/* Dataset and Group Search on same row */}
              <div className="flex items-end gap-3">
                <div className="w-1/4 shrink-0 space-y-1">
                  <label className="text-xs font-medium text-slate-600 dark:text-slate-300">
                    Dataset
                  </label>
                  <input
                    type="text"
                    value={dataset}
                    onChange={(e) => setDataset(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-900 focus:border-brand-400 focus:outline-none focus:ring-1 focus:ring-brand-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                  />
                </div>
                <div className="flex-1 space-y-1">
                  <label className="text-xs font-medium text-slate-600 dark:text-slate-300">
                    Search
                  </label>
                  <GroupSearchInput
                    value={group}
                    onChange={setGroup}
                    dataset={dataset}
                    year={year}
                    onPreview={handlePreview}
                    inputRef={groupInputRef}
                    onRegisterSearchRunner={(runner) => setRunGroupSearch(() => runner)}
                  />
                </div>
              </div>
              {/* Year, Limit, Search button row */}
              <div className="flex flex-wrap items-center gap-3 md:flex-nowrap">
                <div className="flex items-center gap-1.5">
                  <label className="text-xs font-medium text-slate-600 dark:text-slate-300">
                    Year
                  </label>
                  <input
                    type="number"
                    value={year}
                    onChange={(e) => setYear(Number(e.target.value) || year)}
                    className="w-16 appearance-none rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-900 focus:border-brand-400 focus:outline-none focus:ring-1 focus:ring-brand-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                  />
                </div>
                <div className="flex items-center gap-1.5">
                  <label className="text-xs font-medium text-slate-600 dark:text-slate-300">
                    Limit
                  </label>
                  <input
                    type="number"
                    value={limit}
                    onChange={(e) => setLimit(Math.max(1, Math.min(50, Number(e.target.value) || 20)))}
                    className="w-14 appearance-none rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-900 focus:border-brand-400 focus:outline-none focus:ring-1 focus:ring-brand-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => {
                    const trimmed = group.trim();
                    if (looksLikeGroupId(trimmed)) {
                      handlePreview();
                      return;
                    }
                    if (runGroupSearch) {
                      runGroupSearch();
                      return;
                    }
                    setPreviewError("Enter a Census group ID (e.g., S1701) or a search term and press Search again.");
                  }}
                  disabled={isPreviewLoading}
                  className="ml-auto inline-flex items-center gap-2 rounded-lg bg-brand-500 px-3 py-1.5 text-xs font-medium text-white shadow-sm transition hover:bg-brand-600 disabled:opacity-60"
                >
                  {isPreviewLoading ? "Searching…" : "Search"}
                </button>
              </div>
            </div>
            {previewError && (
              <p className="mt-1 text-[11px] text-rose-600 dark:text-rose-400">{previewError}</p>
            )}
          </div>

          <div className="order-3 space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-4 md:order-3 dark:border-slate-700 dark:bg-slate-900/40">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
              Pending Import
            </h3>

            <div className="mt-2 flex items-center justify-between rounded-lg border border-slate-200 bg-white px-3 py-2 text-[11px] text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
              {pendingSelectionCount === 0 ? (
                <p>No variables pending import yet. Select variables from the preview below.</p>
              ) : (
                <>
                  <p>
                    {pendingSelectionCount} variable{pendingSelectionCount === 1 ? "" : "s"}
                    {pendingGroupLabel ? ` from ${pendingGroupLabel}` : ""} pending import.
                  </p>
                  <button
                    type="button"
                    onClick={handleClearSelection}
                    className="ml-2 font-medium text-slate-400 transition hover:text-rose-600 dark:hover:text-rose-400"
                  >
                    Clear all
                  </button>
                </>
              )}
            </div>

            <div className="mt-3 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-3">
                  <span className="text-xs font-medium text-slate-600 dark:text-slate-300">Add:</span>
                  <label className="inline-flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-300">
                    <input
                      type="checkbox"
                      checked={addPercent}
                      onChange={(e) => setAddPercent(e.target.checked)}
                      className="h-3.5 w-3.5 rounded border-slate-300 text-brand-500 focus:ring-brand-400 dark:border-slate-600 dark:bg-slate-900"
                    />
                    Percentage
                  </label>
                  {addPercent && (
                    <button
                      type="button"
                      onClick={() => setIsDenominatorSearchOpen((open) => !open)}
                      className={`inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-[10px] font-medium shadow-sm transition ${
                        percentDenominatorId
                          ? "border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
                          : "border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100 dark:border-rose-900/60 dark:bg-rose-900/20 dark:text-rose-300 dark:hover:bg-rose-900/30"
                      }`}
                    >
                      {percentDenominatorId
                        ? `Denom: ${selectedDenominator?.label || selectedDenominator?.name || "Selected"}`
                        : "Denominator needed"}
                    </button>
                  )}
                  <label className="inline-flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-300">
                    <input
                      type="checkbox"
                      checked={addChange}
                      onChange={(e) => {
                        setAddChange(e.target.checked);
                        setHasManuallyToggledChange(true);
                      }}
                      disabled={changeOptionDisabled}
                      className="h-3.5 w-3.5 rounded border-slate-300 text-brand-500 focus:ring-brand-400 disabled:opacity-60 dark:border-slate-600 dark:bg-slate-900"
                    />
                    Change
                  </label>
                  {pendingSelectionCount > 0 && changeOptionDisabled && (
                    <span className="text-[10px] text-slate-400 dark:text-slate-500">(all need 2+ years)</span>
                  )}
                </div>
              </div>

              {addPercent && isDenominatorSearchOpen && (
                <div className="space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-3 text-[11px] dark:border-slate-700 dark:bg-slate-900/40">
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      type="text"
                      value={denominatorSearch}
                      onChange={(e) => setDenominatorSearch(e.target.value)}
                      placeholder="Search imported stats for denominator..."
                      className="w-full flex-1 rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-[11px] text-slate-900 placeholder:text-slate-400 focus:border-brand-400 focus:outline-none focus:ring-1 focus:ring-brand-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-500"
                    />
                    <button
                      type="button"
                      onClick={() => setDenominatorSearch("")}
                      className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-[10px] font-medium text-slate-600 transition hover:bg-slate-100 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                    >
                      Clear
                    </button>
                  </div>
                  <div className="max-h-40 overflow-y-auto rounded-lg border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
                    {denominatorSearchResults.length === 0 ? (
                      <p className="px-3 py-2 text-[10px] text-slate-500 dark:text-slate-400">
                        No matching imported stats found.
                      </p>
                    ) : (
                      denominatorSearchResults.map((stat) => (
                        <button
                          key={stat.id}
                          type="button"
                          onClick={() => handleSelectDenominator(stat)}
                          className="flex w-full items-center justify-between gap-3 border-b border-slate-100 px-3 py-2 text-left last:border-b-0 hover:bg-slate-50 disabled:opacity-60 dark:border-slate-800 dark:hover:bg-slate-800/70"
                        >
                          <div className="min-w-0">
                            <div className="truncate text-[11px] font-medium text-slate-800 dark:text-slate-100">
                              {stat.label || stat.name}
                            </div>
                            <div className="truncate text-[10px] text-slate-500 dark:text-slate-400">
                              {stat.label ? stat.name : ""}
                            </div>
                          </div>
                          <div className="text-[10px] text-slate-500 dark:text-slate-400">
                            {stat.category}
                          </div>
                        </button>
                      ))
                    )}
                  </div>
                  <p className="text-[10px] text-slate-500 dark:text-slate-400">
                    This denominator is used to create “...[Percent]” child stats for each imported stat.
                  </p>
                </div>
              )}
            </div>

            {/* Apply Category + Start Import row */}
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 pt-3 dark:border-slate-700">
              <div className="flex flex-wrap items-center gap-2">
                <label className="text-xs font-medium text-slate-600 dark:text-slate-300">
                  Apply Category
                </label>
                <CustomSelect
                  value={category ?? ""}
                  onChange={(val) => setCategory(val ? (val as Category) : null)}
                  options={[
                    { value: "", label: "None" },
                    ...categoryOptions,
                  ]}
                  className="min-w-36"
                />
              </div>
              <button
                type="button"
                onClick={handleRunQueue}
                disabled={
                  pendingSelectionCount === 0 ||
                  Boolean(relationshipConfigError) ||
                  (addPercent && !percentDenominatorId)
                }
                className="rounded-lg bg-emerald-500 px-3 py-1.5 text-[11px] font-medium text-white shadow-sm transition hover:bg-emerald-600 disabled:opacity-60"
              >
                Start import
              </button>
            </div>
            {relationshipConfigError && (
              <p className="mt-2 text-[11px] text-rose-600 dark:text-rose-400">{relationshipConfigError}</p>
            )}
          </div>

          {/* Preview section - order-2 on mobile, order-1 on desktop (above other sections) */}
          {step === 2 && variables.length > 0 && (
            <div className="order-2 md:order-1 md:col-span-2">
              {/* Meta info above preview */}
              {previewTotal > 0 && lastSubmittedGroup && (
                <div className="mb-2 space-y-1 px-1 text-[10px] text-slate-400 dark:text-slate-500">
                  <p>
                    {filteredVariables.length} of {previewTotal} in {lastSubmittedGroup} (+ MOE)
                  </p>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    {previewUniverse && <span>Universe: {previewUniverse}</span>}
                    <span>Dataset: {previewDataset}</span>
                    <span>Vintage: {previewYear}</span>
                    {predicateTypeSummary && <span>Type: {predicateTypeSummary}</span>}
                  </div>
                  {conceptDisplay.shared && (
                  <div className="text-[10px] text-slate-400/90 dark:text-slate-500">
                    Concept: {conceptDisplay.shared}
                  </div>
                )}
              </div>
              )}
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2 px-1">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    Statistics (Variables)
                  </span>
                  {manualParent && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
                      Parent: {manualParent.label || manualParent.name}
                      <button
                        type="button"
                        onClick={handleClearManualParent}
                        className="text-emerald-700 transition hover:text-emerald-900 disabled:opacity-50 dark:text-emerald-300 dark:hover:text-emerald-100"
                        title="Clear parent selection"
                      >
                        ×
                      </button>
                    </span>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => setIsParentSearchOpen((open) => !open)}
                  className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1 text-[11px] font-medium text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
                >
                  + Parent
                </button>
              </div>

              {/* Results Filter */}
              <div className="mb-3 px-1">
                <div className="relative">
                  <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-2.5">
                    <svg
                      className="h-3.5 w-3.5 text-slate-400"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                      />
                    </svg>
                  </div>
                  <input
                    type="text"
                    value={resultsFilter}
                    onChange={(e) => setResultsFilter(e.target.value)}
                    placeholder="Filter results by stat name..."
                    className="w-full rounded-lg border border-slate-200 bg-white py-1.5 pl-8 pr-24 text-[11px] text-slate-900 placeholder:text-slate-400 focus:border-brand-400 focus:outline-none focus:ring-1 focus:ring-brand-300 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-500"
                  />
                  <div className="absolute inset-y-0 right-0 flex items-center pr-1.5">
                    {filteredVariables.some((v) => {
                      const sel = selection[v.name] ?? getDefaultSelection();
                      return !sel.lockedImported && !sel.selected;
                    }) && (
                      <button
                        type="button"
                        onClick={handleSelectAllFiltered}
                        className="rounded px-2 py-1 text-[10px] font-semibold text-brand-600 transition hover:bg-brand-50 hover:text-brand-700 dark:text-brand-400 dark:hover:bg-brand-900/30 dark:hover:text-brand-300"
                      >
                        Select All
                      </button>
                    )}
                    {resultsFilter && (
                      <button
                        type="button"
                        onClick={() => setResultsFilter("")}
                        className="ml-0.5 flex h-6 w-6 items-center justify-center text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                      >
                        <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M6 18L18 6M6 6l12 12"
                          />
                        </svg>
                      </button>
                    )}
                  </div>
                </div>
              </div>
              {isParentSearchOpen && (
                <div className="mb-3 space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-3 text-[11px] dark:border-slate-700 dark:bg-slate-900/40">
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      type="text"
                      value={parentSearch}
                      onChange={(e) => setParentSearch(e.target.value)}
                      placeholder="Search existing stats by name/label"
                      className="w-full flex-1 rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-[11px] text-slate-900 placeholder:text-slate-400 focus:border-brand-400 focus:outline-none focus:ring-1 focus:ring-brand-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-500"
                    />
                    <button
                      type="button"
                      onClick={() => setParentSearch("")}
                      className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-[10px] font-medium text-slate-600 transition hover:bg-slate-100 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                    >
                      Clear
                    </button>
                  </div>
                  <div className="max-h-40 overflow-y-auto rounded-lg border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
                    {parentSearchResults.length === 0 ? (
                      <p className="px-3 py-2 text-[10px] text-slate-500 dark:text-slate-400">
                        No matching stats found.
                      </p>
                    ) : (
                      parentSearchResults.map((stat) => (
                        <button
                          key={stat.id}
                          type="button"
                          onClick={() => handleSelectManualParent(stat)}
                          className="flex w-full items-center justify-between gap-3 border-b border-slate-100 px-3 py-2 text-left last:border-b-0 hover:bg-slate-50 disabled:opacity-60 dark:border-slate-800 dark:hover:bg-slate-800/70"
                        >
                          <div className="min-w-0">
                            <div className="truncate text-[11px] font-medium text-slate-800 dark:text-slate-100">
                              {stat.label || stat.name}
                            </div>
                            <div className="truncate text-[10px] text-slate-500 dark:text-slate-400">
                              {stat.label ? stat.name : ""}
                            </div>
                          </div>
                          <div className="flex items-center gap-2 text-[10px] text-slate-500 dark:text-slate-400">
                            <span className="rounded-full bg-slate-100 px-2 py-0.5 dark:bg-slate-800">
                              {stat.category}
                            </span>
                            {stat.source && (
                              <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
                                {stat.source}
                              </span>
                            )}
                          </div>
                        </button>
                      ))
                    )}
                  </div>
                  <p className="text-[10px] text-slate-500 dark:text-slate-400">
                    Picking a parent here will not add it to the queue; it only links imported children to that stat.
                  </p>
                  {manualParent && (
                    <p className="text-[10px] text-slate-500 dark:text-slate-400">
                      Tip: selecting a variable now defaults its relationship to Child.
                    </p>
                  )}
                </div>
              )}
              <div className="max-h-60 overflow-y-auto rounded-xl border border-slate-200 bg-white p-3 text-[11px] dark:border-slate-700 dark:bg-slate-900">
                {/* Desktop header - hidden on mobile */}
                <div className="mb-2 hidden grid-cols-4 gap-4 px-1 text-[10px] font-medium uppercase tracking-wide text-slate-500 sm:grid dark:text-slate-400">
                  <span className="pl-6">Variable</span>
                  <span>Year Range</span>
                  <span>Coverage</span>
                  <span className="text-center">Relationship</span>
                </div>
            <div className="space-y-1">
              {filteredVariables.map((v) => {
                const sel = selection[v.name] ?? getDefaultSelection({ yearEnd: year, yearStart: year - 2 });
                const rel = sel.relationship ?? "none";
                const relationshipLabel = rel === "none" ? "None" : rel === "child" ? "Child" : "Parent";
                const nextRelationship = (current: ImportRelationship) =>
                  sel.lockedImported
                    ? (current === "parent" ? "none" : "parent")
                    : current === "none"
                      ? "child"
                      : current === "child"
                        ? "parent"
                        : "none";
                return (
                  <label
                    key={v.name}
                    className="grid cursor-pointer grid-cols-[1fr_auto] items-center gap-4 rounded-lg border-t border-slate-100 px-1.5 py-1.5 first:border-t-0 hover:bg-slate-50 sm:grid-cols-4 dark:border-slate-800/70 dark:hover:bg-slate-800/60"
                  >
                    <div className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={sel.selected}
                        onChange={() => toggleVariableSelected(v.name)}
                        disabled={sel.lockedImported}
                        className="h-3.5 w-3.5 shrink-0 rounded border-slate-300 text-brand-500 focus:ring-brand-400 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-100 dark:border-slate-500 dark:bg-slate-900 disabled:dark:border-slate-800 disabled:dark:bg-slate-800"
                      />
                      <div className="flex min-w-0 flex-col">
                        <span className="font-medium text-slate-800 dark:text-slate-100">
                          {v.name}
                        </span>
                        <span className="text-[10px] text-slate-500 dark:text-slate-400">
                          {v.inferredType} · <HighlightMatch text={v.statName} filter={resultsFilter} />
                        </span>
                        {conceptDisplay.showPerVariable && v.concept?.trim() && (
                          <span className="text-[10px] text-slate-400 dark:text-slate-500">
                            {v.concept}
                          </span>
                        )}
                        {sel.lockedImported && (
                          <span className="text-[10px] font-semibold text-emerald-700 dark:text-emerald-400">
                            Imported as "{sel.importedStatLabel ?? sel.importedStatName ?? v.statName}"
                          </span>
                        )}
                        {/* Mobile: relationship controls */}
                        <div className="mt-1 flex items-center gap-2 sm:hidden">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              setVariableRelationship(v.name, nextRelationship(rel));
                            }}
                            className="rounded border border-slate-300 bg-white px-2 py-0.5 text-[10px] font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
                            title="Click to cycle relationship"
                          >
                            {relationshipLabel}
                          </button>
                          {rel === "child" && (
                            <div className="flex min-w-0 flex-col">
                              <span className="text-[9px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
                                statAttribute
                              </span>
                              <input
                                type="text"
                                value={sel.statAttribute ?? ""}
                                onChange={(e) => updateVariableStatAttribute(v.name, e.target.value)}
                                onClick={(e) => e.stopPropagation()}
                                disabled={sel.lockedImported}
                                className="w-32 rounded border border-slate-300 bg-white px-1.5 py-0.5 text-[10px] text-slate-900 placeholder:text-slate-400 focus:border-brand-400 focus:outline-none focus:ring-1 focus:ring-brand-300 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-500"
                                placeholder="optional"
                              />
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                    {/* Year range - stacks vertically on mobile */}
                    <div className="flex flex-col gap-0.5 text-[10px] text-slate-600 sm:flex-row sm:items-center sm:gap-1 dark:text-slate-300">
                      <input
                        type="number"
                        value={sel.yearStart ?? ""}
                        placeholder="Start"
                        onChange={(e) => {
                          const val = e.target.value.trim();
                          updateSelectionField(v.name, "yearStart", val ? Number(val) : null);
                        }}
                        onClick={(e) => e.stopPropagation()}
                        disabled={sel.lockedImported}
                        className="w-14 appearance-none rounded border border-slate-300 bg-white px-1.5 py-0.5 text-center text-[10px] text-slate-900 placeholder:text-slate-400 focus:border-brand-400 focus:outline-none focus:ring-1 focus:ring-brand-300 sm:text-left dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-500"
                      />
                      <span className="hidden sm:inline">to</span>
                      <input
                        type="number"
                        value={sel.yearEnd ?? ""}
                        placeholder="End"
                        onChange={(e) => {
                          const val = e.target.value.trim();
                          updateSelectionField(v.name, "yearEnd", val ? Number(val) : null);
                        }}
                        onClick={(e) => e.stopPropagation()}
                        disabled={sel.lockedImported}
                        className="w-14 appearance-none rounded border border-slate-300 bg-white px-1.5 py-0.5 text-center text-[10px] text-slate-900 placeholder:text-slate-400 focus:border-brand-400 focus:outline-none focus:ring-1 focus:ring-brand-300 sm:text-left dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-500"
                      />
                    </div>
                    <div className="hidden text-[10px] text-slate-500 sm:block dark:text-slate-400">
                      {v.zipCount} ZIPs · {v.countyCount} counties
                    </div>
                    {/* Desktop: relationship controls (button centered, statAttribute grows right) */}
                    <div className="hidden sm:grid sm:grid-cols-[1fr_auto_1fr] sm:items-center sm:gap-2">
                      <div />
                      <button
                        type="button"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          setVariableRelationship(v.name, nextRelationship(rel));
                        }}
                        className="justify-self-center rounded border border-slate-300 bg-white px-2 py-0.5 text-[10px] font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
                        title="Click to cycle relationship"
                      >
                        {relationshipLabel}
                      </button>
                      {rel === "child" ? (
                        <div className="min-w-0 justify-self-stretch">
                          <div className="flex flex-col">
                            <span className="text-[9px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
                              statAttribute
                            </span>
                            <input
                              type="text"
                              value={sel.statAttribute ?? ""}
                              onChange={(e) => updateVariableStatAttribute(v.name, e.target.value)}
                              onClick={(e) => e.stopPropagation()}
                              disabled={sel.lockedImported}
                              className="w-full rounded border border-slate-300 bg-white px-1.5 py-0.5 text-[10px] text-slate-900 placeholder:text-slate-400 focus:border-brand-400 focus:outline-none focus:ring-1 focus:ring-brand-300 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-500"
                              placeholder="optional"
                            />
                          </div>
                        </div>
                      ) : (
                        <div />
                      )}
                    </div>
                  </label>
                );
              })}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
};
