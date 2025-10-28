import { createRoot } from "react-dom/client";
import { ReactMapApp } from "./ReactMapApp";
import "../style.css";

export interface ReactMapController {
  destroy: () => void;
}

export const createReactMapApp = (container: HTMLElement): ReactMapController => {
  const root = createRoot(container);
  root.render(<ReactMapApp />);

  return {
    destroy: () => {
      root.unmount();
    },
  };
};
