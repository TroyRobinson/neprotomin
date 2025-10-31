import { useEffect, useMemo, useRef, useState } from "react";
import { DemographicsBar } from "./DemographicsBar";
import { StatViz } from "./StatViz";
import { StatList } from "./StatList";
import type { Organization, OrganizationHours } from "../../types/organization";
import type { Stat } from "../../types/stat";
import { getCategoryLabel } from "../../types/categories";
import type { CombinedDemographicsSnapshot } from "../hooks/useDemographics";
import type { SeriesByKind, StatBoundaryEntry } from "../hooks/useStats";
import type { AreaId } from "../../types/areas";

type SupportedAreaKind = "ZIP" | "COUNTY";
type SelectedAreasMap = Partial<Record<SupportedAreaKind, string[]>>;
type PinnedAreasMap = Partial<Record<SupportedAreaKind, string[]>>;

interface SidebarProps {
  // Organization data
  organizations?: {
    inSelection: Organization[];
    all: Organization[];
    totalSourceCount?: number;
    visibleInViewport?: number;
  };
  activeOrganizationId?: string | null;
  highlightedOrganizationIds?: string[] | null;
  demographicsSnapshot?: CombinedDemographicsSnapshot | null;
  statsById?: Map<string, Stat>;
  seriesByStatIdByKind?: Map<string, SeriesByKind>;
  statDataById?: Map<string, Partial<Record<SupportedAreaKind, StatBoundaryEntry>>>;
  selectedAreas?: SelectedAreasMap;
  pinnedAreas?: PinnedAreasMap;
  activeAreaKind?: SupportedAreaKind | null;
  areaNameLookup?: (kind: SupportedAreaKind, code: string) => string;
  selectedStatId?: string | null;
  secondaryStatId?: string | null;
  categoryFilter?: string | null;
  hoveredArea?: AreaId | null;
  onHover?: (idOrIds: string | string[] | null) => void;
  onZoomOutAll?: () => void;
  onCategoryClick?: (categoryId: string) => void;
  onHoverArea?: (area: AreaId | null) => void;
  onStatSelect?: (statId: string | null, meta?: { shiftKey?: boolean; clear?: boolean }) => void;
  onOrgPinsVisibleChange?: (visible: boolean) => void;
  variant?: "desktop" | "mobile";
  showInsights?: boolean;
  className?: string;
  // When incremented, force switch to Statistics tab and hide orgs toggle
  forceHideOrgsNonce?: number;
}

type TabType = "stats" | "orgs";

