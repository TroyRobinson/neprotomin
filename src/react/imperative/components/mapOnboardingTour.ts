import {
  MAP_TOUR_CHANGE_OPTION_ATTR,
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
  | "showingAreas";

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

  const hideTourStep = () => {
    onboardingStep = null;
    onboardingForceStart = false;
    stepOverlay.classList.add("hidden");
    clearOnboardingRetry();
    if (onboardingPositionRaf !== null) {
      cancelAnimationFrame(onboardingPositionRaf);
      onboardingPositionRaf = null;
    }
    closeSelectedStatDropdown();
    closeShowingPanel();
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
    let cardTop = highlightTop + highlightHeight + 10;
    if (cardTop + cardRect.height > containerRect.height - insetPad) {
      cardTop = Math.max(insetPad, highlightTop - cardRect.height - 10);
    }
    let cardLeft = highlightLeft;
    if (cardLeft + cardRect.width > containerRect.width - insetPad) {
      cardLeft = Math.max(insetPad, containerRect.width - cardRect.width - insetPad);
    }

    stepCard.style.left = `${cardLeft}px`;
    stepCard.style.top = `${cardTop}px`;
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
    stepOverlay.classList.remove("hidden");
    renderTourCard(
      "You can even see change over time mapped out.",
      {
        label: "Next",
        onClick: () => {
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
        currentStep === "showingExtremas" ||
        currentStep === "showingOrganizations" ||
        currentStep === "showingAreas"
      ) {
        openShowingPanel();
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
