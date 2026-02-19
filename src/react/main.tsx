import { createRoot } from "react-dom/client";
import { Suspense } from "react";
import { Analytics } from "@vercel/analytics/react";
import { ReactMapApp } from "./ReactMapApp";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { CensusImportQueueProvider } from "./hooks/useCensusImportQueue";
import { initCrashLog, logCrash } from "./lib/crashLog";
import "maplibre-gl/dist/maplibre-gl.css";
import "../style.css";

declare global {
  interface Window {
    __ignoredIndexedDbClosingErrors?: number;
  }
}

const isBenignIndexedDbClosingError = (value: unknown): boolean => {
  const message =
    value instanceof Error
      ? value.message
      : typeof value === "string"
        ? value
        : value && typeof value === "object" && "message" in value && typeof (value as any).message === "string"
          ? (value as any).message
          : "";
  const name =
    value instanceof Error
      ? value.name
      : value && typeof value === "object" && "name" in value && typeof (value as any).name === "string"
        ? (value as any).name
        : "";
  return (
    name === "InvalidStateError" &&
    message.includes("Failed to execute 'transaction' on 'IDBDatabase'") &&
    message.includes("database connection is closing")
  );
};

const markIgnoredIndexedDbClosingError = () => {
  const next = (window.__ignoredIndexedDbClosingErrors ?? 0) + 1;
  window.__ignoredIndexedDbClosingErrors = next;
  // Keep a single dev breadcrumb without polluting production logs.
  if (import.meta.env.DEV && next === 1) {
    console.info("[dev] Ignoring benign IndexedDB closing transaction errors from cache storage");
  }
};

// Install global crash handlers so errors are captured even if the UI is destroyed
initCrashLog();

window.onerror = (_msg, source, line, col, error) => {
  if (isBenignIndexedDbClosingError(error ?? _msg)) {
    markIgnoredIndexedDbClosingError();
    return true;
  }
  logCrash("window.onerror", error ?? _msg, { source, line, col });
  return false;
};
window.onunhandledrejection = (event: PromiseRejectionEvent) => {
  if (isBenignIndexedDbClosingError(event.reason)) {
    markIgnoredIndexedDbClosingError();
    event.preventDefault();
    return;
  }
  logCrash("unhandledrejection", event.reason);
};

const container = document.getElementById("app");
if (!container) {
  throw new Error('Failed to find root element with id "app"');
}

const root = createRoot(container);
root.render(
  <ErrorBoundary>
    <CensusImportQueueProvider>
      <Suspense
        fallback={<div className="flex h-screen items-center justify-center text-sm text-slate-500">Loading…</div>}
      >
        <ReactMapApp />
      </Suspense>
    </CensusImportQueueProvider>
    <Analytics />
  </ErrorBoundary>
);

if (typeof window !== "undefined") {
  const nudgeMobileViewport = () => {
    window.scrollTo(0, 1);
  };
  if (window.matchMedia?.("(max-width: 767px)").matches) {
    window.requestAnimationFrame(() => {
      setTimeout(nudgeMobileViewport, 400);
    });
  }
}

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    root.unmount();
  });
}
