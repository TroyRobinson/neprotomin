import { useMemo, useState } from "react";
import type { DemographicKindSnapshot } from "../hooks/useDemographics";
import { DEFAULT_SCOPE_LABEL_BY_KIND, type AreaKind } from "../../types/areas";

export interface BreakdownSegment {
  key: string;
  label: string;
  colorToken: string;
  valuePercent: number;
}

export interface BreakdownGroup {
  key: string;
  segments: BreakdownSegment[];
}

interface DemographicsBarProps {
  snapshots?: DemographicKindSnapshot[];
}

const COLOR_CLASS: Record<string, string> = {
  "brand-200": "bg-brand-200",
  "brand-300": "bg-brand-300",
  "brand-400": "bg-brand-400",
  "brand-500": "bg-brand-500",
  "brand-700": "bg-brand-700",
};

const formatPopulation = (value: number | undefined): string => {
  if (!Number.isFinite(value || NaN)) return "—";
  const v = value as number;
  if (Math.abs(v) >= 1000) return `${(v / 1000).toFixed(Math.abs(v) >= 10000 ? 0 : 1)}k`;
  return `${Math.round(v)}`;
};

const formatNumber = (value: number | undefined): string =>
  Number.isFinite(value || NaN) ? `${Math.round(value as number)}` : "—";

const formatPercent = (value: number | undefined): string =>
  Number.isFinite(value || NaN) ? `${Math.round(value as number)}%` : "—%";

const getKindLabel = (kind: AreaKind): string => {
  const label = DEFAULT_SCOPE_LABEL_BY_KIND[kind];
  return label ? label.toUpperCase() : kind;
};

const SegmentBar = ({ segments }: { segments: BreakdownSegment[] }) => {
  const [tooltip, setTooltip] = useState<{ text: string; x: number; y: number } | null>(null);
  const [containerRect, setContainerRect] = useState<DOMRect | null>(null);

  return (
    <div
      className="relative"
      ref={(node) => {
        if (!node) return;
        const rect = node.getBoundingClientRect();
        if (!containerRect || rect.width !== containerRect.width || rect.height !== containerRect.height) {
          setContainerRect(rect);
        }
      }}
    >
      <div className="relative h-5 w-full overflow-hidden rounded bg-slate-200 dark:bg-slate-800">
        {(() => {
          let offset = 0;
          return segments.map((seg) => {
            const width = Math.max(0, Math.min(100, Math.round(seg.valuePercent)));
            const left = offset;
            offset += width;
            if (width <= 0) return null;
            const colorClass = COLOR_CLASS[seg.colorToken] || "bg-brand-300";
            return (
              <div
                key={seg.key}
                className={`absolute bottom-0 top-0 ${colorClass}`}
                style={{ left: `${left}%`, width: `${width}%` }}
                onMouseEnter={(e) => {
                  setTooltip({ text: `${seg.label}: ${width}%`, x: e.clientX, y: e.clientY });
                }}
                onMouseMove={(e) => {
                  setTooltip({ text: `${seg.label}: ${width}%`, x: e.clientX, y: e.clientY });
                }}
                onMouseLeave={() => setTooltip(null)}
              />
            );
          });
        })()}
      </div>
      {tooltip && containerRect && (
        <div
          className="pointer-events-none absolute z-10 whitespace-nowrap rounded bg-slate-900 px-2 py-1 text-[10px] font-medium text-white shadow dark:bg-slate-200 dark:text-slate-900"
          style={{
            left: `${tooltip.x - containerRect.left}px`,
            top: `${tooltip.y - containerRect.top - 32}px`,
            transform: "translateX(-50%)",
          }}
        >
          {tooltip.text}
        </div>
      )}
    </div>
  );
};

