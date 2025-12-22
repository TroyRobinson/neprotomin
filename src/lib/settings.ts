export const PREFETCH_RECENT_STATS_KEY = "settings.prefetchRecentStats";
export const REDUCED_DATA_LOADING_KEY = "settings.reducedDataLoading";

export const readBoolSetting = (key: string, fallback = false): boolean => {
  if (typeof window === "undefined") return fallback;
  try {
    const value = localStorage.getItem(key);
    if (value === null) return fallback;
    return value === "true";
  } catch {
    return fallback;
  }
};

export const writeBoolSetting = (key: string, value: boolean): void => {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(key, value ? "true" : "false");
  } catch {
    // Best-effort only.
  }
};
