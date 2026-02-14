// Ring-buffer crash log stored on window for post-mortem debugging.
// Survives UI crashes — inspect via `window.__crashLog` in devtools.

const MAX_ENTRIES = 20;

interface CrashEntry {
  ts: string;
  source: string;
  message: string;
  stack?: string;
  extra?: Record<string, unknown>;
}

declare global {
  interface Window {
    __crashLog?: CrashEntry[];
  }
}

export function initCrashLog() {
  if (typeof window !== "undefined" && !window.__crashLog) {
    window.__crashLog = [];
  }
}

export function logCrash(source: string, error: unknown, extra?: Record<string, unknown>) {
  if (typeof window === "undefined") return;
  if (!window.__crashLog) window.__crashLog = [];

  const entry: CrashEntry = {
    ts: new Date().toISOString(),
    source,
    message: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
    extra,
  };

  window.__crashLog.push(entry);
  // Keep ring buffer bounded
  if (window.__crashLog.length > MAX_ENTRIES) {
    window.__crashLog.splice(0, window.__crashLog.length - MAX_ENTRIES);
  }
}