const SnapshotSection = ({
  snapshot,
  isExpanded,
  onToggle,
}: {
  snapshot: DemographicKindSnapshot;
  isExpanded: boolean;
  onToggle: () => void;
}) => {
  const stats = snapshot.stats;
  const breakdowns = snapshot.breakdowns;
  const hasBreakdowns = breakdowns && breakdowns.size > 0;
  const title = stats?.label?.trim() || getKindLabel(snapshot.kind);
  const populationLabel = formatPopulation(stats?.population);
  const avgAgeLabel = formatNumber(stats?.avgAge);
  const marriedLabel = formatPercent(stats?.marriedPercent);
  const missing = snapshot.isMissing || (!stats && !hasBreakdowns);
  const selectedCount = stats?.selectedCount ?? 0;

  return (
    <div
      className={`flex flex-col border-b border-slate-200 text-xs dark:border-slate-800 ${
        isExpanded ? "bg-slate-50/70 dark:bg-slate-800/70" : "bg-white/70 dark:bg-slate-900/70"
      }`}
    >
      <button
        type="button"
        className="flex items-center justify-between px-4 py-2 text-left"
        onClick={onToggle}
        aria-expanded={isExpanded}
      >
        <div className="flex flex-col">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              {title}
            </span>
            {selectedCount > 0 && (
              <span className="rounded-full bg-slate-200 px-2 py-[2px] text-[10px] font-medium text-slate-600 dark:bg-slate-700 dark:text-slate-200">
                {selectedCount} selected
              </span>
            )}
          </div>
          <div className="mt-1 flex flex-wrap gap-4 text-slate-600 dark:text-slate-300">
            <span>
              <span className="font-medium text-slate-400 dark:text-slate-500">Population:</span> {populationLabel}
            </span>
            <span>
              <span className="font-medium text-slate-400 dark:text-slate-500">Avg Age:</span> {avgAgeLabel}
            </span>
            <span>
              <span className="font-medium text-slate-400 dark:text-slate-500">Married:</span> {marriedLabel}
            </span>
          </div>
        </div>
        <span className="text-[11px] uppercase tracking-wide text-slate-400 dark:text-slate-500">
          {isExpanded ? "Hide" : "Show"}
        </span>
      </button>

      {missing && (
        <p className="px-4 pb-3 text-[11px] text-slate-500 dark:text-slate-400">
          Data unavailable for this area type. Try selecting different areas or check back later.
        </p>
      )}

      {isExpanded && hasBreakdowns && (
        <div className="px-4 pb-3">
          {Array.from(breakdowns.values()).map((group) => (
            <div key={group.key} className="mt-2">
              <div className="mb-1 text-[11px] font-medium text-slate-500 dark:text-slate-400">
                {group.key.toUpperCase()}
              </div>
              <SegmentBar segments={group.segments} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export const DemographicsBar = ({ snapshots = [] }: DemographicsBarProps) => {
  const ordered = useMemo(() => {
    if (!snapshots || snapshots.length === 0) return [] as DemographicKindSnapshot[];
    const order: AreaKind[] = ["ZIP", "COUNTY", "TRACT"];
    const map = new Map<AreaKind, DemographicKindSnapshot>();
    for (const snap of snapshots) {
      map.set(snap.kind as AreaKind, snap);
    }
    const result: DemographicKindSnapshot[] = [];
    for (const kind of order) {
      const snap = map.get(kind);
      if (snap) result.push(snap);
    }
    for (const snap of snapshots) {
      if (!result.includes(snap)) result.push(snap);
    }
    return result;
  }, [snapshots]);

  const [expandedKinds, setExpandedKinds] = useState<Set<AreaKind>>(() => new Set());

  const toggleKind = (kind: AreaKind) => {
    setExpandedKinds((prev) => {
      const next = new Set(prev);
      if (next.has(kind)) next.delete(kind);
      else next.add(kind);
      return next;
    });
  };

  if (ordered.length === 0) {
    return (
      <div className="border-b border-slate-200 bg-white/70 px-4 py-3 text-xs text-slate-500 dark:border-slate-800 dark:bg-slate-900/70 dark:text-slate-400">
        No demographic data available.
      </div>
    );
  }

  return (
    <div className="flex flex-col border-b border-slate-200 bg-white/70 text-xs dark:border-slate-800 dark:bg-slate-900/70">
      {ordered.map((snapshot) => (
        <SnapshotSection
          key={snapshot.kind}
          snapshot={snapshot}
          isExpanded={expandedKinds.has(snapshot.kind as AreaKind)}
          onToggle={() => toggleKind(snapshot.kind as AreaKind)}
        />
      ))}
    </div>
  );
};
