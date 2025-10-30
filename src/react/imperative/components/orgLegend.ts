export interface OrgLegendController {
  element: HTMLElement;
  setVisible: (visible: boolean) => void;
  destroy: () => void;
}

export const createOrgLegend = (): OrgLegendController => {
  const wrapper = document.createElement("div");
  wrapper.className = "flex items-center gap-2";

  const dot = document.createElement("span");
  dot.className = "h-2.5 w-2.5 flex-shrink-0 rounded-full ring-1 ring-black/5 dark:ring-white/10";
  dot.style.backgroundColor = "#fb923c"; // orange-400

  const label = document.createElement("span");
  label.className = "tabular-nums";
  label.textContent = "Org";

  // A subtle vertical divider to separate the orgs group from the rest of the legend
  const divider = document.createElement("span");
  divider.className = "mx-1 h-4 w-px self-stretch bg-slate-200 dark:bg-slate-700/70";

  wrapper.appendChild(dot);
  wrapper.appendChild(label);
  wrapper.appendChild(divider);

  const setVisible = (visible: boolean) => {
    wrapper.classList.toggle("hidden", !visible);
  };

  const destroy = () => {
    wrapper.remove();
  };

  setVisible(false);

  return { element: wrapper, setVisible, destroy };
};
