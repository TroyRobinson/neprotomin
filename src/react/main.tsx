import { createRoot } from "react-dom/client";
import { Suspense } from "react";
import { ReactMapApp } from "./ReactMapApp";
import { ErrorBoundary } from "./components/ErrorBoundary";
import "maplibre-gl/dist/maplibre-gl.css";
import "../style.css";

const container = document.getElementById("app");
if (!container) {
  throw new Error('Failed to find root element with id "app"');
}

const root = createRoot(container);
root.render(
  <ErrorBoundary>
    <Suspense fallback={<div className="flex h-screen items-center justify-center text-sm text-slate-500">Loading…</div>}>
      <ReactMapApp />
    </Suspense>
  </ErrorBoundary>
);

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    root.unmount();
  });
}


