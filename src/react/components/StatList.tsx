import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MagnifyingGlassIcon, XMarkIcon } from "@heroicons/react/24/outline";
import type { Stat, StatRelation, StatRelationsByParent, StatRelationsByChild } from "../../types/stat";
import { UNDEFINED_STAT_ATTRIBUTE } from "../../types/stat";
import { formatStatValue } from "../../lib/format";
import type { SeriesByKind, StatBoundaryEntry } from "../hooks/useStats";
import { computeSimilarityFromNormalized, normalizeForSearch } from "../lib/fuzzyMatch";
import { CustomSelect } from "./CustomSelect";
import { useCategories } from "../hooks/useCategories";
import { StatViz } from "./StatViz";
import type { AreaId } from "../../types/areas";

const STAT_SEARCH_MATCH_THRESHOLD = 0.4;

// Compute average of all values in a boundary entry (used for context average display)
const computeContextAverage = (entry: StatBoundaryEntry | undefined): number => {
  if (!entry?.data) return 0;
  const values = Object.values(entry.data);
  const nums = values.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  if (nums.length === 0) return 0;
  return nums.reduce((sum, v) => sum + v, 0) / nums.length;
};

type SupportedAreaKind = "ZIP" | "COUNTY";
type SelectedAreasMap = Partial<Record<SupportedAreaKind, string[]>>;

type StatDataById = Map<string, Partial<Record<SupportedAreaKind, StatBoundaryEntry>>>;
type StatSummaryEntry = {
  type: string;
  date: string;
  count: number;
  sum: number;
  avg: number;
  min: number;
  max: number;
};
type StatSummariesById = Map<string, Partial<Record<SupportedAreaKind, StatSummaryEntry>>>;

type StatSelectMeta = { shiftKey?: boolean; clear?: boolean };

type AreaEntry = { kind: SupportedAreaKind; code: string };

type StatRow = {
  id: string;
  name: string;
  score: number;
  type: string;
  hasData: boolean;
  category?: string;
};

type PinnedAreasMap = Partial<Record<SupportedAreaKind, string[]>>;
type SeriesByKindMap = Map<string, SeriesByKind>;

interface StatListProps {
  statsById?: Map<string, Stat>;
  statSummariesById?: StatSummariesById;
  statDataById?: StatDataById;
  statRelationsByParent?: StatRelationsByParent;
  statRelationsByChild?: StatRelationsByChild;
  selectedAreas?: SelectedAreasMap;
  activeAreaKind?: SupportedAreaKind | null;
  areaNameLookup?: (kind: SupportedAreaKind, code: string) => string;
  categoryFilter?: string | null;
  secondaryStatId?: string | null;
  selectedStatId?: string | null;
  selectedStatLoading?: boolean;
  onStatSelect?: (statId: string | null, meta?: StatSelectMeta) => void;
  onRetryStatData?: (statId: string) => void;
  onClearCategory?: () => void;
  onScrollTopChange?: (atTop: boolean) => void;
  variant?: "desktop" | "mobile";
  zipScopeDisplayName?: string | null;
  countyScopeDisplayName?: string | null;
  // StatViz props for embedded chart (only shown when showAdvanced is true)
  showAdvanced?: boolean;
  seriesByStatIdByKind?: SeriesByKindMap;
  pinnedAreas?: PinnedAreasMap;
  hoveredArea?: AreaId | null;
  onHoverArea?: (area: AreaId | null) => void;
  getZipParentCounty?: (zipCode: string) => { code: string; name: string } | null;
}

const SUPPORTED_KINDS: SupportedAreaKind[] = ["ZIP", "COUNTY"];

const buildAreaEntries = (selectedAreas?: SelectedAreasMap): AreaEntry[] => {
  const entries: AreaEntry[] = [];
  for (const kind of SUPPORTED_KINDS) {
    const codes = selectedAreas?.[kind] ?? [];
    for (const code of codes) {
      if (typeof code === "string" && code.trim().length > 0) {
        entries.push({ kind, code });
      }
    }
  }
  return entries;
};

// Dropdown for selecting a child stat from a parent's attribute group
interface ChildStatDropdownProps {
  attributeName: string;
  relations: Array<StatRelation & { child: Stat | null }>;
  selectedChildId: string | null; // Currently selected child in this attribute group
  onStatSelect?: (statId: string | null, meta?: StatSelectMeta) => void;
  onDeselect?: () => void; // Called when "No [attribute]" is selected
}

const ChildStatDropdown = ({
  attributeName,
  relations,
  selectedChildId,
  onStatSelect,
  onDeselect,
}: ChildStatDropdownProps) => {
  // Filter out relations with null children
  const validRelations = relations.filter((r) => r.child !== null);
  if (validRelations.length === 0) return null;

  // Determine which value to show - either the selected child or "none"
  const currentValue = selectedChildId && validRelations.some(r => r.childStatId === selectedChildId)
    ? selectedChildId
    : "__none__";

  const options = [
    { value: "__none__", label: `No ${attributeName.toLowerCase()}` },
    ...validRelations.map((relation) => ({
      value: relation.childStatId,
      label: relation.child?.label || relation.child?.name || relation.childStatId,
    })),
  ];

  return (
    <div className="flex items-center gap-2">
      <label className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500 whitespace-nowrap">
        {attributeName}
      </label>
      <CustomSelect
        value={currentValue}
        options={options}
        onChange={(childId) => {
          if (childId === "__none__") {
            onDeselect?.();
            return;
          }
          onStatSelect?.(childId);
        }}
        compact={true}
      />
    </div>
  );
};

