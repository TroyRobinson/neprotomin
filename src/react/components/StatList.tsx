import { useMemo, useState } from "react";
import { MagnifyingGlassIcon, XMarkIcon } from "@heroicons/react/24/outline";
import type { Stat, StatRelation, StatRelationsByParent, StatRelationsByChild } from "../../types/stat";
import { UNDEFINED_STAT_ATTRIBUTE } from "../../types/stat";
import { formatStatValue } from "../../lib/format";
import type { StatBoundaryEntry } from "../hooks/useStats";
import { computeSimilarityFromNormalized, normalizeForSearch } from "../lib/fuzzyMatch";
import { CustomSelect } from "./CustomSelect";

// Feature flag: Hide stat values when at county level with no selection
const HIDE_COUNTY_STAT_VALUES_WITHOUT_SELECTION = true;
const STAT_SEARCH_MATCH_THRESHOLD = 0.4;

type SupportedAreaKind = "ZIP" | "COUNTY";
type SelectedAreasMap = Partial<Record<SupportedAreaKind, string[]>>;

type StatDataById = Map<string, Partial<Record<SupportedAreaKind, StatBoundaryEntry>>>;

type StatSelectMeta = { shiftKey?: boolean; clear?: boolean };

type AreaEntry = { kind: SupportedAreaKind; code: string };

type StatRow = {
  id: string;
  name: string;
  value: number;
  score: number;
  type: string;
  contextAvg: number;
  hasData: boolean;
  goodIfUp?: boolean;
  aggregationMethod: "sum" | "average" | "raw";
  aggregationDescription: string;
};

interface StatListProps {
  statsById?: Map<string, Stat>;
  statDataById?: StatDataById;
  statRelationsByParent?: StatRelationsByParent;
  statRelationsByChild?: StatRelationsByChild;
  selectedAreas?: SelectedAreasMap;
  activeAreaKind?: SupportedAreaKind | null;
  areaNameLookup?: (kind: SupportedAreaKind, code: string) => string;
  categoryFilter?: string | null;
  secondaryStatId?: string | null;
  selectedStatId?: string | null;
  onStatSelect?: (statId: string | null, meta?: StatSelectMeta) => void;
  variant?: "desktop" | "mobile";
  zipScopeDisplayName?: string | null;
  countyScopeDisplayName?: string | null;
}

const SUPPORTED_KINDS: SupportedAreaKind[] = ["ZIP", "COUNTY"];

const computeContextAverage = (entry: StatBoundaryEntry | undefined): number => {
  if (!entry) return 0;
  const values = Object.values(entry.data || {});
  const nums = values.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  if (nums.length === 0) return 0;
  return nums.reduce((sum, v) => sum + v, 0) / nums.length;
};

const computeTotal = (entry: StatBoundaryEntry | undefined): number => {
  if (!entry) return 0;
  const values = Object.values(entry.data || {});
  const nums = values.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  return nums.reduce((sum, v) => sum + v, 0);
};

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
      <label className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500 whitespace-nowrap min-w-[60px]">
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
        className="flex-1"
      />
    </div>
  );
};

