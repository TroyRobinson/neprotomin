import type { BoundaryMode } from "../types/boundaries";
import { createSelect } from "./components/Select";

interface BoundaryToolbarOptions {
  defaultValue: BoundaryMode;
  onChange: (mode: BoundaryMode) => void;
}

export interface BoundaryToolbarController {
  element: HTMLElement;
  setValue: (mode: BoundaryMode) => void;
  destroy: () => void;
}

const OPTION_LABELS: Record<BoundaryMode, string> = {
  none: "None",
  zips: "ZIPs",
};

const OPTION_ORDER: BoundaryMode[] = ["zips", "none"];

export const createBoundaryToolbar = ({
  defaultValue,
  onChange,
}: BoundaryToolbarOptions): BoundaryToolbarController => {
  const container = document.createElement("div");
  container.className =
    "sticky top-16 z-10 flex h-10 w-full items-center gap-3 border-b border-slate-200 bg-slate-100/70 px-4 text-sm text-slate-600 backdrop-blur-sm dark:border-slate-800 dark:bg-slate-900/60 dark:text-slate-300";

  const label = document.createElement("label");
  label.className = "flex items-center gap-2 font-medium";
  label.textContent = "Boundaries";
  label.htmlFor = "boundary-select";

  const selectController = createSelect<BoundaryMode>({
    id: "boundary-select",
    value: defaultValue,
    options: OPTION_ORDER.map((value) => ({
      value,
      label: OPTION_LABELS[value],
    })),
    onChange,
  });

  label.appendChild(selectController.element);
  container.appendChild(label);

  return {
    element: container,
    setValue: selectController.setValue,
    destroy: selectController.destroy,
  };
};