export const StatList = ({
  statsById = new Map(),
  statSummariesById = new Map(),
  statDataById = new Map(),
  statRelationsByParent = new Map(),
  statRelationsByChild = new Map(),
  selectedAreas,
  activeAreaKind = null,
  areaNameLookup,
  categoryFilter = null,
  secondaryStatId = null,
  selectedStatId = null,
  selectedStatLoading = false,
  onStatSelect,
  onRetryStatData,
  onClearCategory,
  onScrollTopChange,
  variant = "desktop",
  zipScopeDisplayName = null,
  countyScopeDisplayName: _countyScopeDisplayName = null,
  // StatViz props
  showAdvanced = false,
  seriesByStatIdByKind = new Map(),
  pinnedAreas = {},
  hoveredArea = null,
  onHoverArea,
  getZipParentCounty,
}: StatListProps) => {
  const { getCategoryLabel } = useCategories();
  const showStatSearch = variant === "mobile";
  const areaEntries = useMemo(() => buildAreaEntries(selectedAreas), [selectedAreas]);
  const [searchQuery, setSearchQuery] = useState("");
  const normalizedQuery = useMemo(() => normalizeForSearch(searchQuery), [searchQuery]);
  const effectiveNormalizedQuery = showStatSearch ? normalizedQuery : "";
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  const reportScrollTop = useCallback(() => {
    if (!onScrollTopChange) return;
    const node = scrollContainerRef.current;
    if (!node) return;
    onScrollTopChange(node.scrollTop <= 2);
  }, [onScrollTopChange]);

  // Determine which boundary level to use: prefer activeAreaKind if set, otherwise infer from selections
  const effectiveAreaKind = useMemo<SupportedAreaKind | null>(() => {
    if (activeAreaKind) return activeAreaKind;
    const hasCountySelection = areaEntries.some((area) => area.kind === "COUNTY");
    const hasZipSelection = areaEntries.some((area) => area.kind === "ZIP");
    if (hasCountySelection && !hasZipSelection) return "COUNTY";
    if (hasZipSelection && !hasCountySelection) return "ZIP";
    return null;
  }, [activeAreaKind, areaEntries]);

  // Set of stat IDs that are children of some parent (should be hidden from main list)
  const childIdSet = useMemo(
    () => new Set(Array.from(statRelationsByChild.keys())),
    [statRelationsByChild]
  );

  const listStats = useMemo<Stat[]>(() => {
    return Array.from(statsById.values()).filter((s) => {
      // Show stats unless explicitly marked inactive (legacy active=false or visibility="inactive").
      if (s.active === false) return false;
      if (s.visibility === "inactive") return false;
      // Hide child stats from the main list - they appear via parent's dropdown
      if (childIdSet.has(s.id)) return false;
      // Apply category filter if provided
      if (categoryFilter) return s.category === categoryFilter;
      return true;
    });
  }, [statsById, categoryFilter, childIdSet]);

  // Count stats hidden by the category filter (shown in the "X more stats available" footer)
  const hiddenByCategoryCount = useMemo(() => {
    if (!categoryFilter) return 0;
    return Array.from(statsById.values()).filter((s) => {
      if (s.active === false) return false;
      if (s.visibility === "inactive") return false;
      if (childIdSet.has(s.id)) return false;
      return s.category !== categoryFilter;
    }).length;
  }, [statsById, categoryFilter, childIdSet]);

  // Simplified rows: just stat info without value/score computations
  const rows = useMemo<StatRow[]>(() => {
    const preferCounty = effectiveAreaKind === "COUNTY";

    const result: StatRow[] = listStats.map((s) => {
      const entryMap = statDataById.get(s.id);
      const summaryMap = statSummariesById.get(s.id);

      // Determine stat type from available data
      const effectiveFallbackEntry = entryMap
        ? (preferCounty
            ? (entryMap.COUNTY ?? entryMap.ZIP ?? Object.values(entryMap)[0])
            : (entryMap.ZIP ?? entryMap.COUNTY ?? Object.values(entryMap)[0]))
        : undefined;
      const fallbackSummary = preferCounty
        ? (summaryMap?.COUNTY ?? summaryMap?.ZIP ?? (summaryMap ? Object.values(summaryMap)[0] : undefined))
        : (summaryMap?.ZIP ?? summaryMap?.COUNTY ?? (summaryMap ? Object.values(summaryMap)[0] : undefined));
      const fallbackType = effectiveFallbackEntry?.type ?? fallbackSummary?.type ?? "count";

      // Check if data is available
      const hasData = Boolean(effectiveFallbackEntry) || Boolean(fallbackSummary);

      return {
        id: s.id,
        name: s.label || s.name,
        score: 0,
        type: fallbackType,
        hasData,
        category: s.category,
      };
    });

    // Sort alphabetically
    result.sort((a, b) => a.name.localeCompare(b.name));

    return result;
  }, [listStats, statDataById, statSummariesById, effectiveAreaKind]);

  const filteredRows = useMemo(() => {
    if (!effectiveNormalizedQuery) return rows;
    return rows.filter((row) => {
      const normalizedName = normalizeForSearch(row.name);
      if (!normalizedName) return false;
      if (normalizedName.includes(effectiveNormalizedQuery) || effectiveNormalizedQuery.includes(normalizedName)) {
        return true;
      }
      const score = computeSimilarityFromNormalized(normalizedName, effectiveNormalizedQuery);
      return score >= STAT_SEARCH_MATCH_THRESHOLD;
    });
  }, [rows, effectiveNormalizedQuery]);

  // Keep parent fade state in sync with this list's current scroll position.
  useEffect(() => {
    reportScrollTop();
  }, [reportScrollTop, filteredRows.length, showAdvanced, showStatSearch]);

  const handleListScroll = useCallback(
    (event: React.UIEvent<HTMLDivElement>) => {
      onScrollTopChange?.(event.currentTarget.scrollTop <= 2);
    },
    [onScrollTopChange],
  );

  // Find the root parent and intermediate child by traversing up the hierarchy
  // This handles parent → child → grandchild relationships
  const { rootParentId, intermediateChildId } = useMemo(() => {
    if (!selectedStatId) return { rootParentId: null, intermediateChildId: null };

    // Build ancestor chain: [selectedStatId, parentId, grandparentId, ...]
    // Guard against cycles and unbounded depth in stat relations data
    const chain: string[] = [selectedStatId];
    let currentId = selectedStatId;
    const visited = new Set<string>([currentId]);

    while (chain.length < 10) {
      const parentRelations = statRelationsByChild.get(currentId);
      if (!parentRelations || parentRelations.length === 0) break;
      currentId = parentRelations[0].parentStatId;
      if (visited.has(currentId)) break;
      visited.add(currentId);
      chain.push(currentId);
    }

    if (chain.length === 1) {
      // selectedStatId has no parent, it is the root
      return { rootParentId: null, intermediateChildId: null };
    } else if (chain.length === 2) {
      // selectedStatId is a direct child of root parent
      return { rootParentId: chain[1], intermediateChildId: null };
    } else {
      // selectedStatId is a grandchild or deeper
      // rootParentId is last, intermediateChildId is second-to-last (direct child of root)
      return { rootParentId: chain[chain.length - 1], intermediateChildId: chain[chain.length - 2] };
    }
  }, [selectedStatId, statRelationsByChild]);

  // The stat ID to display in the sticky header - the root parent (if descendant selected) or the selected stat
  const displayStatId = rootParentId ?? selectedStatId;

  // The child ID to show as selected in the child dropdown
  // When grandchild is selected, show its parent (the intermediate child)
  // When child is selected, show the selected stat itself
  const activeChildId = intermediateChildId ?? (rootParentId ? selectedStatId : null);

  // Extract selected stat row (keep in list for placeholder)
  // When a child is selected, show the parent row in the sticky header instead
  const selectedStatRow = useMemo(() => {
    if (!displayStatId) return null;
    return rows.find((row) => row.id === displayStatId) ?? null;
  }, [rows, displayStatId]);

  const headerHasChartData = useMemo(() => {
    if (!selectedStatRow) return false;
    const targetStatId = selectedStatId ?? displayStatId;
    if (!targetStatId) return selectedStatRow.hasData;

    const entry = statDataById.get(targetStatId);
    if (entry) {
      for (const kind of SUPPORTED_KINDS) {
        const data = entry[kind]?.data;
        if (data && Object.keys(data).length > 0) return true;
      }
    }

    if (showAdvanced) {
      const seriesByKind = seriesByStatIdByKind.get(targetStatId);
      if (seriesByKind) {
        for (const entries of seriesByKind.values()) {
          if (entries && entries.length > 0) return true;
        }
      }
    }

    return selectedStatRow.hasData;
  }, [
    selectedStatRow,
    selectedStatId,
    displayStatId,
    statDataById,
    seriesByStatIdByKind,
    showAdvanced,
  ]);

  // Compute context average for selected stat header only (efficient: just one stat)
  const selectedStatContextAvg = useMemo(() => {
    const targetStatId = selectedStatId ?? displayStatId;
    if (!targetStatId) return null;

    const entryMap = statDataById.get(targetStatId);
    const summaryMap = statSummariesById.get(targetStatId);
    const preferCounty = effectiveAreaKind === "COUNTY";

    // Get the appropriate boundary entry
    const entry = entryMap
      ? (preferCounty
          ? (entryMap.COUNTY ?? entryMap.ZIP)
          : (entryMap.ZIP ?? entryMap.COUNTY))
      : undefined;

    // Get fallback from summary if no entry
    const summary = preferCounty
      ? (summaryMap?.COUNTY ?? summaryMap?.ZIP)
      : (summaryMap?.ZIP ?? summaryMap?.COUNTY);

    // Compute average
    let avgValue: number | null = null;
    if (entry) {
      avgValue = computeContextAverage(entry);
    } else if (summary && typeof summary.avg === "number" && Number.isFinite(summary.avg)) {
      avgValue = summary.avg;
    }

    if (avgValue === null || avgValue === 0) return null;

    // Determine label and type
    const label = preferCounty ? "State Avg" : "County Avg";
    const type = entry?.type ?? summary?.type ?? "count";

    return { value: avgValue, label, type };
  }, [selectedStatId, displayStatId, statDataById, statSummariesById, effectiveAreaKind]);

  // Get children of the displayed stat grouped by attribute, split into toggles vs dropdowns
  // Single-child attributes become toggles, multi-child attributes become dropdowns
  const { singleChildAttrs, multiChildAttrs, allChildrenByAttr } = useMemo(() => {
    if (!displayStatId) {
      return {
        singleChildAttrs: [] as Array<[string, StatRelation & { child: Stat | null }]>,
        multiChildAttrs: [] as Array<[string, Array<StatRelation & { child: Stat | null }>]>,
        allChildrenByAttr: new Map<string, Array<StatRelation & { child: Stat | null }>>(),
      };
    }
    const byAttribute = statRelationsByParent.get(displayStatId);
    if (!byAttribute || byAttribute.size === 0) {
      return {
        singleChildAttrs: [] as Array<[string, StatRelation & { child: Stat | null }]>,
        multiChildAttrs: [] as Array<[string, Array<StatRelation & { child: Stat | null }>]>,
        allChildrenByAttr: new Map<string, Array<StatRelation & { child: Stat | null }>>(),
      };
    }

    const single: Array<[string, StatRelation & { child: Stat | null }]> = [];
    const multi: Array<[string, Array<StatRelation & { child: Stat | null }>]> = [];
    const filteredByAttribute = new Map<string, Array<StatRelation & { child: Stat | null }>>();

    for (const [attrName, relations] of byAttribute) {
      // Hide "Undefined" attribute group from the sidebar UI.
      if (attrName === UNDEFINED_STAT_ATTRIBUTE) continue;
      // Filter out orphaned relations (relation exists but the target stat row is missing).
      const validRelations = relations.filter((r) => r.child !== null);
      if (validRelations.length === 0) continue;
      filteredByAttribute.set(attrName, validRelations);

      if (validRelations.length === 1) {
        single.push([attrName, validRelations[0]]);
      } else {
        multi.push([attrName, validRelations]);
      }
    }

    return {
      singleChildAttrs: single.sort(([a], [b]) => a.localeCompare(b)),
      multiChildAttrs: multi.sort(([a], [b]) => a.localeCompare(b)),
      allChildrenByAttr: filteredByAttribute,
    };
  }, [displayStatId, statRelationsByParent]);

  // Find all unique grandchild attributes (attributes of children's children)
  const grandchildAttributes = useMemo(() => {
    if (!displayStatId) {
      return { allAttributes: [] as string[], availableForChild: new Map<string, Set<string>>() };
    }

    const allAttrsSet = new Set<string>();
    const availableForChild = new Map<string, Set<string>>();

    // Look at each child of the displayed parent (from all attributes)
    for (const [, relations] of allChildrenByAttr) {
      for (const relation of relations) {
        const childId = relation.childStatId;
        const grandchildByAttribute = statRelationsByParent.get(childId);
        if (grandchildByAttribute && grandchildByAttribute.size > 0) {
          const attrsForThisChild = new Set<string>();
          for (const [attrName, relations] of grandchildByAttribute) {
            // Hide "Undefined" attribute group from the sidebar UI.
            if (attrName === UNDEFINED_STAT_ATTRIBUTE) continue;
            // Only expose attributes that have at least one valid grandchild stat.
            if (!relations.some((r) => r.child !== null)) continue;
            allAttrsSet.add(attrName);
            attrsForThisChild.add(attrName);
          }
          if (attrsForThisChild.size > 0) {
            availableForChild.set(childId, attrsForThisChild);
          }
        }
      }
    }

    return {
      allAttributes: Array.from(allAttrsSet).sort(),
      availableForChild,
    };
  }, [displayStatId, allChildrenByAttr, statRelationsByParent]);

  // Combine toggle attributes: single-child attrs + grandchild attrs (deduplicated)
  const allToggleAttributes = useMemo(() => {
    const attrs = new Set<string>();
    for (const [attrName] of singleChildAttrs) {
      attrs.add(attrName);
    }
    for (const attr of grandchildAttributes.allAttributes) {
      attrs.add(attr);
    }
    return Array.from(attrs).sort();
  }, [singleChildAttrs, grandchildAttributes.allAttributes]);

  // Track the user's preferred toggle attribute (e.g. "Percent" vs "Change").
  // This persists when switching children so the selection stays consistent.
  const [preferredToggleAttr, setPreferredToggleAttr] = useState<string | null>(null);

  // Synchronize preferredToggleAttr when selectedStatId changes externally (e.g. from map chips)
  useEffect(() => {
    if (!selectedStatId) return;

    // Find the attribute associated with the selected stat by looking at its parent relations
    const relations = statRelationsByChild.get(selectedStatId);
    if (!relations || relations.length === 0) return;

    // We look for an attribute that matches one of our toggles in the ancestry
    // Guard against cycles with visited set and depth limit
    let currId = selectedStatId;
    const seen = new Set<string>([currId]);
    while (currId) {
      const rels = statRelationsByChild.get(currId);
      if (!rels || rels.length === 0) break;
      const attr = rels[0].statAttribute;
      if (allToggleAttributes.includes(attr)) {
        setPreferredToggleAttr(attr);
        break;
      }
      currId = rels[0].parentStatId;
      // Stop if we hit the root displayed stat or a cycle
      if (currId === displayStatId || seen.has(currId)) break;
      seen.add(currId);
    }
  }, [selectedStatId, statRelationsByChild, allToggleAttributes, displayStatId]);

  // Check if a toggle attribute is available (can be clicked)
  const isToggleAttrAvailable = (attr: string): boolean => {
    // If a dropdown child is selected, only available if that child has grandchildren with this attr
    const hasDropdownChild = isChildFromDropdown(activeChildId);
    if (hasDropdownChild && activeChildId) {
      const available = grandchildAttributes.availableForChild.get(activeChildId);
      return available?.has(attr) ?? false;
    }

    // No dropdown child selected - check if it's a single-child attr or grandchild-only attr
    const isSingleChildAttr = singleChildAttrs.some(([a]) => a === attr);
    if (isSingleChildAttr) return true;

    // Check grandchild availability for active child
    if (!activeChildId) return false;
    const available = grandchildAttributes.availableForChild.get(activeChildId);
    return available?.has(attr) ?? false;
  };

  // Check if a toggle attribute is currently active (derived from selection + enabled state)
  const isToggleAttrActive = (attr: string): boolean => {
    // Only the preferred toggle can be active.
    if (preferredToggleAttr !== attr) return false;

    // Then check if it's actually in effect (i.e., we're at or below that level)
    if (!selectedStatId || !rootParentId) return false;

    // If a dropdown child is selected, treat toggles as applying to that child's grandchildren.
    // This avoids confusing "stuck active" behavior when an attribute name (e.g. "Percent") exists
    // both as a direct child attribute of the parent and as a grandchild attribute under the dropdown child.
    const hasDropdownChild = isChildFromDropdown(activeChildId);
    if (hasDropdownChild && activeChildId) {
      const grandchildByAttribute = statRelationsByParent.get(activeChildId);
      const relations = grandchildByAttribute?.get(attr);
      return relations?.some((r) => r.childStatId === selectedStatId) ?? false;
    }

    // Check if it's active via single-child attr
    const singleChild = singleChildAttrs.find(([a]) => a === attr);
    if (singleChild) {
      const [, relation] = singleChild;
      if (selectedStatId === relation.childStatId) return true;
      if (intermediateChildId === relation.childStatId) return true;
    }

    // Check grandchild case
    if (intermediateChildId) {
      const grandchildByAttribute = statRelationsByParent.get(intermediateChildId);
      const relations = grandchildByAttribute?.get(attr);
      return relations?.some((r) => r.childStatId === selectedStatId) ?? false;
    }

    return false;
  };

  // Check if a child ID was selected from a multi-child dropdown (vs single-child toggle)
  const isChildFromDropdown = (childId: string | null): boolean => {
    if (!childId) return false;
    return multiChildAttrs.some(([, relations]) =>
      relations.some((r) => r.childStatId === childId)
    );
  };

  // Handle toggle click - chains through hierarchy
  const handleToggle = (attr: string) => {
    if (!onStatSelect || !displayStatId) return;

    const isPreferred = preferredToggleAttr === attr;
    const singleChild = singleChildAttrs.find(([a]) => a === attr);
    const hasDropdownChild = isChildFromDropdown(activeChildId);

    // IMPORTANT UX DETAIL:
    // `preferredToggleAttr` is a persisted selection (so toggles can stay on when switching children).
    // But for single-child attributes like "Percent" vs "Change (...)", users expect these buttons to
    // behave like a *selection* (radio-ish), not like an on/off flag. The previous logic treated
    // "enabled but not currently selected" as "turn off", which caused a 2-click switch.
    //
    // Only treat a click as "turn OFF" when this toggle is actually *in effect* for the current
    // selection. Otherwise, interpret it as "select this toggle".
    const isToggleInEffect = (() => {
      if (!selectedStatId) return false;

      // In dropdown-child mode, toggles apply to the selected child's grandchildren.
      if (hasDropdownChild && activeChildId) {
        const grandchildByAttribute = statRelationsByParent.get(activeChildId);
        const relations = grandchildByAttribute?.get(attr);
        return relations?.some((r) => r.childStatId === selectedStatId) ?? false;
      }

      // Single-child attribute toggle: in effect if we're on that child (or on a grandchild under it)
      if (singleChild) {
        const [, relation] = singleChild;
        return selectedStatId === relation.childStatId || intermediateChildId === relation.childStatId;
      }

      // Grandchild toggle: in effect only if the currently selected stat is a grandchild that matches
      // this attribute under the current intermediate child.
      if (intermediateChildId) {
        const grandchildByAttribute = statRelationsByParent.get(intermediateChildId);
        const relations = grandchildByAttribute?.get(attr);
        return relations?.some((r) => r.childStatId === selectedStatId) ?? false;
      }

      return false;
    })();

    if (isPreferred && isToggleInEffect) {
      // Turn OFF: clear preferred selection
      setPreferredToggleAttr(null);

      // If a child is selected from dropdown, stay on that child (just remove grandchild)
      if (hasDropdownChild && activeChildId) {
        onStatSelect(activeChildId);
      } else if (singleChild) {
        // Only single-child toggle was active, go back to parent
        onStatSelect(displayStatId);
      } else if (intermediateChildId) {
        // Grandchild-only toggle under a single-child path: go back up to the intermediate child.
        onStatSelect(intermediateChildId);
      }
      // If neither, no selection change needed
    } else {
      // Turn ON: set preferred selection, then select down the hierarchy
      setPreferredToggleAttr(attr);

      // If a child is selected from dropdown, chain to that child's grandchild
      if (hasDropdownChild && activeChildId) {
        const grandchildByAttribute = statRelationsByParent.get(activeChildId);
        const relations = grandchildByAttribute?.get(attr);
        const target = relations?.find((r) => r.child !== null);
        if (target) {
          onStatSelect(target.childStatId);
        }
        // If no grandchild available for this attr, just stay on child (toggle is enabled for future)
      } else if (singleChild) {
        // No dropdown child selected, use single-child toggle path
        const [, relation] = singleChild;
        const singleChildId = relation.childStatId;
        const grandchildByAttribute = statRelationsByParent.get(singleChildId);
        const grandchildRelations = grandchildByAttribute?.get(attr);
        const target = grandchildRelations?.find((r) => r.child !== null);
        if (target) {
          onStatSelect(target.childStatId);
        } else {
          onStatSelect(singleChildId);
        }
      }
    }
  };

  // Handle child selection from dropdown.
  // If the preferred toggle applies to this child, chain to its matching grandchild.
  const handleChildSelect = (childId: string) => {
    if (!onStatSelect) return;

    // If the preferred toggle applies to this child, chain to that grandchild.
    if (preferredToggleAttr) {
      const attr = preferredToggleAttr;
      const grandchildByAttribute = statRelationsByParent.get(childId);
      const relations = grandchildByAttribute?.get(attr);
      const target = relations?.find((r) => r.child !== null);
      if (target) {
        // Chain to grandchild with the enabled toggle attribute
        onStatSelect(target.childStatId);
        return;
      }
    }

    // No applicable toggle, just select the child
    onStatSelect(childId);
  };

  // Handle child deselection from dropdown - go back to parent.
  // If the preferred toggle has a single-child path, chain through it.
  const handleChildDeselect = () => {
    if (!onStatSelect || !displayStatId) return;

    // If the preferred toggle has a single-child path, chain through it.
    if (preferredToggleAttr) {
      const attr = preferredToggleAttr;
      const singleChild = singleChildAttrs.find(([a]) => a === attr);
      if (singleChild) {
        const [, relation] = singleChild;
        const singleChildId = relation.childStatId;
        // Check if this single child has grandchildren with the same attribute
        const grandchildByAttribute = statRelationsByParent.get(singleChildId);
        const grandchildRelations = grandchildByAttribute?.get(attr);
        const target = grandchildRelations?.find((r) => r.child !== null);
        if (target) {
          onStatSelect(target.childStatId);
        } else {
          onStatSelect(singleChildId);
        }
        return;
      }
    }

    // No enabled single-child toggle, just go to parent
    onStatSelect(displayStatId);
  };

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Fixed area: Pinned selected stat */}
      {selectedStatRow && (
        <div className="border-t border-b border-slate-200 dark:border-slate-700 px-4 pt-0 pb-3 shadow-md bg-slate-50 dark:bg-slate-800/50">
          <ul>
            <StatListItem
              row={selectedStatRow}
              isSelected={true}
              isHeader={true}
              isSecondary={false}
              onStatSelect={onStatSelect}
              onRetryStatData={showAdvanced ? onRetryStatData : undefined}
              hasDataOverride={headerHasChartData}
              categoryLabel={!categoryFilter && selectedStatRow.category ? getCategoryLabel(selectedStatRow.category) : null}
              contextAvg={selectedStatContextAvg}
              grandchildToggles={allToggleAttributes.map((attr) => ({
                attr,
                isActive: isToggleAttrActive(attr),
                isAvailable: isToggleAttrAvailable(attr),
                onToggle: handleToggle,
              }))}
            />
          </ul>
          {/* Child stat attribute dropdowns (only for multi-child attributes) */}
          {multiChildAttrs.length > 0 && (
            <div className="mt-2.5 space-y-2.5">
              {multiChildAttrs.map(([attributeName, relations]) => (
                <ChildStatDropdown
                  key={attributeName}
                  attributeName={attributeName}
                  relations={relations}
                  selectedChildId={activeChildId}
                  onStatSelect={(childId) => childId && handleChildSelect(childId)}
                  onDeselect={handleChildDeselect}
                />
              ))}
            </div>
          )}

          {/* Embedded StatViz chart - only shown in advanced mode; min-h reserves
             space so the stat list doesn't jump when the chart loads in */}
          {showAdvanced && (
            <div className="min-h-[146px] flex items-center justify-center">
              {areaEntries.length === 0 ? (
                <div className="text-[10px] text-slate-400 dark:text-slate-500 italic text-center">
                  Shift+click an area(s) to see charts
                </div>
              ) : (
                <StatViz
                  statsById={statsById}
                  seriesByStatIdByKind={seriesByStatIdByKind}
                  statDataById={statDataById}
                  selectedAreas={selectedAreas}
                  pinnedAreas={pinnedAreas}
                  selectedStatId={selectedStatId}
                  hoveredArea={hoveredArea}
                  onHoverArea={onHoverArea}
                  areaNameLookup={areaNameLookup}
                  activeAreaKind={activeAreaKind}
                  getZipParentCounty={getZipParentCounty}
                  zipScopeCountyName={zipScopeDisplayName}
                  stateAvg={selectedStatContextAvg?.value ?? null}
                  selectedStatLoading={selectedStatLoading}
                  onRetryStatData={onRetryStatData}
                  embedded={true}
                />
              )}
            </div>
          )}
        </div>
      )}

      {/* Scrollable content */}
      <div
        ref={scrollContainerRef}
        onScroll={handleListScroll}
        className="flex-1 overflow-y-auto px-4 pt-2 pb-6 bg-slate-100 dark:bg-slate-800"
      >
        {showStatSearch && (
          <div className="pt-2 mb-2">
            <div className="flex items-center gap-2 rounded-2xl border border-slate-200/70 bg-white/70 px-3 py-2 shadow-sm transition-colors focus-within:border-brand-200 focus-within:bg-brand-50 dark:border-slate-700/70 dark:bg-slate-900/50 dark:focus-within:border-slate-600 dark:focus-within:bg-slate-800/70">
              <MagnifyingGlassIcon className="h-4 w-4 text-slate-400 dark:text-slate-500" />
              <input
                type="text"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Search stats"
                aria-label="Search statistics"
                className="w-full bg-transparent text-sm text-slate-700 placeholder:text-slate-400 focus:outline-none dark:text-slate-200 dark:placeholder:text-slate-500"
                spellCheck={false}
              />
              {searchQuery.trim().length > 0 && (
                <button
                  type="button"
                  onClick={() => setSearchQuery("")}
                  className="rounded-full p-1 text-slate-400 transition hover:bg-slate-200 hover:text-slate-600 dark:text-slate-500 dark:hover:bg-slate-700 dark:hover:text-slate-300"
                  aria-label="Clear search"
                >
                  <XMarkIcon className="h-4 w-4" />
                </button>
              )}
            </div>
          </div>
        )}
        {filteredRows.length === 0 ? (
          <p className="px-1 pt-2 text-xs text-slate-500 dark:text-slate-400">
            {effectiveNormalizedQuery
              ? "No statistics match your search."
              : "No statistics to display for the current selection."}
          </p>
        ) : (
          <ul className="space-y-2">
            {filteredRows.map((row) => (
              <StatListItem
                key={row.id}
                row={row}
                isSelected={displayStatId === row.id}
                isSecondary={secondaryStatId === row.id}
                onStatSelect={onStatSelect}
                categoryLabel={!categoryFilter && row.category ? getCategoryLabel(row.category) : null}
              />
            ))}
          </ul>
        )}

        {/* Footer: show hidden stat count when a category filter is active */}
        {categoryFilter && hiddenByCategoryCount > 0 && onClearCategory && (
          <button
            type="button"
            className="block w-full text-left text-xs font-normal text-brand-300 hover:text-brand-800 dark:text-brand-400 dark:hover:text-brand-200 px-1 pb-4 pt-3 transition-colors"
            onClick={onClearCategory}
          >
            {hiddenByCategoryCount} more stat{hiddenByCategoryCount === 1 ? "" : "s"} available (Clear Category)
          </button>
        )}
      </div>
    </div>
  );
};

