import type { Organization } from "../types/organization";

interface SidebarOptions {
  onHover: (id: string | null) => void;
  onZoomOutAll: () => void;
}

export interface SidebarController {
  element: HTMLElement;
  setOrganizations: (organizations: Organization[], totalCount?: number) => void;
  setActiveOrganization: (id: string | null) => void;
}

const createListItem = (
  org: Organization,
  onHover: SidebarOptions["onHover"],
): HTMLLIElement => {
  const item = document.createElement("li");
  item.dataset.orgId = org.id;
  item.className =
    "group relative rounded-xl border border-transparent px-4 py-3 transition duration-200 ease-out hover:border-brand-200 hover:bg-brand-50 dark:hover:border-slate-700 dark:hover:bg-slate-800/70";

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

export const createSidebar = ({ onHover, onZoomOutAll }: SidebarOptions): SidebarController => {
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
  list.className = "flex-1 space-y-2 overflow-y-auto px-4 pb-6 pt-1";

  const emptyState = document.createElement("p");
  emptyState.className = "px-4 pt-3 pb-6 text-sm text-slate-500 dark:text-slate-400";
  emptyState.textContent = "No organizations found. Add one to get started.";

  let activeId: string | null = null;
  let totalCount: number = 0;

  // Footer with zoom-out link
  const footer = document.createElement("div");
  footer.className = "px-4 pb-4 pt-2 border-t border-slate-200/70 dark:border-slate-800/70";
  footer.hidden = true;

  const zoomOutLink = document.createElement("button");
  zoomOutLink.type = "button";
  zoomOutLink.className =
    "text-xs font-medium text-slate-500 underline underline-offset-2 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200";
  zoomOutLink.addEventListener("click", () => onZoomOutAll());
  footer.appendChild(zoomOutLink);

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

  const setOrganizations = (organizations: Organization[], total?: number) => {
    totalCount = typeof total === "number" ? total : organizations.length;
    totalLabel.textContent = `${organizations.length}`;

    // Diff existing items vs next set for smoother transitions
    const existingItems = new Map<string, HTMLLIElement>();
    list.querySelectorAll<HTMLLIElement>("li").forEach((li) => {
      const id = li.dataset.orgId;
      if (id) existingItems.set(id, li);
    });

    const nextIds = new Set(organizations.map((o) => o.id));

    // Remove items not in next set with fade/slide out
    existingItems.forEach((li, id) => {
      if (!nextIds.has(id)) {
        li.classList.add("opacity-0", "translate-y-1");
        const removeNode = () => li.remove();
        li.addEventListener("transitionend", removeNode, { once: true });
      }
    });

    // Build in-order fragment of next items, reusing existing where possible
    const frag = document.createDocumentFragment();
    const knownIds = new Set<string>();
    for (const org of organizations) {
      knownIds.add(org.id);
      const existing = existingItems.get(org.id);
      if (existing) {
        frag.appendChild(existing);
      } else {
        const li = createListItem(org, onHover);
        // Start hidden for transition-in
        li.classList.add("opacity-0", "translate-y-1");
        frag.appendChild(li);
        // Animate in on next frame
        requestAnimationFrame(() => {
          li.classList.remove("opacity-0", "translate-y-1");
        });
      }
    }

    // Reorder by appending in the desired order (moves existing nodes)
    list.appendChild(frag);

    // Footer toggle and text
    const missing = Math.max(totalCount - organizations.length, 0);
    if (missing > 0) {
      zoomOutLink.textContent = `${missing} more not visible (Zoom out)`;
      footer.hidden = false;
    } else {
      footer.hidden = true;
    }

    // Empty state visibility
    const isEmpty = organizations.length === 0;
    // Hide the empty message if there are orgs overall but none in view
    emptyState.hidden = !isEmpty || missing > 0;
    if (isEmpty && missing === 0) {
      activeId = null;
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
  content.appendChild(footer);

  container.appendChild(header);
  container.appendChild(content);

  return {
    element: container,
    setOrganizations,
    setActiveOrganization,
  };
};
