import { createRoot } from "react-dom/client";
import { Suspense } from "react";
import { Analytics } from "@vercel/analytics/react";
import { ReactMapApp } from "./ReactMapApp";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { CensusImportQueueProvider } from "./hooks/useCensusImportQueue";
import { initCrashLog, logCrash } from "./lib/crashLog";
import "maplibre-gl/dist/maplibre-gl.css";
import "../style.css";

// Install global crash handlers so errors are captured even if the UI is destroyed
initCrashLog();

window.onerror = (_msg, source, line, col, error) => {
  logCrash("window.onerror", error ?? _msg, { source, line, col });
};
window.onunhandledrejection = (event: PromiseRejectionEvent) => {
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