interface GrandchildAttrToggle {
  attr: string;
  isActive: boolean;
  isAvailable: boolean;
  onToggle: (attr: string) => void;
}

interface StatListItemProps {
  row: StatRow;
  isSelected: boolean;
  isSecondary: boolean;
  onStatSelect?: (statId: string | null, meta?: StatSelectMeta) => void;
  onRetryStatData?: (statId: string) => void;
  hasDataOverride?: boolean;
  grandchildToggles?: GrandchildAttrToggle[];
  isHeader?: boolean;
  categoryLabel?: string | null;
  /** Context average to display (only for header) */
  contextAvg?: { value: number; label: string; type: string } | null;
}

const StatListItem = ({
  row,
  isSelected,
  isSecondary,
  onStatSelect,
  onRetryStatData,
  hasDataOverride,
  grandchildToggles = [],
  isHeader = false,
  categoryLabel = null,
  contextAvg = null,
}: StatListItemProps) => {
  const handleClick = (e: React.MouseEvent) => {
    if (e.shiftKey) {
      e.preventDefault();
      onStatSelect?.(row.id, { shiftKey: true });
      return;
    }

    if (isSelected) {
      onStatSelect?.(null, { clear: true });
    } else {
      onStatSelect?.(row.id);
    }
  };

  const common =
    "group relative flex items-center justify-between rounded-2xl border px-3 py-2 shadow-sm transition-colors cursor-pointer select-none";

  const className = isHeader
    ? "group relative flex items-center justify-between px-0 pt-2.5 pb-0 transition-colors cursor-pointer select-none"
    : isSelected
    ? `${common} border-2 border-brand-500 bg-brand-50 dark:border-brand-400 dark:bg-brand-400/15`
    : isSecondary
    ? `${common} border-2 border-teal-500 bg-teal-50 dark:border-teal-400 dark:bg-teal-400/15`
    : `${common} border-slate-200/70 bg-white/70 hover:border-brand-200 hover:bg-brand-50 dark:border-slate-700/70 dark:bg-slate-900/50 dark:hover:border-slate-600 dark:hover:bg-slate-800/70`;

  const hasData = typeof hasDataOverride === "boolean" ? hasDataOverride : row.hasData;

  return (
    <li className={className} onClick={handleClick}>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`text-sm ${isHeader ? "font-medium" : "font-normal"} text-slate-600 dark:text-slate-300`}>
            {row.name}
          </span>
          {/* Context average display - only shown in header when data available */}
          {isHeader && contextAvg && (
            <span className="text-[11px] text-slate-400 dark:text-slate-500 font-normal whitespace-nowrap">
              {contextAvg.label}: {formatStatValue(contextAvg.value, contextAvg.type)}
            </span>
          )}
          {!isHeader && categoryLabel && (
            <span className="text-[10px] uppercase tracking-wider text-slate-400 dark:text-slate-500 font-light ml-1">
              {categoryLabel}
            </span>
          )}
          {!isHeader && grandchildToggles.length > 0 && (
            <div className="flex items-center gap-1">
              {grandchildToggles.map((toggle) => (
                <button
                  key={toggle.attr}
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (toggle.isAvailable) {
                      toggle.onToggle(toggle.attr);
                    }
                  }}
                  disabled={!toggle.isAvailable}
                  className={`px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide rounded border shadow-sm transition-colors ${
                    toggle.isActive && toggle.isAvailable
                      ? "border-brand-600 bg-brand-500 text-white shadow-md dark:border-brand-400"
                      : toggle.isAvailable
                      ? "border-slate-300 bg-white text-slate-600 hover:bg-slate-100 hover:border-slate-400 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-300 dark:hover:bg-slate-600 dark:hover:border-slate-500"
                      : "border-slate-200 bg-slate-100/50 text-slate-400 cursor-not-allowed dark:border-slate-700 dark:bg-slate-800/30 dark:text-slate-600"
                  }`}
                  title={toggle.isAvailable ? `Toggle ${toggle.attr} breakdown` : `${toggle.attr} not available for current selection`}
                >
                  {toggle.attr}
                </button>
              ))}
            </div>
          )}
        </div>

        {isHeader && grandchildToggles.length > 0 && (
          <div className="flex items-center gap-1 mt-2.5 mb-0">
            <label className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500 whitespace-nowrap mr-2">
              Options:
            </label>
            {grandchildToggles.map((toggle) => (
              <button
                key={toggle.attr}
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  if (toggle.isAvailable) {
                    toggle.onToggle(toggle.attr);
                  }
                }}
                disabled={!toggle.isAvailable}
                className={`px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide rounded border shadow-sm transition-colors ${
                  toggle.isActive && toggle.isAvailable
                    ? "border-brand-600 bg-brand-500 text-white shadow-md dark:border-brand-400"
                    : toggle.isAvailable
                    ? "border-slate-300 bg-white text-slate-600 hover:bg-slate-100 hover:border-slate-400 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-300 dark:hover:bg-slate-600 dark:hover:border-slate-500"
                    : "border-slate-200 bg-slate-100/50 text-slate-400 cursor-not-allowed dark:border-slate-700 dark:bg-slate-800/30 dark:text-slate-600"
                }`}
                title={toggle.isAvailable ? `Toggle ${toggle.attr} breakdown` : `${toggle.attr} not available for current selection`}
              >
                {toggle.attr}
              </button>
            ))}
          </div>
        )}

        {/* Loading state for header or click to load for items */}
        {!hasData && (
          <div className="mt-0.5 text-[11px] text-slate-400 dark:text-slate-500">
            {isHeader ? (
              <div className="flex items-center gap-2">
                <span className="italic">Loading data...</span>
                {onRetryStatData && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onRetryStatData(row.id);
                    }}
                    className="text-[11px] font-medium text-indigo-600 hover:text-indigo-700 dark:text-indigo-400 dark:hover:text-indigo-300"
                  >
                    retry
                  </button>
                )}
              </div>
            ) : (
              <span className="italic">Click to load data</span>
            )}
          </div>
        )}
      </div>

      {/* Close button for selected stat */}
      {isSelected && (
        <div className={`flex items-center ${isHeader ? "self-start pt-0.5" : ""}`}>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onStatSelect?.(null, { clear: true });
            }}
            className="flex h-5 w-5 items-center justify-center rounded text-slate-400 hover:bg-slate-200 hover:text-slate-600 dark:text-slate-500 dark:hover:bg-slate-700 dark:hover:text-slate-300 transition-colors"
            aria-label="Clear selection"
          >
            <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
            </svg>
          </button>
        </div>
      )}
    </li>
  );
};