export const StatList = ({
  statsById = new Map(),
  statDataById = new Map(),
  statRelationsByParent = new Map(),
  statRelationsByChild = new Map(),
  selectedAreas,
  activeAreaKind = null,
  areaNameLookup,
  categoryFilter = null,
  secondaryStatId = null,
  selectedStatId = null,
  onStatSelect,
  variant = "desktop",
  zipScopeDisplayName = null,
  countyScopeDisplayName = null,
}: StatListProps) => {
  const areaEntries = useMemo(() => buildAreaEntries(selectedAreas), [selectedAreas]);
  const [searchQuery, setSearchQuery] = useState("");
  const normalizedQuery = useMemo(() => normalizeForSearch(searchQuery), [searchQuery]);

  // Determine which boundary level to use: prefer activeAreaKind if set, otherwise infer from selections
  const effectiveAreaKind = useMemo<SupportedAreaKind | null>(() => {
    if (activeAreaKind) return activeAreaKind;
    const hasCountySelection = areaEntries.some((area) => area.kind === "COUNTY");
    const hasZipSelection = areaEntries.some((area) => area.kind === "ZIP");
    if (hasCountySelection && !hasZipSelection) return "COUNTY";
    if (hasZipSelection && !hasCountySelection) return "ZIP";
    return null;
  }, [activeAreaKind, areaEntries]);

  const averageLabel = useMemo(() => {
    // Only show context average label when areas are actually selected
    if (areaEntries.length === 0) return null;
    if (effectiveAreaKind === "COUNTY") return "State Avg";
    if (effectiveAreaKind === "ZIP") return "City Avg";
    return null;
  }, [effectiveAreaKind, areaEntries.length]);

  // Set of stat IDs that are children of some parent (should be hidden from main list)
  const childIdSet = useMemo(
    () => new Set(Array.from(statRelationsByChild.keys())),
    [statRelationsByChild]
  );

  const rows = useMemo<StatRow[]>(() => {
    const stats: Stat[] = Array.from(statsById.values()).filter((s) => {
      // Show stats unless explicitly marked inactive; newly created stats default to active/undefined.
      if (s.active === false) return false;
      // Hide child stats from the main list - they appear via parent's dropdown
      if (childIdSet.has(s.id)) return false;
      // Apply category filter if provided
      if (categoryFilter) return s.category === categoryFilter;
      return true;
    });

    const result: StatRow[] = [];

    // Use effectiveAreaKind to determine which dataset to prefer
    const preferCounty = effectiveAreaKind === "COUNTY";

    for (const s of stats) {
      const entryMap = statDataById.get(s.id);
      const fallbackEntry = entryMap
        ? (entryMap.COUNTY ?? entryMap.ZIP ?? Object.values(entryMap)[0])
        : undefined;
      if (!fallbackEntry) {
        result.push({
          id: s.id,
          name: s.label || s.name,
          value: 0,
          score: 0,
          type: "count",
          contextAvg: 0,
          hasData: false,
          goodIfUp: s.goodIfUp,
          aggregationMethod: "raw",
          aggregationDescription: "",
        });
        continue;
      }

      const contextAvgByKind = new Map<SupportedAreaKind, number>();
      for (const kind of SUPPORTED_KINDS) {
        const entry = entryMap[kind];
        if (entry) contextAvgByKind.set(kind, computeContextAverage(entry));
      }

      // Use COUNTY data when at county level, otherwise prefer ZIP
      const effectiveFallbackEntry = preferCounty
        ? (entryMap.COUNTY ?? entryMap.ZIP ?? Object.values(entryMap)[0])
        : (entryMap.ZIP ?? entryMap.COUNTY ?? Object.values(entryMap)[0]);
      if (!effectiveFallbackEntry) continue;

      const fallbackContextAvg = preferCounty
        ? (contextAvgByKind.get("COUNTY") ?? contextAvgByKind.get("ZIP") ?? computeContextAverage(effectiveFallbackEntry))
        : (contextAvgByKind.get("ZIP") ?? contextAvgByKind.get("COUNTY") ?? computeContextAverage(effectiveFallbackEntry));

      const valuesForSelection = areaEntries
        .map((area) => {
          const entry = entryMap[area.kind];
          if (!entry) return null;
          const raw = entry.data?.[area.code];
          if (typeof raw !== "number" || !Number.isFinite(raw)) return null;
          return { area, entry, value: raw };
        })
        .filter((v): v is { area: AreaEntry; entry: StatBoundaryEntry; value: number } => v !== null);

      const isPercent = effectiveFallbackEntry.type === "percent";
      
      let displayValue = fallbackContextAvg;
      let aggregationMethod: "sum" | "average" | "raw" = "average";
      let aggregationDescription = "";
      
      if (areaEntries.length === 0) {
        // No selection: sum all values (or average for percentages)
        // County level: sum/average all Oklahoma counties
        // ZIP level: sum/average all ZIPs in the viewport county
        aggregationMethod = isPercent ? "average" : "sum";
        const method = isPercent ? "Average" : "Sum";
        if (preferCounty) {
          // County level: "Sum of All OK Counties" or "Average of all OK Counties"
          aggregationDescription = `${method} of ${countyScopeDisplayName ? `All ${countyScopeDisplayName} Counties` : "All OK Counties"}`;
        } else {
          // ZIP level: "Sum of all Tulsa County ZIPs" or "Average of all Tulsa County ZIPs"
          const countyName = zipScopeDisplayName ? `${zipScopeDisplayName} County` : "County";
          aggregationDescription = `${method} of all ${countyName} ZIPs`;
        }
        displayValue = isPercent ? computeContextAverage(fallbackEntry) : computeTotal(fallbackEntry);
      } else if (areaEntries.length === 1 && valuesForSelection.length === 1) {
        // Single selection: show the raw value
        aggregationMethod = "raw";
        const areaName = areaNameLookup
          ? areaNameLookup(valuesForSelection[0].area.kind, valuesForSelection[0].area.code)
          : `${valuesForSelection[0].area.kind} ${valuesForSelection[0].area.code}`;
        aggregationDescription = areaName;
        displayValue = valuesForSelection[0].value;
      } else if (areaEntries.length > 1 && valuesForSelection.length > 0) {
        // Multiple selections: sum the values (or average for percentages)
        aggregationMethod = isPercent ? "average" : "sum";
        const method = isPercent ? "Average" : "Sum";
        const areaType = preferCounty ? "Counties" : "ZIPs";
        aggregationDescription = `${method} of Selected ${areaType}`;
        if (isPercent) {
          displayValue = valuesForSelection.reduce((sum, item) => sum + item.value, 0) / valuesForSelection.length;
        } else {
          displayValue = valuesForSelection.reduce((sum, item) => sum + item.value, 0);
        }
      }

      const normalizedDiffs = valuesForSelection.map(({ value, entry, area }) => {
        const range = Math.max(entry.max - entry.min, 0);
        const contextAvg = contextAvgByKind.get(area.kind) ?? fallbackContextAvg;
        if (range <= 0) return 0;
        return Math.abs(value - contextAvg) / range;
      });
      const score = normalizedDiffs.length
        ? normalizedDiffs.reduce((sum, v) => sum + v, 0) / normalizedDiffs.length
        : 0;

      result.push({
        id: s.id,
        name: s.label || s.name,
        value: displayValue,
        score,
        type: effectiveFallbackEntry.type,
        contextAvg: fallbackContextAvg,
        hasData: valuesForSelection.length > 0 || areaEntries.length === 0,
        goodIfUp: s.goodIfUp,
        aggregationMethod,
        aggregationDescription,
      });
    }

    if (areaEntries.length === 0) {
      result.sort((a, b) => a.name.localeCompare(b.name));
    } else {
      result.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
    }

    return result;
  }, [statsById, statDataById, areaEntries, categoryFilter, effectiveAreaKind, zipScopeDisplayName, countyScopeDisplayName, areaNameLookup, childIdSet]);

  const filteredRows = useMemo(() => {
    if (!normalizedQuery) return rows;
    return rows.filter((row) => {
      const normalizedName = normalizeForSearch(row.name);
      if (!normalizedName) return false;
      if (normalizedName.includes(normalizedQuery) || normalizedQuery.includes(normalizedName)) {
        return true;
      }
      const score = computeSimilarityFromNormalized(normalizedName, normalizedQuery);
      return score >= STAT_SEARCH_MATCH_THRESHOLD;
    });
  }, [rows, normalizedQuery]);

  const subtitle = useMemo(() => {
    if (areaEntries.length === 1) {
      const area = areaEntries[0];
      const label = areaNameLookup ? areaNameLookup(area.kind, area.code) : `${area.kind} ${area.code}`;
      return `Most significant stats for ${label}`;
    }
    if (areaEntries.length > 1) {
      return `Most significant stats for Selected Areas (${areaEntries.length})`;
    }
    return null;
  }, [areaEntries, areaNameLookup]);

  // Find the root parent and intermediate child by traversing up the hierarchy
  // This handles parent → child → grandchild relationships
  const { rootParentId, intermediateChildId } = useMemo(() => {
    if (!selectedStatId) return { rootParentId: null, intermediateChildId: null };

    // Build ancestor chain: [selectedStatId, parentId, grandparentId, ...]
    const chain: string[] = [selectedStatId];
    let currentId = selectedStatId;

    while (true) {
      const parentRelations = statRelationsByChild.get(currentId);
      if (!parentRelations || parentRelations.length === 0) break;
      currentId = parentRelations[0].parentStatId;
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
        <div className="border-b border-slate-200 dark:border-slate-700 px-4 pt-0 pb-2 shadow-md">
          <ul>
            <StatListItem
              row={selectedStatRow}
              isSelected={true}
              isSecondary={false}
              averageLabel={averageLabel}
              onStatSelect={onStatSelect}
              hideValue={HIDE_COUNTY_STAT_VALUES_WITHOUT_SELECTION && effectiveAreaKind === "COUNTY" && areaEntries.length === 0}
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
            <div className="mt-2 space-y-2">
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
        </div>
      )}

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto px-4 pt-2 pb-6">
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
        {subtitle && (
          <p className="px-1 pt-2 pb-2 text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
            {subtitle}
          </p>
        )}
        {filteredRows.length === 0 ? (
          <p className="px-1 pt-2 text-xs text-slate-500 dark:text-slate-400">
            {normalizedQuery
              ? "No statistics match your search."
              : "No statistics to display for the current selection."}
          </p>
        ) : (
          <ul className="space-y-2">
            {filteredRows.map((row) => {
              // Render placeholder line for selected/displayed stat (pinned above)
              // Use displayStatId to show placeholder for parent when child is selected
              if (displayStatId === row.id) {
                return (
                  <li
                    key={row.id}
                    className="py-2"
                    aria-hidden="true"
                  >
                    {secondaryStatId === null && variant !== "mobile" ? (
                      <div className="flex items-center gap-2">
                        <div className="h-px flex-1 bg-brand-300/40 dark:bg-brand-400/30" />
                        <span className="text-[9px] text-brand-500/60 dark:text-brand-400/50 whitespace-nowrap">
                          Shift+click another stat for secondary
                        </span>
                        <div className="h-px flex-1 bg-brand-300/40 dark:bg-brand-400/30" />
                      </div>
                    ) : (
                      <div className="h-px bg-brand-300/40 dark:bg-brand-400/30" />
                    )}
                  </li>
                );
              }

              // Render normal stat item
              return (
                <StatListItem
                  key={row.id}
                  row={row}
                  isSelected={false}
                  isSecondary={secondaryStatId === row.id}
                  averageLabel={averageLabel}
                  onStatSelect={onStatSelect}
                  hideValue={HIDE_COUNTY_STAT_VALUES_WITHOUT_SELECTION && effectiveAreaKind === "COUNTY" && areaEntries.length === 0}
                />
              );
            })}
          </ul>
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
  averageLabel: string | null;
  onStatSelect?: (statId: string | null, meta?: StatSelectMeta) => void;
  hideValue?: boolean;
  grandchildToggles?: GrandchildAttrToggle[];
}

const StatListItem = ({
  row,
  isSelected,
  isSecondary,
  averageLabel,
  onStatSelect,
  hideValue = false,
  grandchildToggles = [],
}: StatListItemProps) => {
  const [showTooltip, setShowTooltip] = useState(false);
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });
  const [showValueTooltip, setShowValueTooltip] = useState(false);
  const [valueTooltipPos, setValueTooltipPos] = useState({ x: 0, y: 0 });

  // Determine color based on goodIfUp and whether value is above/below average
  // Only apply color when there's a selection (averageLabel is shown)
  const valueColorClass = (() => {
    if (!averageLabel || typeof row.goodIfUp !== 'boolean') {
      return 'text-slate-700 dark:text-slate-200';
    }

    const isAboveAverage = row.value > row.contextAvg;
    const isGood = row.goodIfUp ? isAboveAverage : !isAboveAverage;

    return isGood
      ? 'text-green-600 dark:text-green-400'
      : 'text-red-600 dark:text-red-400';
  })();

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

  const handleAvgHover = (e: React.MouseEvent) => {
    const li = e.currentTarget.closest("li");
    if (!li) return;
    const liRect = li.getBoundingClientRect();
    const x = e.clientX - liRect.left;
    const y = e.clientY - liRect.top;
    setTooltipPos({ x, y });
    setShowTooltip(true);
  };

  const handleValueHover = (e: React.MouseEvent) => {
    const li = e.currentTarget.closest("li");
    if (!li) return;
    const liRect = li.getBoundingClientRect();
    const x = e.clientX - liRect.left;
    const y = e.clientY - liRect.top;
    setValueTooltipPos({ x, y });
    setShowValueTooltip(true);
  };

  const getAggregationLabel = (): string => {
    return row.aggregationDescription || "";
  };

  const common =
    "group relative flex items-center justify-between rounded-2xl border px-3 py-2 shadow-sm transition-colors cursor-pointer select-none";

  const className = isSelected
    ? `${common} border-2 border-brand-500 bg-brand-50 dark:border-brand-400 dark:bg-brand-400/15`
    : isSecondary
    ? `${common} border-2 border-teal-500 bg-teal-50 dark:border-teal-400 dark:bg-teal-400/15`
    : `${common} border-slate-200/70 bg-white/70 hover:border-brand-200 hover:bg-brand-50 dark:border-slate-700/70 dark:bg-slate-900/50 dark:hover:border-slate-600 dark:hover:bg-slate-800/70`;

  const valueLabel = row.hasData ? formatStatValue(row.value, row.type) : "—";

  return (
    <li className={className} onClick={handleClick} onMouseLeave={() => {
      setShowTooltip(false);
      setShowValueTooltip(false);
    }}>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium text-slate-600 dark:text-slate-300">{row.name}</span>
          {/* Grandchild attribute toggles */}
          {grandchildToggles.length > 0 && (
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
                  className={`px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide rounded transition-colors ${
                    toggle.isActive && toggle.isAvailable
                      ? "bg-brand-500 text-white"
                      : toggle.isAvailable
                      ? "bg-slate-200 text-slate-600 hover:bg-slate-300 dark:bg-slate-700 dark:text-slate-300 dark:hover:bg-slate-600"
                      : "bg-slate-100 text-slate-400 cursor-not-allowed dark:bg-slate-800 dark:text-slate-600"
                  }`}
                  title={toggle.isAvailable ? `Toggle ${toggle.attr} breakdown` : `${toggle.attr} not available for current selection`}
                >
                  {toggle.attr}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="mt-0.5 text-[11px] text-slate-400 dark:text-slate-500">
          {row.hasData ? (
            <>
              {averageLabel && (
                <span
                  className="mr-2 inline-flex items-center gap-1 text-[10px] uppercase tracking-wide"
                  onMouseEnter={handleAvgHover}
                  onMouseLeave={() => setShowTooltip(false)}
                >
                  {averageLabel}
                  <span className="font-semibold text-slate-500 dark:text-slate-300">
                    {formatStatValue(row.contextAvg, row.type)}
                  </span>
                </span>
              )}
            </>
          ) : (
            <span className="italic text-slate-400 dark:text-slate-500">No data for selection</span>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2">
        {!hideValue && (
          <span
            className={`text-sm font-semibold ${valueColorClass}`}
            onMouseEnter={handleValueHover}
            onMouseLeave={() => setShowValueTooltip(false)}
          >
            {valueLabel}
          </span>
        )}
        {isSelected && (
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
        )}
      </div>

      {showTooltip && averageLabel && (
        <div
          className="pointer-events-none absolute z-10 rounded border border-black/10 bg-slate-800 px-1.5 py-1 text-[10px] text-white shadow-sm dark:border-white/20 dark:bg-slate-200 dark:text-slate-900"
          style={{ left: tooltipPos.x, top: tooltipPos.y - 32 }}
        >
          {averageLabel} across all areas
        </div>
      )}

      {showValueTooltip && row.hasData && (
        <div
          className="pointer-events-none absolute z-10 rounded border border-black/10 bg-slate-800 px-1.5 py-1 text-[10px] text-white shadow-sm dark:border-white/20 dark:bg-slate-200 dark:text-slate-900"
          style={{
            left: valueTooltipPos.x,
            top: valueTooltipPos.y - 32,
            transform: "translateX(-100%)",
            marginLeft: "-4px",
            opacity: 0.9,
            minWidth: "120px",
          }}
        >
          {getAggregationLabel()}
        </div>
      )}
    </li>
  );
};
