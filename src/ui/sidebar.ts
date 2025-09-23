import type { Organization } from "../types/organization";

interface SidebarOptions {
  onHover: (id: string | null) => void;
}

export interface SidebarController {
  element: HTMLElement;
  setOrganizations: (organizations: Organization[]) => void;
  setActiveOrganization: (id: string | null) => void;
}

const createListItem = (
  org: Organization,
  onHover: SidebarOptions["onHover"],
): HTMLLIElement => {
  const item = document.createElement("li");
  item.dataset.orgId = org.id;
  item.className =
    "group relative rounded-xl border border-transparent px-4 py-3 transition-colors duration-150 hover:border-brand-200 hover:bg-brand-50 dark:hover:border-slate-700 dark:hover:bg-slate-800/70";

  const name = document.createElement("p");
  name.className = "text-sm font-semibold text-slate-700 dark:text-slate-100";
  name.textContent = org.name;

  const link = document.createElement("a");
  link.href = org.url;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.className =
    "mt-1 inline-flex items-center gap-1 text-xs font-medium text-brand-600 transition-colors hover:text-brand-500 dark:text-brand-300 dark:hover:text-brand-200";
  link.innerHTML = `Visit site
    <span aria-hidden="true" class="text-lg leading-none">↗</span>
  `;

  item.appendChild(name);
  item.appendChild(link);

  const handleEnter = () => onHover(org.id);
  const handleLeave = () => onHover(null);

  item.addEventListener("mouseenter", handleEnter);
  item.addEventListener("focusin", handleEnter);
  item.addEventListener("mouseleave", handleLeave);
  item.addEventListener("focusout", handleLeave);

  return item;
};

export const createSidebar = ({ onHover }: SidebarOptions): SidebarController => {
  const container = document.createElement("aside");
  container.className =
    "relative flex w-full max-w-sm flex-col border-r border-slate-200 bg-white/60 backdrop-blur dark:border-slate-800 dark:bg-slate-900/60";

  const header = document.createElement("div");
  header.className = "flex items-center justify-between px-6 py-4";

  const title = document.createElement("h2");
  title.className = "text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400";
  title.textContent = "Organizations";

  const totalLabel = document.createElement("span");
  totalLabel.className = "text-xs font-medium text-slate-400 dark:text-slate-500";
  totalLabel.textContent = "0";

  header.appendChild(title);
  header.appendChild(totalLabel);

  const list = document.createElement("ul");
  list.className = "flex-1 space-y-2 overflow-y-auto px-4 pb-6 pt-3";

  const emptyState = document.createElement("p");
  emptyState.className = "px-4 pt-3 pb-6 text-sm text-slate-500 dark:text-slate-400";
  emptyState.textContent = "No organizations found. Add one to get started.";

  let activeId: string | null = null;

  const updateActiveState = () => {
    const items = list.querySelectorAll<HTMLLIElement>("li");
    items.forEach((item) => {
      const isActive = item.dataset.orgId === activeId;
      item.classList.toggle("border-brand-300", isActive);
      item.classList.toggle("ring-2", isActive);
      item.classList.toggle("ring-brand-200/80", isActive);
      item.classList.toggle("bg-brand-50/70", isActive);
      item.classList.toggle("dark:bg-slate-800", isActive);
    });
  };

  const setOrganizations = (organizations: Organization[]) => {
    totalLabel.textContent = `${organizations.length}`;
    list.innerHTML = "";

    if (organizations.length === 0) {
      emptyState.hidden = false;
      activeId = null;
      return;
    }

    emptyState.hidden = true;

    const knownIds = new Set<string>();

    for (const org of organizations) {
      knownIds.add(org.id);
      list.appendChild(createListItem(org, onHover));
    }

    if (activeId && !knownIds.has(activeId)) {
      activeId = null;
    }

    updateActiveState();
  };

  const setActiveOrganization = (id: string | null) => {
    activeId = id;
    updateActiveState();
  };

  const content = document.createElement("div");
  content.className = "flex flex-1 flex-col overflow-hidden";
  content.appendChild(emptyState);
  content.appendChild(list);

  container.appendChild(header);
  container.appendChild(content);

  return {
    element: container,
    setOrganizations,
    setActiveOrganization,
  };
};
