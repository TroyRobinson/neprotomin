import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type RefObject } from "react";
import { looksLikeGroupId } from "./adminNewStatModalUtils";

interface CensusGroupResult {
  name: string;
  description: string;
}

interface AISuggestion {
  groupNumber: string;
  statIds?: string[] | null;
  // Back-compat: older API response shape
  statId?: string | null;
  reason: string;
}

interface GroupSearchInputProps {
  value: string;
  onChange: (value: string) => void;
  dataset: string;
  year: number;
  onPreview?: (groupOverride?: string, suggestedStatIds?: string[] | null) => void;
  inputRef?: RefObject<HTMLInputElement | null>;
  onRegisterSearchRunner?: (runner: () => void) => void;
}

export const GroupSearchInput = ({
  value,
  onChange,
  dataset,
  year,
  onPreview,
  inputRef,
  onRegisterSearchRunner,
}: GroupSearchInputProps) => {
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [results, setResults] = useState<CensusGroupResult[]>([]);
  const [aiSuggestion, setAiSuggestion] = useState<AISuggestion | null>(null);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);

  const hasValue = value.trim().length > 0;
  const isGroupId = looksLikeGroupId(value);

  useEffect(() => {
    if (!isDropdownOpen) return;
    const handleClickOutside = (e: globalThis.MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isDropdownOpen]);

  const handleSearch = useCallback(async () => {
    const trimmed = value.trim();
    if (!trimmed || looksLikeGroupId(trimmed)) return;

    setIsSearching(true);
    setSearchError(null);
    setAiSuggestion(null);

    try {
      const [groupsResponse, aiResponse] = await Promise.allSettled([
        fetch(`/api/census-groups?${new URLSearchParams({
          dataset,
          year: String(year),
          search: trimmed,
          limit: "15",
        }).toString()}`).then((res) => res.json()),
        fetch("/api/ai-census-suggest", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query: trimmed, dataset, year }),
        }).then((res) => res.json()),
      ]);

      if (groupsResponse.status === "fulfilled" && groupsResponse.value) {
        const groups = Array.isArray(groupsResponse.value.groups) ? groupsResponse.value.groups : [];
        setResults(
          groups.map((group: any) => ({
            name: typeof group.name === "string" ? group.name : "",
            description: typeof group.description === "string" ? group.description : "",
          })),
        );
      } else {
        setResults([]);
      }

      if (aiResponse.status === "fulfilled" && aiResponse.value?.groupNumber) {
        const statIds = Array.isArray(aiResponse.value.statIds)
          ? aiResponse.value.statIds.filter((value: unknown) => typeof value === "string")
          : null;
        const fallbackStatId = typeof aiResponse.value.statId === "string" ? aiResponse.value.statId : null;
        const normalizedStatIds =
          statIds && statIds.length ? statIds : fallbackStatId ? [fallbackStatId] : null;

        setAiSuggestion({
          groupNumber: aiResponse.value.groupNumber,
          statIds: normalizedStatIds,
          statId: fallbackStatId,
          reason: aiResponse.value.reason || "AI suggested group",
        });
      }

      setIsDropdownOpen(true);
      setHighlightedIndex(-1);
    } catch {
      setSearchError("Network error during search.");
      setResults([]);
      setIsDropdownOpen(true);
      setHighlightedIndex(-1);
    } finally {
      setIsSearching(false);
    }
  }, [value, dataset, year]);

  useEffect(() => {
    onRegisterSearchRunner?.(handleSearch);
  }, [handleSearch, onRegisterSearchRunner]);

  const handleSelectGroup = (groupName: string, suggestedStatIds?: string[] | null) => {
    onChange(groupName);
    setIsDropdownOpen(false);
    setResults([]);
    setHighlightedIndex(-1);
    setAiSuggestion(null);
    onPreview?.(groupName, suggestedStatIds ?? null);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (isDropdownOpen && results.length > 0) {
        setHighlightedIndex((prev) => (prev < results.length - 1 ? prev + 1 : 0));
      }
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (isDropdownOpen && results.length > 0) {
        setHighlightedIndex((prev) => (prev > 0 ? prev - 1 : results.length - 1));
      }
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (isDropdownOpen && highlightedIndex >= 0 && results[highlightedIndex]) {
        handleSelectGroup(results[highlightedIndex].name);
      } else if (isGroupId && onPreview) {
        onPreview();
      } else if (hasValue && !isGroupId) {
        handleSearch();
      }
    } else if (e.key === "Escape") {
      setIsDropdownOpen(false);
      setHighlightedIndex(-1);
    }
  };

  return (
    <div ref={containerRef} className="relative">
      <div className="relative flex items-center">
        <button
          type="button"
          onClick={hasValue && !isGroupId ? handleSearch : undefined}
          disabled={isSearching || !hasValue || isGroupId}
          className={`absolute left-1.5 flex h-5 w-5 items-center justify-center rounded transition ${
            hasValue
              ? "text-brand-500 dark:text-brand-400"
              : "text-slate-400 dark:text-slate-500"
          } ${hasValue && !isGroupId ? "cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-700" : "cursor-default"}`}
          title={hasValue && !isGroupId ? "Search Census groups" : "Enter a search term or group ID"}
        >
          {isSearching ? (
            <svg className="h-3.5 w-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          ) : (
            <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          )}
        </button>
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="e.g., food, health, or B22003"
          className="w-full rounded-lg border border-slate-300 bg-white py-1.5 pl-8 pr-3 text-xs text-slate-900 focus:border-brand-400 focus:outline-none focus:ring-1 focus:ring-brand-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
        />
      </div>

      {isDropdownOpen && (
        <div className="absolute left-0 right-0 top-full z-50 mt-1 max-h-60 overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-lg dark:border-slate-700 dark:bg-slate-800">
          {searchError && (
            <div className="px-3 py-2 text-xs text-rose-600 dark:text-rose-400">{searchError}</div>
          )}

          {aiSuggestion && (
            <button
              type="button"
              onClick={() =>
                handleSelectGroup(
                  aiSuggestion.groupNumber,
                  aiSuggestion.statIds && aiSuggestion.statIds.length
                    ? aiSuggestion.statIds
                    : aiSuggestion.statId
                      ? [aiSuggestion.statId]
                      : null,
                )
              }
              className="flex w-full flex-col gap-1 border-b-2 border-brand-200 bg-gradient-to-r from-brand-50 to-purple-50 px-3 py-2.5 text-left transition hover:from-brand-100 hover:to-purple-100 dark:border-brand-700 dark:from-brand-900/40 dark:to-purple-900/40 dark:hover:from-brand-900/60 dark:hover:to-purple-900/60"
            >
              <div className="flex items-center gap-1.5">
                <svg className="h-3.5 w-3.5 shrink-0 text-brand-500 dark:text-brand-400" fill="currentColor" viewBox="0 0 20 20">
                  <path d="M11 3a1 1 0 10-2 0v1a1 1 0 102 0V3zM15.657 5.757a1 1 0 00-1.414-1.414l-.707.707a1 1 0 001.414 1.414l.707-.707zM18 10a1 1 0 01-1 1h-1a1 1 0 110-2h1a1 1 0 011 1zM5.05 6.464A1 1 0 106.464 5.05l-.707-.707a1 1 0 00-1.414 1.414l.707.707zM5 10a1 1 0 01-1 1H3a1 1 0 110-2h1a1 1 0 011 1zM8 16v-1h4v1a2 2 0 11-4 0zM12 14c.015-.34.208-.646.477-.859a4 4 0 10-4.954 0c.27.213.462.519.476.859h4.002z" />
                </svg>
                <span className="text-[10px] font-semibold uppercase tracking-wide text-brand-600 dark:text-brand-400">
                  AI Suggestion
                </span>
              </div>
              <span className="text-xs font-medium text-slate-800 dark:text-slate-100">
                {aiSuggestion.groupNumber}
              </span>
              <span className="line-clamp-2 text-[10px] text-slate-600 dark:text-slate-300">
                {aiSuggestion.reason}
              </span>
            </button>
          )}

          {!searchError && !aiSuggestion && results.length === 0 && (
            <div className="px-3 py-2 text-xs text-slate-500 dark:text-slate-400">
              No matching groups found.
            </div>
          )}
          {results.map((group, index) => (
            <button
              key={group.name}
              type="button"
              onClick={() => handleSelectGroup(group.name)}
              className={`flex w-full flex-col gap-0.5 px-3 py-2 text-left transition ${
                index === highlightedIndex
                  ? "bg-brand-50 dark:bg-brand-900/30"
                  : "hover:bg-slate-50 dark:hover:bg-slate-700"
              }`}
            >
              <span className="text-xs font-medium text-slate-800 dark:text-slate-100">
                {group.name}
              </span>
              <span className="line-clamp-2 text-[10px] text-slate-500 dark:text-slate-400">
                {group.description}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

export const HighlightMatch = ({ text, filter }: { text: string; filter: string }) => {
  if (!filter.trim()) return <>{text}</>;
  const terms = filter.trim().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return <>{text}</>;

  const escapedTerms = terms.map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const regex = new RegExp(`(${escapedTerms.join("|")})`, "gi");
  const testRegex = new RegExp(`^(${escapedTerms.join("|")})$`, "i");
  const parts = text.split(regex);

  return (
    <>
      {parts.map((part, index) =>
        testRegex.test(part) ? (
          <strong key={index} className="font-bold text-slate-900 dark:text-white">
            {part}
          </strong>
        ) : (
          part
        ),
      )}
    </>
  );
};
