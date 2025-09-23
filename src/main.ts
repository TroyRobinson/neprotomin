import "maplibre-gl/dist/maplibre-gl.css";
import "./style.css";

import { createApp } from "./ui/app";

const root = document.getElementById("app");

if (!root) {
  throw new Error('Failed to find root element with id "app"');
}

const app = createApp(root);

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    app.destroy();
  });
}
