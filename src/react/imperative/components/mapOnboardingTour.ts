import {
  MAP_TOUR_CHANGE_OPTION_ATTR,
  MAP_TOUR_LOCK_ATTR,
  MAP_TOUR_LOCKS,
  MAP_TOUR_STAT_LABEL_ATTR,
  MAP_TOUR_TARGET_ATTR,
  MAP_TOUR_TARGETS,
} from "../constants/mapTourTargets";

export interface MapOnboardingTourController {
  start: () => void;
  refresh: () => void;
  destroy: () => void;
}

interface MapOnboardingTourOptions {
  container: HTMLElement;
  targetRoot: HTMLElement;
  enabled?: boolean;
  dismissedStorageKey?: string;
  preferredChangeOptionLabel?: string;
}

const DEFAULT_DISMISSED_STORAGE_KEY = "ne.map.onboarding.dismissed.v1";
const DEFAULT_PREFERRED_CHANGE_OPTION_LABEL = "Population (Change '21-23)";

type OnboardingStep =
  | "chip"
  | "change"
  | "showingTrigger"
  | "showingExtremas"
  | "showingOrganizations"
  | "showingAreas"
  | "share"
  | "searchMenu"
  | "myLocation"
  | "legend";

const targetSelector = (target: string): string => `[${MAP_TOUR_TARGET_ATTR}="${target}"]`;

const createNoopController = (): MapOnboardingTourController => ({
  start: () => {},
  refresh: () => {},
  destroy: () => {},
});

const isVisibleTarget = (target: HTMLElement | null): target is HTMLElement => {
  if (!target) return false;
  if (target.classList.contains("hidden")) return false;
  return target.getClientRects().length > 0;
};

type LocalRect = { left: number; top: number; right: number; bottom: number };