export const Sidebar = ({
  organizations = { inSelection: [], all: [], totalSourceCount: 0 },
  activeOrganizationId = null,
  highlightedOrganizationIds = null,
  demographicsSnapshot = null,
  statsById = new Map(),
  seriesByStatIdByKind = new Map(),
  statDataById = new Map(),
  selectedAreas = {},
  pinnedAreas = {},
  activeAreaKind = null,
  areaNameLookup,
  selectedStatId = null,
  secondaryStatId = null,
  categoryFilter = null,
  hoveredArea = null,
  onHover,
  onZoomOutAll,
  onCategoryClick,
  onHoverArea,
  onStatSelect,
  onOrgPinsVisibleChange,
  variant = "desktop",
  showInsights = true,
  className = "",
  forceHideOrgsNonce,
}: SidebarProps) => {
  const [activeTab, setActiveTab] = useState<TabType>("orgs");
  const [keepOrgsOnMap, setKeepOrgsOnMap] = useState(true);
  const [expandedOrgId, setExpandedOrgId] = useState<string | null>(null);

  const { inSelection = [], all = [], totalSourceCount = 0, visibleInViewport } = organizations;
  const highlightedIds = new Set(highlightedOrganizationIds ?? []);

  const selectedZips = selectedAreas?.ZIP ?? [];
  const selectedCounties = selectedAreas?.COUNTY ?? [];
  const totalSelectedCount = selectedZips.length + selectedCounties.length;

  // Determine the "IN SELECTION" label - show area name if only one area is selected
  const inSelectionLabel = useMemo(() => {
    if (totalSelectedCount === 1) {
      const selectedZip = selectedZips[0];
      const selectedCounty = selectedCounties[0];
      if (selectedZip && areaNameLookup) {
        const areaName = areaNameLookup("ZIP", selectedZip);
        return areaName ? `IN ${areaName}` : `IN ${selectedZip}`;
      }
      if (selectedCounty && areaNameLookup) {
        const areaName = areaNameLookup("COUNTY", selectedCounty);
        return areaName ? `IN ${areaName}` : `IN ${selectedCounty}`;
      }
      // Fallback to code if no lookup function available
      if (selectedZip) {
        return `IN ${selectedZip}`;
      }
      if (selectedCounty) {
        return `IN ${selectedCounty}`;
      }
    }
    return "IN SELECTION";
  }, [totalSelectedCount, selectedZips, selectedCounties, areaNameLookup]);

  const visibleCount =
    typeof visibleInViewport === "number" ? visibleInViewport : inSelection.length + all.length;
  const totalCount = typeof totalSourceCount === "number" ? totalSourceCount : visibleCount;
  const countForTab = totalSelectedCount > 0 ? inSelection.length : visibleCount;
  const missingCount = Math.max(totalCount - visibleCount, 0);

  useEffect(() => {
    const visible = keepOrgsOnMap || activeTab === "orgs";
    onOrgPinsVisibleChange?.(visible);
  }, [activeTab, keepOrgsOnMap, onOrgPinsVisibleChange]);

  // Respond to external force-hide requests (e.g., closing the Orgs chip on the map)
  const lastForceHideNonceRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (typeof forceHideOrgsNonce !== "number") {
      return;
    }
    if (lastForceHideNonceRef.current === forceHideOrgsNonce) {
      return;
    }
    if (lastForceHideNonceRef.current !== undefined) {
      setKeepOrgsOnMap(false);
      setActiveTab("stats");
    }
    lastForceHideNonceRef.current = forceHideOrgsNonce;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [forceHideOrgsNonce]);

  const handleToggleKeepOrgs = (e: React.MouseEvent | React.KeyboardEvent) => {
    e.stopPropagation();
    setKeepOrgsOnMap((prev) => !prev);
  };

  const handleTabChange = (tab: TabType) => {
    setActiveTab(tab);
  };

  const tabClasses = (isActive: boolean) =>
    `pb-2 text-[11px] font-semibold uppercase tracking-wide border-b-2 inline-flex items-center gap-2 ${
      isActive
        ? "border-brand-500 text-brand-700 dark:text-brand-300"
        : "border-transparent text-slate-500 hover:text-brand-700 dark:text-slate-500"
    }`;

  const containerClassName = useMemo(() => {
    if (variant === "mobile") {
      return [
        "relative flex h-full w-full flex-col bg-white dark:bg-slate-900",
        // Allow callers to add custom styling
        className,
      ]
        .filter(Boolean)
        .join(" ");
    }
    return [
      "relative flex w-full max-w-sm flex-col border-r border-slate-200 bg-white/60 backdrop-blur dark:border-slate-800 dark:bg-slate-900/60",
      className,
    ]
      .filter(Boolean)
      .join(" ");
  }, [variant, className]);

  return (
    <aside className={containerClassName}>
      {showInsights && (
        <>
          {/* Demographics Bar */}
          <DemographicsBar snapshot={demographicsSnapshot ?? null} />

          {/* Stat Visualization */}
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
          />
        </>
      )}

      {/* Tabs Header */}
      <div className="mb-2 flex items-center justify-between px-4 pt-3">
        <div className="flex items-center gap-4">
          <button
            type="button"
            className={tabClasses(activeTab === "orgs")}
            onClick={() => handleTabChange("orgs")}
          >
            <span>Organizations ({countForTab})</span>
            {/* Keep Orgs On Map Toggle */}
            <span
              role="switch"
              aria-checked={keepOrgsOnMap}
              aria-label="Keep Orgs On Map"
              title="Keep Orgs On Map"
              tabIndex={0}
              className={`relative inline-flex h-3 w-6 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-brand-500 ${
                keepOrgsOnMap ? "bg-brand-500" : "bg-slate-300 dark:bg-slate-500"
              }`}
              onClick={handleToggleKeepOrgs}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  handleToggleKeepOrgs(e);
                }
              }}
              onMouseDown={(e) => e.stopPropagation()}
              onPointerDown={(e) => e.stopPropagation()}
              onTouchStart={(e) => e.stopPropagation()}
            >
              <span
                className="inline-block h-2 w-2 transform rounded-full bg-white shadow transition"
                style={{ transform: keepOrgsOnMap ? "translateX(14px)" : "translateX(2px)" }}
              />
            </span>
          </button>
          <button
            type="button"
            className={tabClasses(activeTab === "stats")}
            onClick={() => handleTabChange("stats")}
          >
            <span>Statistics</span>
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Statistics Tab */}
        {activeTab === "stats" && (
          <StatList
            variant={variant}
            statsById={statsById}
            statDataById={statDataById}
            selectedAreas={selectedAreas}
            activeAreaKind={activeAreaKind}
            areaNameLookup={areaNameLookup}
            categoryFilter={categoryFilter}
            secondaryStatId={secondaryStatId}
            selectedStatId={selectedStatId}
            onStatSelect={onStatSelect}
          />
        )}

        {/* Organizations Tab */}
        {activeTab === "orgs" && (
          <div className="flex flex-1 flex-col overflow-y-auto">
            {visibleCount === 0 && missingCount === 0 ? (
              <p className="px-4 pt-3 pb-6 text-sm text-slate-500 dark:text-slate-400">
                No organizations found. Add one to get started.
              </p>
            ) : (
              <div className="flex-1">

                {/* In Selection Section */}
                {inSelection.length > 0 && (
                  <>
                    <h3 className="px-8 pt-3 pb-2 text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
                      {inSelectionLabel}
                    </h3>
                    <ul className="space-y-2 px-4">
                      {inSelection.map((org) => (
                        <OrganizationListItem
                          key={org.id}
                          org={org}
                          isActive={
                            org.id === activeOrganizationId || highlightedIds.has(org.id)
                          }
                          isExpanded={expandedOrgId === org.id}
                          onHover={onHover}
                          onCategoryClick={onCategoryClick}
                          onToggleExpand={(id) =>
                            setExpandedOrgId((prev) => (prev === id ? null : id))
                          }
                        />
                      ))}
                    </ul>
                  </>
                )}

                {/* All Section */}
                {totalSelectedCount > 0 && (
                  <h3 className="px-8 pt-4 pb-2 text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
                    ALL
                  </h3>
                )}
                <ul className="space-y-2 px-4 pb-6">
                  {all.map((org) => (
                    <OrganizationListItem
                      key={org.id}
                      org={org}
                      isActive={org.id === activeOrganizationId || highlightedIds.has(org.id)}
                      onHover={onHover}
                      onCategoryClick={onCategoryClick}
                      isExpanded={expandedOrgId === org.id}
                      onToggleExpand={(id) =>
                        setExpandedOrgId((prev) => (prev === id ? null : id))
                      }
                    />
                  ))}

                  {/* Zoom Out Link */}
                  {missingCount > 0 && (
                    <li className="px-0 pt-0 pb-0">
                      <button
                        type="button"
                        className="block w-full text-left text-xs font-normal text-brand-300 hover:text-brand-800 dark:text-brand-400 dark:hover:text-brand-200 px-4 pb-4 pt-2 transition-colors"
                        onClick={onZoomOutAll}
                      >
                        {missingCount} more not visible (Zoom out)
                      </button>
                    </li>
                  )}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>
    </aside>
  );
};

interface OrganizationListItemProps {
  org: Organization;
  isActive: boolean;
  isExpanded: boolean;
  onHover?: (idOrIds: string | string[] | null) => void;
  onCategoryClick?: (categoryId: string) => void;
  onToggleExpand?: (id: string) => void;
}

const DAY_LABELS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;

const formatHoursLines = (hours: OrganizationHours | null | undefined): string[] => {
  if (!hours) return [];
  if (Array.isArray(hours.weekdayText) && hours.weekdayText.length > 0) {
    return hours.weekdayText;
  }

  if (!Array.isArray(hours.periods) || hours.periods.length === 0) {
    return [];
  }

  const map = new Map<number, string[]>();
  for (const period of hours.periods) {
    if (typeof period?.day !== "number") continue;
    const dayIndex = Math.min(Math.max(period.day, 0), DAY_LABELS.length - 1);
    const segments: string[] = [];
    const open = period.openTime ?? null;
    const close = period.closeTime ?? null;
    if (open && close) {
      segments.push(`${open} – ${close}${period.isOvernight ? " (+1)" : ""}`);
    } else if (open) {
      segments.push(`Opens ${open}`);
    } else if (close) {
      segments.push(`Closes ${close}`);
    } else {
      segments.push("Closed");
    }

    const existing = map.get(dayIndex) ?? [];
    existing.push(...segments);
    map.set(dayIndex, existing);
  }

  const lines: string[] = [];
  for (const [dayIndex, segments] of map.entries()) {
    const label = DAY_LABELS[dayIndex] ?? `Day ${dayIndex}`;
    lines.push(`${label}: ${segments.join(", ")}`);
  }
  return lines;
};

const renderHours = (hours: OrganizationHours | null | undefined) => {
  const lines = formatHoursLines(hours);
  if (lines.length === 0) return null;
  const isUnverified = hours?.isUnverified;
  const statusLabel =
    typeof hours?.status === "string" && hours.status.trim().length > 0
      ? hours.status
      : null;

  return (
    <div className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600 dark:bg-slate-800/60 dark:text-slate-300">
      <div className="mb-1 flex items-center justify-between text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
        <span>Hours</span>
        <div className="flex items-center gap-2">
          {statusLabel ? <span className="capitalize text-slate-400">{statusLabel.toLowerCase()}</span> : null}
          {isUnverified ? (
            <span className="rounded bg-amber-100 px-2 py-[1px] text-[10px] font-medium uppercase tracking-wide text-amber-800 dark:bg-amber-400/20 dark:text-amber-200">
              Unverified
            </span>
          ) : null}
        </div>
      </div>
      <ul className="space-y-1">
        {lines.map((line, idx) => (
          <li key={`${line}-${idx}`} className="leading-snug">
            {line}
          </li>
        ))}
      </ul>
    </div>
  );
};

const OrganizationListItem = ({
  org,
  isActive,
  isExpanded,
  onHover,
  onCategoryClick,
  onToggleExpand,
}: OrganizationListItemProps) => {
  const handleMouseEnter = () => onHover?.(org.id);
  const handleMouseLeave = () => onHover?.(null);

  const handleCategoryClick = (event?: React.MouseEvent | React.KeyboardEvent) => {
    event?.stopPropagation();
    const cat = (org as any).category as string | undefined;
    if (cat) {
      onCategoryClick?.(cat);
    }
  };

  const handleToggle = () => onToggleExpand?.(org.id);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLLIElement>) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      handleToggle();
    }
  };

  return (
    <li
      data-org-id={org.id}
      className={`group relative rounded-xl border px-4 py-3 transition duration-200 ease-out ${
        isActive
          ? "border-brand-300 ring-2 ring-brand-200/80 bg-brand-50/70 dark:bg-slate-800"
          : isExpanded
          ? "border-brand-200 bg-brand-50/60 dark:border-slate-700 dark:bg-slate-800/50"
          : "border-transparent bg-slate-100/40 hover:border-brand-200 hover:bg-brand-50 dark:bg-slate-800/20 dark:hover:border-slate-700 dark:hover:bg-slate-800/70"
      }`}
      onMouseEnter={handleMouseEnter}
      onFocus={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onBlur={handleMouseLeave}
      onClick={handleToggle}
      role="button"
      tabIndex={0}
      aria-expanded={isExpanded}
      onKeyDown={handleKeyDown}
    >
      <div className="flex items-start gap-2">
        <p className="text-sm font-medium text-slate-600 dark:text-slate-300">{org.name}</p>
        {org.status && org.status !== "active" && (
          <span className="rounded-full bg-amber-100 px-2 py-[2px] text-[10px] font-semibold uppercase tracking-wide text-amber-800 dark:bg-amber-400/20 dark:text-amber-200">
            {org.status}
          </span>
        )}
      </div>
      {(org.address || org.city || org.state || org.postalCode) && (
        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
          {[
            org.address,
            [org.city, org.state].filter(Boolean).join(", ") || null,
            org.postalCode ?? null,
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
      )}
      {org.phone && (
        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
          <span className="font-medium text-slate-600 dark:text-slate-300">Phone:</span>{" "}
          <a
            href={`tel:${org.phone}`}
            className="hover:underline"
            onClick={(event) => event.stopPropagation()}
          >
            {org.phone}
          </a>
        </p>
      )}
      {/* Actions row: Visit site + Category on left, Hours tag on right */}
      <div className="mt-1 flex items-center justify-between gap-2">
        <div className="min-w-0 flex items-center gap-2">
          {org.website && (
            <a
              href={org.website}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs font-medium text-slate-400 transition-colors hover:text-brand-900 dark:text-slate-300 dark:hover:text-slate-100"
              onClick={(event) => event.stopPropagation()}
            >
              Visit site
              <span aria-hidden="true" className="text-[1em] leading-none">
                ↗
              </span>
            </a>
          )}
          <span
            role="button"
            tabIndex={0}
            className="ml-2 inline-flex items-center rounded-full bg-slate-50 px-2 py-[2px] text-[10px] font-medium text-slate-600 dark:bg-slate-800/70 dark:text-slate-300 cursor-pointer"
            onClick={(event) => handleCategoryClick(event)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                handleCategoryClick(e);
              }
            }}
          >
            {getCategoryLabel(org.category)}
          </span>
        </div>
        {formatHoursLines(org.hours).length > 0 ? (
          <button
            type="button"
            className="inline-flex items-center rounded-full bg-slate-100 px-2 py-[2px] text-[10px] font-medium text-slate-500 transition-colors group-hover:bg-brand-100 group-hover:text-brand-900 dark:bg-slate-800/60 dark:text-slate-300 dark:group-hover:bg-slate-700 dark:group-hover:text-slate-100"
            onClick={(e) => {
              e.stopPropagation();
              handleToggle();
            }}
          >
            Hours
          </button>
        ) : null}
      </div>
      {isExpanded ? renderHours(org.hours) : null}
    </li>
  );
};
