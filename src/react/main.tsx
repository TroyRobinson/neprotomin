import { createRoot } from "react-dom/client";
import { ReactMapApp } from "./ReactMapApp";
import "maplibre-gl/dist/maplibre-gl.css";
import "../style.css";

const container = document.getElementById("app");
if (!container) {
  throw new Error('Failed to find root element with id "app"');
}

const root = createRoot(container);
root.render(<ReactMapApp />);

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    root.unmount();
  });
}