export const createMapOnboardingTour = ({
  container,
  targetRoot,
  enabled = true,
  dismissedStorageKey = DEFAULT_DISMISSED_STORAGE_KEY,
  preferredChangeOptionLabel = DEFAULT_PREFERRED_CHANGE_OPTION_LABEL,
}: MapOnboardingTourOptions): MapOnboardingTourController => {
  if (!enabled) {
    return createNoopController();
  }

  let onboardingStep: OnboardingStep | null = null;
  let onboardingRetryTimer: number | null = null;
  let onboardingPositionRaf: number | null = null;
  let onboardingForceStart = false;
  let onboardingDismissed = false;
  try {
    onboardingDismissed = window.localStorage.getItem(dismissedStorageKey) === "1";
  } catch {}

  const welcomeToast = document.createElement("div");
  welcomeToast.className =
    "pointer-events-auto absolute bottom-[4.5rem] right-4 z-[15] hidden w-[22rem] rounded-xl border border-slate-200 bg-white/95 p-3.5 shadow-xl backdrop-blur-sm dark:border-slate-700 dark:bg-slate-900/95";
  welcomeToast.setAttribute("role", "dialog");
  welcomeToast.setAttribute("aria-label", "Welcome tour");
  welcomeToast.innerHTML = `
    <p class="text-sm font-semibold text-slate-900 dark:text-slate-100">Welcome to Neighborhood Explorer</p>
    <p class="mt-1 text-xs text-slate-600 dark:text-slate-300">Would you like a quick tour?</p>
  `;

  const welcomeActions = document.createElement("div");
  welcomeActions.className = "mt-3 flex items-center justify-end gap-2";
  const dismissWelcomeBtn = document.createElement("button");
  dismissWelcomeBtn.type = "button";
  dismissWelcomeBtn.className =
    "rounded-md border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-600 transition hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800";
  dismissWelcomeBtn.textContent = "Dismiss";
  const startTourBtn = document.createElement("button");
  startTourBtn.type = "button";
  startTourBtn.className =
    "rounded-md bg-brand-500 px-2.5 py-1 text-xs font-medium text-white transition hover:bg-brand-600 dark:bg-brand-600 dark:hover:bg-brand-500";
  startTourBtn.textContent = "Start tour";
  welcomeActions.appendChild(dismissWelcomeBtn);
  welcomeActions.appendChild(startTourBtn);
  welcomeToast.appendChild(welcomeActions);
  container.appendChild(welcomeToast);

  const stepOverlay = document.createElement("div");
  stepOverlay.className = "pointer-events-none absolute inset-0 z-[14] hidden";
  const highlightBox = document.createElement("div");
  highlightBox.className = "absolute rounded-2xl border-2 border-brand-400/90";
  highlightBox.style.boxShadow = "0 0 0 4px rgba(142, 144, 196, 0.2)";
  const stepCard = document.createElement("div");
  stepCard.className =
    "pointer-events-auto absolute max-w-[22rem] rounded-xl border border-slate-200 bg-white/95 p-3.5 shadow-xl backdrop-blur-sm dark:border-slate-700 dark:bg-slate-900/95";
  stepOverlay.appendChild(highlightBox);
  stepOverlay.appendChild(stepCard);
  container.appendChild(stepOverlay);

  const clearOnboardingRetry = () => {
    if (onboardingRetryTimer !== null) {
      window.clearTimeout(onboardingRetryTimer);
      onboardingRetryTimer = null;
    }
  };

  const setOnboardingDismissed = () => {
    onboardingDismissed = true;
    try {
      window.localStorage.setItem(dismissedStorageKey, "1");
    } catch {}
  };

  const showWelcomeToast = () => {
    if (onboardingDismissed) return;
    welcomeToast.classList.remove("hidden");
  };

  const hideWelcomeToast = () => {
    welcomeToast.classList.add("hidden");
  };

  const getSelectedStatChipTarget = (): HTMLElement | null => {
    const target = targetRoot.querySelector<HTMLElement>(targetSelector(MAP_TOUR_TARGETS.primaryStatChip));
    return isVisibleTarget(target) ? target : null;
  };

  const getChangeOptionTarget = (): HTMLElement | null => {
    const optionEls = Array.from(
      targetRoot.querySelectorAll<HTMLElement>(targetSelector(MAP_TOUR_TARGETS.primaryStatOption)),
    ).filter((option) => isVisibleTarget(option));
    if (optionEls.length === 0) {
      const menuTarget = targetRoot.querySelector<HTMLElement>(targetSelector(MAP_TOUR_TARGETS.primaryStatMenu));
      return isVisibleTarget(menuTarget) ? menuTarget : null;
    }
    const normalizedPreferred = preferredChangeOptionLabel.toLowerCase();
    const exact = optionEls.find(
      (option) =>
        (option.getAttribute(MAP_TOUR_STAT_LABEL_ATTR) ?? "").trim().toLowerCase() === normalizedPreferred,
    );
    if (exact) return exact;
    return (
      optionEls.find((option) => option.getAttribute(MAP_TOUR_CHANGE_OPTION_ATTR) === "true") ??
      optionEls[0] ??
      null
    );
  };

  const getShowingChipTarget = (): HTMLElement | null => {
    const target = targetRoot.querySelector<HTMLElement>(targetSelector(MAP_TOUR_TARGETS.showingChip));
    return isVisibleTarget(target) ? target : null;
  };

  const getShowingExtremasTarget = (): HTMLElement | null => {
    const target = targetRoot.querySelector<HTMLElement>(targetSelector(MAP_TOUR_TARGETS.showingExtremas));
    return isVisibleTarget(target) ? target : null;
  };

  const getShowingOrganizationsTarget = (): HTMLElement | null => {
    const target = targetRoot.querySelector<HTMLElement>(targetSelector(MAP_TOUR_TARGETS.showingOrganizations));
    return isVisibleTarget(target) ? target : null;
  };

  const getShowingAreasTarget = (): HTMLElement | null => {
    const target = targetRoot.querySelector<HTMLElement>(targetSelector(MAP_TOUR_TARGETS.showingAreas));
    return isVisibleTarget(target) ? target : null;
  };

  const getShareChipTarget = (): HTMLElement | null => {
    const target = targetRoot.querySelector<HTMLElement>(targetSelector(MAP_TOUR_TARGETS.shareChip));
    return isVisibleTarget(target) ? target : null;
  };

  const getLegendTarget = (): HTMLElement | null => {
    const target =
      container.querySelector<HTMLElement>(targetSelector(MAP_TOUR_TARGETS.legend)) ??
      targetRoot.ownerDocument?.querySelector<HTMLElement>(targetSelector(MAP_TOUR_TARGETS.legend)) ??
      null;
    return isVisibleTarget(target) ? target : null;
  };

  const getSharePanelTarget = (): HTMLElement | null => {
    const shareBtn = getShareChipTarget();
    if (!shareBtn) return null;
    const panel = shareBtn.parentElement
      ? shareBtn.parentElement.querySelector<HTMLElement>('[role="dialog"][aria-label="Share options"]')
      : null;
    return isVisibleTarget(panel) ? panel : null;
  };

  const getSearchBarTarget = (): HTMLElement | null => {
    const doc = targetRoot.ownerDocument;
    if (!doc) return null;
    const input = doc.querySelector<HTMLInputElement>('input[placeholder="Stats, orgs, cities, zips, addresses..."]');
    const menuBtn = Array.from(doc.querySelectorAll<HTMLButtonElement>("button[title]")).find((button) => {
      const title = (button.getAttribute("title") ?? "").trim().toLowerCase();
      return (
        title.includes("sidebar") &&
        (title.includes("expand") || title.includes("collapse")) &&
        isVisibleTarget(button)
      );
    });
    const visibleInput = input && isVisibleTarget(input) ? input : null;
    const visibleMenuBtn = menuBtn && isVisibleTarget(menuBtn) ? menuBtn : null;
    if (visibleInput && visibleMenuBtn) {
      let row: HTMLElement | null = visibleInput.parentElement;
      while (row && !row.contains(visibleMenuBtn)) {
        row = row.parentElement;
      }
      if (isVisibleTarget(row)) return row;
    }
    return visibleInput ?? visibleMenuBtn ?? null;
  };

  const getMyLocationTarget = (): HTMLElement | null => {
    const doc = targetRoot.ownerDocument;
    if (!doc) return null;
    const candidates = Array.from(doc.querySelectorAll<HTMLButtonElement>("button"));
    for (const button of candidates) {
      if (!isVisibleTarget(button)) continue;
      const ariaLabel = (button.getAttribute("aria-label") ?? "").trim();
      const text = (button.textContent ?? "").trim();
      if (ariaLabel === "Zoom to location") continue;
      if (
        ariaLabel === "My Location" ||
        ariaLabel === "Locating..." ||
        ariaLabel === "Zoom" ||
        text === "My Location" ||
        text === "Locating..." ||
        text === "Zoom"
      ) {
        return button;
      }
    }
    return null;
  };

  const openSelectedStatDropdown = (): boolean => {
    const chipBtn = getSelectedStatChipTarget() as HTMLButtonElement | null;
    if (!chipBtn) return false;
    if (chipBtn.getAttribute("aria-expanded") !== "true") {
      chipBtn.click();
    }
    return chipBtn.getAttribute("aria-expanded") === "true";
  };

  const closeSelectedStatDropdown = () => {
    const chipBtn = targetRoot.querySelector<HTMLButtonElement>(targetSelector(MAP_TOUR_TARGETS.primaryStatChip));
    if (!chipBtn) return;
    if (chipBtn.getAttribute("aria-expanded") === "true") {
      chipBtn.click();
    }
  };

  const openShowingPanel = (): boolean => {
    const showingBtn = getShowingChipTarget() as HTMLButtonElement | null;
    if (!showingBtn) return false;
    if (showingBtn.getAttribute("aria-expanded") !== "true") {
      showingBtn.click();
    }
    return showingBtn.getAttribute("aria-expanded") === "true";
  };

  const closeShowingPanel = () => {
    const showingBtn = targetRoot.querySelector<HTMLButtonElement>(targetSelector(MAP_TOUR_TARGETS.showingChip));
    if (!showingBtn) return;
    if (showingBtn.getAttribute("aria-expanded") !== "true") return;
    showingBtn.click();
    if (showingBtn.getAttribute("aria-expanded") === "true") {
      showingBtn.click();
    }
  };

  const openSharePanel = (): boolean => {
    const shareBtn = getShareChipTarget() as HTMLButtonElement | null;
    if (!shareBtn) return false;
    if (shareBtn.getAttribute("aria-expanded") !== "true") {
      shareBtn.click();
    }
    return shareBtn.getAttribute("aria-expanded") === "true";
  };

  const closeSharePanel = () => {
    const shareBtn = targetRoot.querySelector<HTMLButtonElement>(targetSelector(MAP_TOUR_TARGETS.shareChip));
    if (!shareBtn) return;
    if (shareBtn.getAttribute("aria-expanded") !== "true") return;
    shareBtn.click();
    if (shareBtn.getAttribute("aria-expanded") === "true") {
      shareBtn.click();
    }
  };

  const setTourLock = (lock: string | null) => {
    if (!lock) {
      targetRoot.removeAttribute(MAP_TOUR_LOCK_ATTR);
      return;
    }
    targetRoot.setAttribute(MAP_TOUR_LOCK_ATTR, lock);
  };

  const hideTourStep = () => {
    onboardingStep = null;
    onboardingForceStart = false;
    stepOverlay.classList.add("hidden");
    clearOnboardingRetry();
    if (onboardingPositionRaf !== null) {
      cancelAnimationFrame(onboardingPositionRaf);
      onboardingPositionRaf = null;
    }
    setTourLock(null);
    closeSelectedStatDropdown();
    closeShowingPanel();
    closeSharePanel();
  };

  const positionTourStep = (target: HTMLElement) => {
    const containerRect = container.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    const pad = 6;
    const insetPad = 8;

    const highlightLeft = Math.max(insetPad, targetRect.left - containerRect.left - pad);
    const highlightTop = Math.max(insetPad, targetRect.top - containerRect.top - pad);
    const highlightWidth = Math.max(40, targetRect.width + pad * 2);
    const highlightHeight = Math.max(30, targetRect.height + pad * 2);

    highlightBox.style.left = `${highlightLeft}px`;
    highlightBox.style.top = `${highlightTop}px`;
    highlightBox.style.width = `${highlightWidth}px`;
    highlightBox.style.height = `${highlightHeight}px`;

    stepCard.style.visibility = "hidden";
    stepCard.style.left = `${insetPad}px`;
    stepCard.style.top = `${insetPad}px`;
    stepCard.style.maxWidth = `${Math.max(220, Math.min(352, containerRect.width - insetPad * 2))}px`;

    const cardRect = stepCard.getBoundingClientRect();
    const cardWidth = cardRect.width;
    const cardHeight = cardRect.height;

    const clampLeft = (left: number): number => {
      const maxLeft = Math.max(insetPad, containerRect.width - cardWidth - insetPad);
      return Math.min(Math.max(left, insetPad), maxLeft);
    };
    const clampTop = (top: number): number => {
      const maxTop = Math.max(insetPad, containerRect.height - cardHeight - insetPad);
      return Math.min(Math.max(top, insetPad), maxTop);
    };

    const getLocalRect = (rect: DOMRect): LocalRect => ({
      left: rect.left - containerRect.left,
      top: rect.top - containerRect.top,
      right: rect.right - containerRect.left,
      bottom: rect.bottom - containerRect.top,
    });

    // Always avoid covering the highlighted target itself when placing the card.
    const avoidRects: LocalRect[] = [
      {
        left: highlightLeft,
        top: highlightTop,
        right: highlightLeft + highlightWidth,
        bottom: highlightTop + highlightHeight,
      },
    ];
    if (onboardingStep === "share") {
      const sharePanel = getSharePanelTarget();
      if (sharePanel) {
        avoidRects.push(getLocalRect(sharePanel.getBoundingClientRect()));
      }
    }

    const toCardRect = (left: number, top: number): LocalRect => ({
      left,
      top,
      right: left + cardWidth,
      bottom: top + cardHeight,
    });

    const intersectionArea = (a: LocalRect, b: LocalRect): number => {
      const overlapLeft = Math.max(a.left, b.left);
      const overlapTop = Math.max(a.top, b.top);
      const overlapRight = Math.min(a.right, b.right);
      const overlapBottom = Math.min(a.bottom, b.bottom);
      if (overlapRight <= overlapLeft || overlapBottom <= overlapTop) return 0;
      return (overlapRight - overlapLeft) * (overlapBottom - overlapTop);
    };

    const scoreCandidate = (left: number, top: number): number => {
      if (avoidRects.length === 0) return 0;
      const card = toCardRect(left, top);
      return avoidRects.reduce((sum, avoid) => sum + intersectionArea(card, avoid), 0);
    };

    const candidates: Array<{ left: number; top: number }> = [];
    const addCandidate = (left: number, top: number) => {
      candidates.push({ left: clampLeft(left), top: clampTop(top) });
    };

    addCandidate(highlightLeft, highlightTop + highlightHeight + 10);
    addCandidate(highlightLeft, highlightTop - cardHeight - 10);
    addCandidate(highlightLeft + highlightWidth + 10, highlightTop);
    addCandidate(highlightLeft - cardWidth - 10, highlightTop);

    for (const avoid of avoidRects) {
      addCandidate(highlightLeft, avoid.bottom + 10);
      addCandidate(highlightLeft, avoid.top - cardHeight - 10);
      addCandidate(avoid.right + 10, highlightTop);
      addCandidate(avoid.left - cardWidth - 10, highlightTop);
    }

    let best = candidates[0] ?? { left: clampLeft(highlightLeft), top: clampTop(highlightTop + highlightHeight + 10) };
    let bestScore = scoreCandidate(best.left, best.top);
    for (let i = 1; i < candidates.length; i += 1) {
      const next = candidates[i];
      const nextScore = scoreCandidate(next.left, next.top);
      if (nextScore < bestScore) {
        best = next;
        bestScore = nextScore;
        if (bestScore === 0) break;
      }
    }

    stepCard.style.left = `${best.left}px`;
    stepCard.style.top = `${best.top}px`;
    stepCard.style.visibility = "visible";
  };

  const renderTourCard = (
    message: string,
    primary: { label: string; onClick: () => void },
    secondary?: { label: string; onClick: () => void; tone?: "neutral" | "primary" },
  ) => {
    stepCard.replaceChildren();
    const copy = document.createElement("p");
    copy.className = "text-xs leading-5 text-slate-700 dark:text-slate-200";
    copy.textContent = message;
    stepCard.appendChild(copy);

    const actions = document.createElement("div");
    actions.className = "mt-3 flex items-center justify-end gap-2";
    if (secondary) {
      const secondaryBtn = document.createElement("button");
      secondaryBtn.type = "button";
      secondaryBtn.className =
        secondary.tone === "primary"
          ? "rounded-md bg-brand-500 px-2.5 py-1 text-xs font-medium text-white transition hover:bg-brand-600 dark:bg-brand-600 dark:hover:bg-brand-500"
          : "rounded-md border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-600 transition hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800";
      secondaryBtn.textContent = secondary.label;
      secondaryBtn.addEventListener("click", secondary.onClick);
      actions.appendChild(secondaryBtn);
    }
    const primaryBtn = document.createElement("button");
    primaryBtn.type = "button";
    primaryBtn.className =
      "rounded-md bg-brand-500 px-2.5 py-1 text-xs font-medium text-white transition hover:bg-brand-600 dark:bg-brand-600 dark:hover:bg-brand-500";
    primaryBtn.textContent = primary.label;
    primaryBtn.addEventListener("click", primary.onClick);
    actions.appendChild(primaryBtn);
    stepCard.appendChild(actions);
  };

  const dismissTour = () => {
    hideWelcomeToast();
    hideTourStep();
    setOnboardingDismissed();
  };

  const showChipStep = (attempt = 0) => {
    clearOnboardingRetry();
    const target = getSelectedStatChipTarget();
    if (!target) {
      const maxAttempts = onboardingForceStart ? 200 : 20;
      if (attempt < maxAttempts) {
        onboardingRetryTimer = window.setTimeout(() => showChipStep(attempt + 1), onboardingForceStart ? 250 : 120);
      } else {
        onboardingForceStart = false;
        showWelcomeToast();
      }
      return;
    }
    onboardingStep = "chip";
    onboardingForceStart = false;
    stepOverlay.classList.remove("hidden");
    renderTourCard(
      "This is your currently selected statistic, defaulting to Population. Click for quick access to variations of the stat.",
      {
        label: "Next",
        onClick: () => {
          if (!openSelectedStatDropdown()) {
            return;
          }
          showChangeStep();
        },
      },
      { label: "Dismiss", onClick: dismissTour },
    );
    positionTourStep(target);
  };

  const showChangeStep = (attempt = 0) => {
    clearOnboardingRetry();
    const target = getChangeOptionTarget();
    if (!target) {
      if (attempt < (onboardingForceStart ? 120 : 12)) {
        onboardingRetryTimer = window.setTimeout(() => showChangeStep(attempt + 1), 100);
      } else {
        showChipStep();
      }
      return;
    }
    onboardingStep = "change";
    setTourLock(MAP_TOUR_LOCKS.primaryStatMenu);
    stepOverlay.classList.remove("hidden");
    renderTourCard(
      "You can even see change over time mapped out.",
      {
        label: "Next",
        onClick: () => {
          setTourLock(null);
          closeSelectedStatDropdown();
          showShowingTriggerStep();
        },
      },
      { label: "Dismiss", onClick: dismissTour },
    );
    positionTourStep(target);
  };

  const showShowingTriggerStep = (attempt = 0) => {
    clearOnboardingRetry();
    setTourLock(null);
    closeSelectedStatDropdown();
    const target = getShowingChipTarget();
    if (!target) {
      if (attempt < (onboardingForceStart ? 120 : 16)) {
        onboardingRetryTimer = window.setTimeout(() => showShowingTriggerStep(attempt + 1), 120);
      } else {
        showChangeStep();
      }
      return;
    }
    onboardingStep = "showingTrigger";
    stepOverlay.classList.remove("hidden");
    renderTourCard(
      "Click the Showing... button to change your map's appearance.",
      {
        label: "Next",
        onClick: () => {
          if (!openShowingPanel()) return;
          showShowingExtremasStep();
        },
      },
      { label: "Dismiss", onClick: dismissTour },
    );
    positionTourStep(target);
  };

  const showShowingExtremasStep = (attempt = 0) => {
    clearOnboardingRetry();
    if (!openShowingPanel()) {
      if (attempt < 24) {
        onboardingRetryTimer = window.setTimeout(() => showShowingExtremasStep(attempt + 1), 100);
      } else {
        showShowingTriggerStep();
      }
      return;
    }
    const target = getShowingExtremasTarget();
    if (!target) {
      if (attempt < 24) {
        onboardingRetryTimer = window.setTimeout(() => showShowingExtremasStep(attempt + 1), 100);
      } else {
        showShowingTriggerStep();
      }
      return;
    }
    onboardingStep = "showingExtremas";
    stepOverlay.classList.remove("hidden");
    renderTourCard(
      "Extremas are currently showing the highest and lowest values for various statistics on the map. Hover them on the map to see the greatest values for all Oklahoma, OKC, or Tulsa.",
      { label: "Next", onClick: () => showShowingOrganizationsStep() },
      { label: "Dismiss", onClick: dismissTour },
    );
    positionTourStep(target);
  };

  const showShowingOrganizationsStep = (attempt = 0) => {
    clearOnboardingRetry();
    if (!openShowingPanel()) {
      if (attempt < 24) {
        onboardingRetryTimer = window.setTimeout(() => showShowingOrganizationsStep(attempt + 1), 100);
      } else {
        showShowingTriggerStep();
      }
      return;
    }
    const target = getShowingOrganizationsTarget();
    if (!target) {
      if (attempt < 24) {
        onboardingRetryTimer = window.setTimeout(() => showShowingOrganizationsStep(attempt + 1), 100);
      } else {
        showShowingTriggerStep();
      }
      return;
    }
    onboardingStep = "showingOrganizations";
    stepOverlay.classList.remove("hidden");
    renderTourCard(
      "Organizations shows organization points on the map (sourced from Google and ProPublica). Zoom in and hover or click them to see their details.",
      { label: "Next", onClick: () => showShowingAreasStep() },
      { label: "Dismiss", onClick: dismissTour },
    );
    positionTourStep(target);
  };

  const showShowingAreasStep = (attempt = 0) => {
    clearOnboardingRetry();
    if (!openShowingPanel()) {
      if (attempt < 24) {
        onboardingRetryTimer = window.setTimeout(() => showShowingAreasStep(attempt + 1), 100);
      } else {
        showShowingTriggerStep();
      }
      return;
    }
    const target = getShowingAreasTarget();
    if (!target) {
      if (attempt < 24) {
        onboardingRetryTimer = window.setTimeout(() => showShowingAreasStep(attempt + 1), 100);
      } else {
        showShowingTriggerStep();
      }
      return;
    }
    onboardingStep = "showingAreas";
    stepOverlay.classList.remove("hidden");
    renderTourCard(
      "Areas determines the boundaries of your map areas, which defaults to changing as you zoom in. You can also fix it to ZIP, County, and more modes coming soon.",
      {
        label: "Next",
        onClick: () => {
          closeShowingPanel();
          showShareStep();
        },
      },
      { label: "Dismiss", onClick: dismissTour },
    );
    positionTourStep(target);
  };

  const showShareStep = (attempt = 0) => {
    clearOnboardingRetry();
    closeShowingPanel();
    if (!openSharePanel()) {
      if (attempt < 24) {
        onboardingRetryTimer = window.setTimeout(() => showShareStep(attempt + 1), 100);
      } else {
        showShowingAreasStep();
      }
      return;
    }
    const target = getShareChipTarget();
    if (!target) {
      if (attempt < 24) {
        onboardingRetryTimer = window.setTimeout(() => showShareStep(attempt + 1), 100);
      } else {
        showShowingAreasStep();
      }
      return;
    }
    onboardingStep = "share";
    stepOverlay.classList.remove("hidden");
    renderTourCard(
      "Hover over Share to reveal its menu. When you have the map the way you want, copy the URL link, screenshot, or data to present to others you work with.",
      {
        label: "Next",
        onClick: () => {
          closeSharePanel();
          showSearchMenuStep();
        },
      },
      { label: "Dismiss", onClick: dismissTour },
    );
    positionTourStep(target);
  };

  const showSearchMenuStep = (attempt = 0) => {
    clearOnboardingRetry();
    closeSharePanel();
    const target = getSearchBarTarget();
    if (!target) {
      if (attempt < 24) {
        onboardingRetryTimer = window.setTimeout(() => showSearchMenuStep(attempt + 1), 120);
      } else {
        showShareStep();
      }
      return;
    }
    onboardingStep = "searchMenu";
    stepOverlay.classList.remove("hidden");
    renderTourCard(
      "The search bar allows you to pull up just the statistics or organizations you need or learn about specific zips, addresses, etc. Click the menu button to open the sidebar.",
      { label: "Next", onClick: () => showMyLocationStep() },
      { label: "Dismiss", onClick: dismissTour },
    );
    positionTourStep(target);
  };

  const showMyLocationStep = (attempt = 0) => {
    clearOnboardingRetry();
    const target = getMyLocationTarget();
    if (!target) {
      if (attempt < 24) {
        onboardingRetryTimer = window.setTimeout(() => showMyLocationStep(attempt + 1), 120);
      } else {
        showSearchMenuStep();
      }
      return;
    }
    onboardingStep = "myLocation";
    stepOverlay.classList.remove("hidden");
    renderTourCard(
      "The My Location button will zoom to where you are now.",
      { label: "Next", onClick: () => showLegendStep() },
      { label: "Dismiss", onClick: dismissTour },
    );
    positionTourStep(target);
  };

  const showLegendStep = (attempt = 0) => {
    clearOnboardingRetry();
    const target = getLegendTarget();
    if (!target) {
      if (attempt < 24) {
        onboardingRetryTimer = window.setTimeout(() => showLegendStep(attempt + 1), 120);
      } else {
        showMyLocationStep();
      }
      return;
    }
    onboardingStep = "legend";
    stepOverlay.classList.remove("hidden");
    renderTourCard(
      "The legend shows the range of data for the current stat, represented by the color intensities (choropleth) on the map.",
      { label: "Done", onClick: dismissTour },
      { label: "Dismiss", onClick: dismissTour },
    );
    positionTourStep(target);
  };

  const targetForStep = (step: OnboardingStep): HTMLElement | null => {
    switch (step) {
      case "chip":
        return getSelectedStatChipTarget();
      case "change":
        return getChangeOptionTarget();
      case "showingTrigger":
        return getShowingChipTarget();
      case "showingExtremas":
        return getShowingExtremasTarget();
      case "showingOrganizations":
        return getShowingOrganizationsTarget();
      case "showingAreas":
        return getShowingAreasTarget();
      case "share":
        return getShareChipTarget();
      case "searchMenu":
        return getSearchBarTarget();
      case "myLocation":
        return getMyLocationTarget();
      case "legend":
        return getLegendTarget();
      default:
        return null;
    }
  };

  const startTourFlowFromBanner = () => {
    hideWelcomeToast();
    onboardingForceStart = true;
    showChipStep();
  };

  const start = () => {
    onboardingDismissed = false;
    hideTourStep();
    onboardingForceStart = false;
    showWelcomeToast();
  };

  const refresh = () => {
    if (!onboardingStep) return;
    const currentStep = onboardingStep;
    if (onboardingPositionRaf !== null) {
      cancelAnimationFrame(onboardingPositionRaf);
    }
    onboardingPositionRaf = requestAnimationFrame(() => {
      onboardingPositionRaf = null;
      if (!currentStep) return;
      if (
        currentStep === "change"
      ) {
        openSelectedStatDropdown();
      }
      if (
        currentStep === "showingExtremas" ||
        currentStep === "showingOrganizations" ||
        currentStep === "showingAreas"
      ) {
        openShowingPanel();
      }
      if (currentStep === "share") {
        openSharePanel();
      }
      const target = targetForStep(currentStep);
      if (target) {
        positionTourStep(target);
      }
    });
  };

  dismissWelcomeBtn.addEventListener("click", dismissTour);
  startTourBtn.addEventListener("click", startTourFlowFromBanner);
  window.addEventListener("resize", refresh);

  if (!onboardingDismissed) {
    showWelcomeToast();
  }

  const destroy = () => {
    clearOnboardingRetry();
    if (onboardingPositionRaf !== null) {
      cancelAnimationFrame(onboardingPositionRaf);
      onboardingPositionRaf = null;
    }
    dismissWelcomeBtn.removeEventListener("click", dismissTour);
    startTourBtn.removeEventListener("click", startTourFlowFromBanner);
    window.removeEventListener("resize", refresh);
    hideTourStep();
    welcomeToast.remove();
    stepOverlay.remove();
  };

  return { start, refresh, destroy };
};
