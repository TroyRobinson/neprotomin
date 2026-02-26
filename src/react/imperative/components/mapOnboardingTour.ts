import {
  MAP_TOUR_CHANGE_OPTION_ATTR,
  MAP_TOUR_LOCK_ATTR,
  MAP_TOUR_LOCKS,
  MAP_TOUR_STAT_LABEL_ATTR,
  MAP_TOUR_TARGET_ATTR,
  MAP_TOUR_TARGETS,
} from "../constants/mapTourTargets";
import {
  MAP_TOUR_ADD_AREAS_PRESET,
  MAP_TOUR_ADVANCED_STATS_PRESET,
  MAP_TOUR_APPLY_STATE_EVENT,
  MAP_TOUR_CLOSE_ADD_AREAS_EVENT,
  MAP_TOUR_DEMOGRAPHICS_PRESET,
  MAP_TOUR_EXTREMAS_PRESET,
  MAP_TOUR_OPEN_FEEDBACK_EVENT,
  MAP_TOUR_OTHER_STATS_PRESET,
  MAP_TOUR_ORGS_PRESET,
  MAP_TOUR_SHOWING_AREAS_PRESET,
  MAP_TOUR_SIDEBAR_CATEGORY_PRESET,
  MAP_TOUR_SIDEBAR_ORGS_PRESET,
  MAP_TOUR_RESET_TO_DEFAULTS_EVENT,
  MAP_TOUR_SET_CAMERA_EVENT,
  MAP_TOUR_SET_STAT_EVENT,
  type MapTourApplyStateDetail,
} from "../constants/mapTourEvents";

export interface MapOnboardingTourController {
  start: () => void;
  showIntro: () => void;
  setAutoPromptEnabled: (enabled: boolean) => void;
  refresh: () => void;
  destroy: () => void;
}

interface MapOnboardingTourOptions {
  container: HTMLElement;
  targetRoot: HTMLElement;
  enabled?: boolean;
  autoPromptEnabled?: boolean;
  dismissedStorageKey?: string;
  preferredChangeOptionLabel?: string;
}

const DEFAULT_DISMISSED_STORAGE_KEY = "ne.map.onboarding.dismissed.v1";
const DEFAULT_PREFERRED_CHANGE_OPTION_LABEL = "Population (Change '21-23)";
const TOUR_DEFAULT_STAT_ID = "8807bf0b-5a85-4a73-82f2-cd18c8140072";
const TOUR_CHANGE_OVER_TIME_STAT_ID = "0a7081d7-1374-41a8-bd48-41bb3933957e";
const TOUR_SHARE_STAT_ID = "4c3df0b2-53b4-4697-a1cf-50c9214b2731";
const TOUR_MY_LOCATION_STAT_ID = "ed615d44-6bc0-43d7-9408-b191315d9070";
const TOUR_SIDEBAR_STAT_DETAILS_ID = "ce870153-e57c-4c7b-97b9-14af9072dbd3";
const TOUR_OTHER_STATS_SECONDARY_STAT_ID = "78b293e5-061e-471b-b48e-0d187e82ed55";
const TOUR_SIDEBAR_STAT_DETAILS_LAT = 35.4606;
const TOUR_SIDEBAR_STAT_DETAILS_LNG = -100.0266;
const TOUR_SIDEBAR_STAT_DETAILS_ZOOM = 6.61;
const TOUR_SHARE_LAT = 35.3393;
const TOUR_SHARE_LNG = -97.4195;
const TOUR_SHARE_ZOOM = 6.39;
const TOUR_POST_RESET_LAT = 35.6846;
const TOUR_POST_RESET_LNG = -97.4293;
const TOUR_POST_RESET_ZOOM = 6.88;
const TOUR_STATE_SETTLE_MS = 220;
const TOUR_HIGHLIGHT_BORDER_COLOR = "#f15b41";
const TOUR_HIGHLIGHT_GLOW_RGBA = "241, 91, 65";
const TOUR_HIGHLIGHT_BASE_SHADOW = `0 0 0 4px rgba(${TOUR_HIGHLIGHT_GLOW_RGBA}, 0.22)`;
const TOUR_PRIMARY_BUTTON_CLASS =
  "shrink-0 whitespace-nowrap rounded-md bg-[#f15b41] px-2.5 py-1 text-xs font-medium text-white transition hover:bg-[#d64f38]";
const TOUR_NEUTRAL_BUTTON_CLASS =
  "shrink-0 whitespace-nowrap rounded-md border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-600 transition hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800";
const TOUR_DISMISS_BUTTON_CLASS =
  "shrink-0 whitespace-nowrap rounded-md border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-600 transition hover:border-red-200 hover:bg-red-50 hover:text-red-600 dark:border-slate-700 dark:text-slate-300 dark:hover:border-red-400/40 dark:hover:bg-red-500/10 dark:hover:text-red-200";

type OnboardingStep =
  | "change"
  | "showingExtremas"
  | "showingOrganizations"
  | "showingAreas"
  | "share"
  | "searchMenu"
  | "sidebarStatDetails"
  | "advancedStats"
  | "sidebarAddAreas"
  | "sidebarDemographicsExpand"
  | "sidebarOtherStats"
  | "sidebarOrgsTab"
  | "sidebarHoursFilter"
  | "sidebarCategoryFilter"
  | "tourFinale"
  | "myLocation"
  | "legend"
  | "brandLogo";

const TOUR_STEP_SEQUENCE: readonly OnboardingStep[] = [
  "change",
  "showingExtremas",
  "showingOrganizations",
  "showingAreas",
  "share",
  "myLocation",
  "legend",
  "brandLogo",
  "searchMenu",
  "sidebarStatDetails",
  "advancedStats",
  "sidebarAddAreas",
  "sidebarDemographicsExpand",
  "sidebarOtherStats",
  "sidebarOrgsTab",
  "sidebarHoursFilter",
  "sidebarCategoryFilter",
  "tourFinale",
];
const TOUR_PROGRESS_EXCLUDED_STEPS = new Set<OnboardingStep>(["brandLogo", "tourFinale"]);
const TOUR_PROGRESS_TOTAL_STEPS = TOUR_STEP_SEQUENCE.filter((step) => !TOUR_PROGRESS_EXCLUDED_STEPS.has(step)).length;

const targetSelector = (target: string): string => `[${MAP_TOUR_TARGET_ATTR}="${target}"]`;

const createNoopController = (): MapOnboardingTourController => ({
  start: () => {},
  showIntro: () => {},
  setAutoPromptEnabled: () => {},
  refresh: () => {},
  destroy: () => {},
});

const isVisibleTarget = (target: HTMLElement | null): target is HTMLElement => {
  if (!target) return false;
  if (target.classList.contains("hidden")) return false;
  return target.getClientRects().length > 0;
};

const countProgressStepsThrough = (step: OnboardingStep | null): number => {
  if (!step) return 0;
  const currentIndex = TOUR_STEP_SEQUENCE.indexOf(step);
  if (currentIndex < 0) return 0;
  let completed = 0;
  for (let i = 0; i <= currentIndex; i += 1) {
    if (!TOUR_PROGRESS_EXCLUDED_STEPS.has(TOUR_STEP_SEQUENCE[i])) {
      completed += 1;
    }
  }
  return completed;
};

type LocalRect = { left: number; top: number; right: number; bottom: number };
type TourCardPosition = { step: OnboardingStep; left: number; top: number };
type TourCardContent =
  | string
  | Node
  | {
      body?: string | Node;
      action?: string | Node;
      note?: string | Node;
    };

export const createMapOnboardingTour = ({
  container,
  targetRoot,
  enabled = true,
  autoPromptEnabled: initialAutoPromptEnabled = true,
  dismissedStorageKey = DEFAULT_DISMISSED_STORAGE_KEY,
  preferredChangeOptionLabel = DEFAULT_PREFERRED_CHANGE_OPTION_LABEL,
}: MapOnboardingTourOptions): MapOnboardingTourController => {
  if (!enabled) {
    return createNoopController();
  }

  let onboardingStep: OnboardingStep | null = null;
  let onboardingRetryTimer: number | null = null;
  let onboardingPositionRaf: number | null = null;
  let onboardingCardPosition: TourCardPosition | null = null;
  let onboardingLastFlashedStep: OnboardingStep | null = null;
  let highlightFlashAnimation: Animation | null = null;
  let secondaryHighlightFlashAnimation: Animation | null = null;
  let restartHintTimer: number | null = null;
  let restartHintFadeTimer: number | null = null;
  let helpMenuSuppressed = false;
  let onboardingForceStart = false;
  let shareStepAutoCopyTriggered = false;
  let myLocationStepAutoTriggered = false;
  let brandLogoStepAutoTriggered = false;
  let autoPromptEnabled = initialAutoPromptEnabled;
  let onboardingDismissed = false;
  let tourSelectedStatId: string | null = null;
  try {
    onboardingDismissed = window.localStorage.getItem(dismissedStorageKey) === "1";
  } catch {}

  const welcomeToast = document.createElement("div");
  welcomeToast.className =
    "pointer-events-auto absolute z-[32] hidden w-[22rem] rounded-xl border border-slate-200 bg-white/95 p-3.5 shadow-xl backdrop-blur-sm dark:border-slate-700 dark:bg-slate-900/95";
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
  startTourBtn.className = TOUR_PRIMARY_BUTTON_CLASS;
  startTourBtn.textContent = "Start tour";
  welcomeActions.appendChild(dismissWelcomeBtn);
  welcomeActions.appendChild(startTourBtn);
  welcomeToast.appendChild(welcomeActions);
  container.appendChild(welcomeToast);

  const restartHintToast = document.createElement("div");
  restartHintToast.className =
    "pointer-events-none absolute z-[33] hidden max-w-[15rem] rounded-lg border border-brand-200/80 bg-white/95 px-2.5 py-1.5 text-[11px] font-medium leading-4 text-slate-700 opacity-0 shadow-lg transition-opacity duration-150 ease-out backdrop-blur-sm dark:border-brand-500/40 dark:bg-slate-900/95 dark:text-slate-200";
  restartHintToast.setAttribute("role", "status");
  restartHintToast.setAttribute("aria-live", "polite");
  restartHintToast.textContent = "Click here to start the tour again";
  container.appendChild(restartHintToast);

  const stepOverlay = document.createElement("div");
  stepOverlay.className = "pointer-events-none absolute inset-0 z-[14] hidden";
  const highlightBox = document.createElement("div");
  highlightBox.className = "absolute rounded-2xl border-2";
  highlightBox.style.borderColor = TOUR_HIGHLIGHT_BORDER_COLOR;
  highlightBox.style.boxShadow = TOUR_HIGHLIGHT_BASE_SHADOW;
  const secondaryHighlightBox = document.createElement("div");
  secondaryHighlightBox.className = "absolute hidden rounded-2xl border-2";
  secondaryHighlightBox.style.borderColor = TOUR_HIGHLIGHT_BORDER_COLOR;
  secondaryHighlightBox.style.boxShadow = TOUR_HIGHLIGHT_BASE_SHADOW;
  const stepCard = document.createElement("div");
  stepCard.className =
    "pointer-events-auto absolute max-w-[22rem] rounded-xl border border-slate-200 bg-white/95 p-3.5 shadow-xl backdrop-blur-sm dark:border-slate-700 dark:bg-slate-900/95";
  stepOverlay.appendChild(highlightBox);
  stepOverlay.appendChild(secondaryHighlightBox);
  stepOverlay.appendChild(stepCard);
  container.appendChild(stepOverlay);

  const clearOnboardingRetry = () => {
    if (onboardingRetryTimer !== null) {
      window.clearTimeout(onboardingRetryTimer);
      onboardingRetryTimer = null;
    }
  };

  const clearRestartHintTimer = () => {
    if (restartHintTimer !== null) {
      window.clearTimeout(restartHintTimer);
      restartHintTimer = null;
    }
    if (restartHintFadeTimer !== null) {
      window.clearTimeout(restartHintFadeTimer);
      restartHintFadeTimer = null;
    }
  };

  const setOnboardingDismissed = () => {
    onboardingDismissed = true;
    try {
      window.localStorage.setItem(dismissedStorageKey, "1");
    } catch {}
  };

  const clearOnboardingDismissed = () => {
    onboardingDismissed = false;
    try {
      window.localStorage.removeItem(dismissedStorageKey);
    } catch {}
  };

  const showWelcomeToast = ({ force = false }: { force?: boolean } = {}) => {
    if (!force && !autoPromptEnabled) return;
    if (onboardingDismissed) return;
    welcomeToast.classList.remove("hidden");
    requestAnimationFrame(() => {
      positionWelcomeToast();
    });
  };

  const hideWelcomeToast = () => {
    welcomeToast.classList.add("hidden");
  };

  const hideRestartHintToast = (immediate = false) => {
    clearRestartHintTimer();
    if (restartHintToast.classList.contains("hidden")) return;
    if (immediate) {
      restartHintToast.classList.remove("opacity-100");
      restartHintToast.classList.add("opacity-0");
      restartHintToast.classList.add("hidden");
      return;
    }
    restartHintToast.classList.remove("opacity-100");
    restartHintToast.classList.add("opacity-0");
    restartHintFadeTimer = window.setTimeout(() => {
      restartHintToast.classList.add("hidden");
      restartHintFadeTimer = null;
    }, 150);
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

  // This toggle may live in a hidden panel; query without visibility checks for reliable cleanup.
  const getShowingOrganizationsButton = (): HTMLButtonElement | null => {
    return targetRoot.querySelector<HTMLButtonElement>(targetSelector(MAP_TOUR_TARGETS.showingOrganizations));
  };

  const getShowingAreasTarget = (): HTMLElement | null => {
    const target = targetRoot.querySelector<HTMLElement>(targetSelector(MAP_TOUR_TARGETS.showingAreas));
    return isVisibleTarget(target) ? target : null;
  };

  const getShowingPanelTarget = (): HTMLElement | null => {
    const target = targetRoot.querySelector<HTMLElement>(targetSelector(MAP_TOUR_TARGETS.showingPanel));
    return isVisibleTarget(target) ? target : null;
  };

  const getShowingAreasMenuTarget = (): HTMLElement | null => {
    const target = targetRoot.querySelector<HTMLElement>(targetSelector(MAP_TOUR_TARGETS.showingAreasMenu));
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

  const getBrandLogoTarget = (): HTMLElement | null => {
    const target =
      container.querySelector<HTMLElement>(targetSelector(MAP_TOUR_TARGETS.brandLogo)) ??
      targetRoot.ownerDocument?.querySelector<HTMLElement>(targetSelector(MAP_TOUR_TARGETS.brandLogo)) ??
      null;
    return isVisibleTarget(target) ? target : null;
  };

  const getHelpButtonTarget = (): HTMLElement | null => {
    const doc = targetRoot.ownerDocument;
    if (!doc) return null;
    const target = doc.querySelector<HTMLElement>('button[aria-label="Help"]');
    return isVisibleTarget(target) ? target : null;
  };

  const getHelpMenuRoot = (): HTMLElement | null => {
    const doc = targetRoot.ownerDocument;
    if (!doc) return null;
    const button = doc.querySelector<HTMLButtonElement>('button[aria-label="Help"]');
    if (!button) return null;
    return button.parentElement instanceof HTMLElement ? button.parentElement : button;
  };

  const setHelpMenuSuppressed = (suppressed: boolean) => {
    if (suppressed === helpMenuSuppressed) return;
    const root = getHelpMenuRoot();
    if (!root) {
      helpMenuSuppressed = suppressed;
      return;
    }
    if (suppressed) {
      root.dataset.neTourPrevVisibility = root.style.visibility || "";
      root.dataset.neTourPrevPointerEvents = root.style.pointerEvents || "";
      root.style.visibility = "hidden";
      root.style.pointerEvents = "none";
      helpMenuSuppressed = true;
      return;
    }
    root.style.visibility = root.dataset.neTourPrevVisibility || "";
    root.style.pointerEvents = root.dataset.neTourPrevPointerEvents || "";
    delete root.dataset.neTourPrevVisibility;
    delete root.dataset.neTourPrevPointerEvents;
    helpMenuSuppressed = false;
  };

  const getSidebarStatDetailsTarget = (): HTMLElement | null => {
    const target =
      container.querySelector<HTMLElement>(targetSelector(MAP_TOUR_TARGETS.sidebarStatDetails)) ??
      targetRoot.ownerDocument?.querySelector<HTMLElement>(targetSelector(MAP_TOUR_TARGETS.sidebarStatDetails)) ??
      null;
    return isVisibleTarget(target) ? target : null;
  };

  const getSidebarAdvancedToggleTarget = (): HTMLElement | null => {
    const target =
      container.querySelector<HTMLElement>(targetSelector(MAP_TOUR_TARGETS.sidebarAdvancedToggle)) ??
      targetRoot.ownerDocument?.querySelector<HTMLElement>(targetSelector(MAP_TOUR_TARGETS.sidebarAdvancedToggle)) ??
      null;
    return isVisibleTarget(target) ? target : null;
  };

  const getSidebarStatVizTarget = (): HTMLElement | null => {
    const target =
      container.querySelector<HTMLElement>(targetSelector(MAP_TOUR_TARGETS.sidebarStatViz)) ??
      targetRoot.ownerDocument?.querySelector<HTMLElement>(targetSelector(MAP_TOUR_TARGETS.sidebarStatViz)) ??
      null;
    return isVisibleTarget(target) ? target : null;
  };

  const getSidebarAddAreasTarget = (): HTMLElement | null => {
    const target =
      container.querySelector<HTMLElement>(targetSelector(MAP_TOUR_TARGETS.sidebarAddAreas)) ??
      targetRoot.ownerDocument?.querySelector<HTMLElement>(targetSelector(MAP_TOUR_TARGETS.sidebarAddAreas)) ??
      null;
    return isVisibleTarget(target) ? target : null;
  };

  const expandSidebarAddAreasDropdown = (target: HTMLElement | null) => {
    if (!target) return;
    target.dispatchEvent(new MouseEvent("mouseover", { bubbles: true, cancelable: true, view: window }));
    target.dispatchEvent(new MouseEvent("mouseenter", { bubbles: false, cancelable: true, view: window }));
  };

  const getSidebarDemographicsToggleButton = (): HTMLDivElement | null => {
    const target = getSidebarDemographicsExpandTarget();
    if (!target) return null;
    const toggle = target.closest<HTMLDivElement>('div[role="button"][aria-expanded]');
    return toggle && isVisibleTarget(toggle) ? toggle : null;
  };

  const ensureSidebarDemographicsExpanded = (expanded: boolean): boolean => {
    const button = getSidebarDemographicsToggleButton();
    if (!button) return false;
    const shouldBe = expanded ? "true" : "false";
    if (button.getAttribute("aria-expanded") !== shouldBe) {
      button.click();
    }
    return button.getAttribute("aria-expanded") === shouldBe;
  };

  const getSidebarDemographicsExpandTarget = (): HTMLElement | null => {
    const target =
      container.querySelector<HTMLElement>(targetSelector(MAP_TOUR_TARGETS.sidebarDemographicsExpand)) ??
      targetRoot.ownerDocument?.querySelector<HTMLElement>(targetSelector(MAP_TOUR_TARGETS.sidebarDemographicsExpand)) ??
      null;
    return isVisibleTarget(target) ? target : null;
  };

  const getSidebarOtherStatsTarget = (): HTMLElement | null => {
    const target =
      container.querySelector<HTMLElement>(targetSelector(MAP_TOUR_TARGETS.sidebarOtherStats)) ??
      targetRoot.ownerDocument?.querySelector<HTMLElement>(targetSelector(MAP_TOUR_TARGETS.sidebarOtherStats)) ??
      null;
    return isVisibleTarget(target) ? target : null;
  };

  const getSidebarOrgsTabTarget = (): HTMLElement | null => {
    const target =
      container.querySelector<HTMLElement>(targetSelector(MAP_TOUR_TARGETS.sidebarOrgsTab)) ??
      targetRoot.ownerDocument?.querySelector<HTMLElement>(targetSelector(MAP_TOUR_TARGETS.sidebarOrgsTab)) ??
      null;
    return isVisibleTarget(target) ? target : null;
  };

  const getSidebarHoursFilterTarget = (): HTMLElement | null => {
    const target =
      container.querySelector<HTMLElement>(targetSelector(MAP_TOUR_TARGETS.sidebarHoursFilter)) ??
      targetRoot.ownerDocument?.querySelector<HTMLElement>(targetSelector(MAP_TOUR_TARGETS.sidebarHoursFilter)) ??
      null;
    return isVisibleTarget(target) ? target : null;
  };

  const getSidebarCategoryFilterTarget = (): HTMLElement | null => {
    const target =
      container.querySelector<HTMLElement>(targetSelector(MAP_TOUR_TARGETS.sidebarCategoryFilter)) ??
      targetRoot.ownerDocument?.querySelector<HTMLElement>(targetSelector(MAP_TOUR_TARGETS.sidebarCategoryFilter)) ??
      null;
    return isVisibleTarget(target) ? target : null;
  };

  const getSidebarCategoryMenuTarget = (): HTMLElement | null => {
    const target =
      container.querySelector<HTMLElement>(targetSelector(MAP_TOUR_TARGETS.sidebarCategoryMenu)) ??
      targetRoot.ownerDocument?.querySelector<HTMLElement>(targetSelector(MAP_TOUR_TARGETS.sidebarCategoryMenu)) ??
      null;
    return isVisibleTarget(target) ? target : null;
  };

  const getAdvancedStatsPrimaryTarget = (): HTMLElement | null =>
    getSidebarStatVizTarget() ?? getSidebarAdvancedToggleTarget();

  const getAdvancedStatsSecondaryTarget = (): HTMLElement | null => {
    const primary = getAdvancedStatsPrimaryTarget();
    const toggle = getSidebarAdvancedToggleTarget();
    if (!toggle) return null;
    if (primary === toggle) return null;
    return toggle;
  };

  const getSharePanelTarget = (): HTMLElement | null => {
    const shareBtn = getShareChipTarget();
    if (!shareBtn) return null;
    const panel = shareBtn.parentElement
      ? shareBtn.parentElement.querySelector<HTMLElement>('[role="dialog"][aria-label="Share options"]')
      : null;
    return isVisibleTarget(panel) ? panel : null;
  };

  const triggerShareScreenshotCopy = (): boolean => {
    const panel = getSharePanelTarget();
    if (!panel) return false;
    const screenshotCopyBtn = panel.querySelector<HTMLButtonElement>(
      'button[title="Copy a map screenshot to the clipboard"]',
    );
    if (!screenshotCopyBtn || screenshotCopyBtn.disabled) return false;
    screenshotCopyBtn.click();
    return true;
  };

  const getPrimaryStatMenuTarget = (): HTMLElement | null => {
    const target = targetRoot.querySelector<HTMLElement>(targetSelector(MAP_TOUR_TARGETS.primaryStatMenu));
    return isVisibleTarget(target) ? target : null;
  };

  const getSidebarToggleButton = (): HTMLButtonElement | null => {
    const doc = targetRoot.ownerDocument;
    if (!doc) return null;
    return (
      Array.from(doc.querySelectorAll<HTMLButtonElement>("button[title]")).find((button) => {
        const title = (button.getAttribute("title") ?? "").trim().toLowerCase();
        return (
          title.includes("sidebar") &&
          (title.includes("expand") || title.includes("collapse")) &&
          isVisibleTarget(button)
        );
      }) ?? null
    );
  };

  const getSearchBarTarget = (): HTMLElement | null => {
    const doc = targetRoot.ownerDocument;
    if (!doc) return null;
    const input = doc.querySelector<HTMLInputElement>('input[placeholder="Stats, orgs, cities, zips, addresses..."]');
    const menuBtn = getSidebarToggleButton();
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

  const ensureShowingOrganizationsVisible = (visible: boolean): boolean => {
    const btn = getShowingOrganizationsButton();
    if (!btn) return false;
    const shouldBe = visible ? "true" : "false";
    if (btn.getAttribute("aria-pressed") !== shouldBe) {
      btn.click();
    }
    return btn.getAttribute("aria-pressed") === shouldBe;
  };

  const ensureShowingExtremasVisible = (visible: boolean): boolean => {
    const btn = getShowingExtremasTarget() as HTMLButtonElement | null;
    if (!btn) return false;
    const shouldBe = visible ? "true" : "false";
    if (btn.getAttribute("aria-pressed") !== shouldBe) {
      btn.click();
    }
    return btn.getAttribute("aria-pressed") === shouldBe;
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

  const openSidebarPanel = (): boolean => {
    const sidebarBtn = getSidebarToggleButton();
    if (!sidebarBtn) return false;
    const title = (sidebarBtn.getAttribute("title") ?? "").trim().toLowerCase();
    if (title.includes("expand")) {
      sidebarBtn.click();
    }
    return true;
  };

  const closeSidebarPanel = (): boolean => {
    const sidebarBtn = getSidebarToggleButton();
    if (!sidebarBtn) return false;
    const title = (sidebarBtn.getAttribute("title") ?? "").trim().toLowerCase();
    if (title.includes("collapse")) {
      sidebarBtn.click();
    }
    return true;
  };

  const exitShowingOrganizationsStep = () => {
    ensureShowingOrganizationsVisible(false);
    closeSidebarPanel();
  };

  const continueAfterShowingOrganizationsExit = (next: () => void) => {
    exitShowingOrganizationsStep();
    clearOnboardingRetry();
    onboardingRetryTimer = window.setTimeout(() => {
      onboardingRetryTimer = null;
      next();
    }, TOUR_STATE_SETTLE_MS);
  };

  const openSidebarOrgsTab = (): boolean => {
    const orgsBtn = getSidebarOrgsTabTarget() as HTMLButtonElement | null;
    if (!orgsBtn) return false;
    if (!orgsBtn.className.includes("border-brand-500")) {
      orgsBtn.click();
    }
    return orgsBtn.className.includes("border-brand-500");
  };

  const openSidebarCategoryMenu = (): boolean => {
    const categoryBtn = getSidebarCategoryFilterTarget() as HTMLButtonElement | null;
    if (!categoryBtn) return false;
    if (!getSidebarCategoryMenuTarget()) {
      categoryBtn.click();
    }
    return Boolean(getSidebarCategoryMenuTarget());
  };

  const applyTourState = (detail: MapTourApplyStateDetail) => {
    window.dispatchEvent(
      new CustomEvent(MAP_TOUR_APPLY_STATE_EVENT, {
        detail,
      }),
    );
  };

  const applyAdvancedStatsPreset = () => {
    applyTourState(MAP_TOUR_ADVANCED_STATS_PRESET);
  };

  const applyTourStat = (statId: string) => {
    if (tourSelectedStatId === statId) return;
    tourSelectedStatId = statId;
    window.dispatchEvent(
      new CustomEvent(MAP_TOUR_SET_STAT_EVENT, {
        detail: { statId },
      }),
    );
  };

  const applyTourSecondaryStat = (secondaryStatId: string | null) => {
    window.dispatchEvent(
      new CustomEvent(MAP_TOUR_SET_STAT_EVENT, {
        detail: { secondaryStatId },
      }),
    );
  };

  const applyTourCamera = (lat: number, lng: number, zoom: number) => {
    window.dispatchEvent(
      new CustomEvent(MAP_TOUR_SET_CAMERA_EVENT, {
        detail: { lat, lng, zoom },
      }),
    );
  };

  const closeSidebarAddAreasDropdown = () => {
    window.dispatchEvent(new CustomEvent(MAP_TOUR_CLOSE_ADD_AREAS_EVENT));
  };

  const resetAppToDefaults = () => {
    window.dispatchEvent(new CustomEvent(MAP_TOUR_RESET_TO_DEFAULTS_EVENT));
  };

  const setTourLock = (lock: string | null) => {
    if (!lock) {
      targetRoot.removeAttribute(MAP_TOUR_LOCK_ATTR);
      return;
    }
    targetRoot.setAttribute(MAP_TOUR_LOCK_ATTR, lock);
  };

  const hideTourStep = () => {
    if (onboardingStep === "showingOrganizations") {
      exitShowingOrganizationsStep();
    }
    if (onboardingStep === "sidebarAddAreas") {
      closeSidebarAddAreasDropdown();
    }
    if (onboardingStep === "sidebarDemographicsExpand") {
      ensureSidebarDemographicsExpanded(false);
    }
    if (onboardingStep === "sidebarOtherStats") {
      applyTourSecondaryStat(null);
    }
    highlightFlashAnimation?.cancel();
    secondaryHighlightFlashAnimation?.cancel();
    highlightFlashAnimation = null;
    secondaryHighlightFlashAnimation = null;
    onboardingLastFlashedStep = null;
    onboardingStep = null;
    onboardingForceStart = false;
    stepOverlay.classList.add("hidden");
    highlightBox.classList.remove("hidden");
    highlightBox.style.position = "absolute";
    secondaryHighlightBox.classList.add("hidden");
    secondaryHighlightBox.style.position = "absolute";
    stepOverlay.style.zIndex = "14";
    clearOnboardingRetry();
    if (onboardingPositionRaf !== null) {
      cancelAnimationFrame(onboardingPositionRaf);
      onboardingPositionRaf = null;
    }
    onboardingCardPosition = null;
    setTourLock(null);
    setHelpMenuSuppressed(false);
    applyTourStat(TOUR_DEFAULT_STAT_ID);
    closeSelectedStatDropdown();
    closeShowingPanel();
    closeSharePanel();
  };

  const flashHighlight = (step: OnboardingStep, includeSecondary: boolean) => {
    if (onboardingLastFlashedStep === step) return;
    onboardingLastFlashedStep = step;

    highlightFlashAnimation?.cancel();
    secondaryHighlightFlashAnimation?.cancel();
    highlightFlashAnimation = null;
    secondaryHighlightFlashAnimation = null;

    const keyframes: Keyframe[] = [
      {
        borderColor: "rgba(241, 91, 65, 0.7)",
        boxShadow: `0 0 0 0 rgba(${TOUR_HIGHLIGHT_GLOW_RGBA}, 0.5), 0 0 0 10px rgba(${TOUR_HIGHLIGHT_GLOW_RGBA}, 0.35)`,
      },
      {
        borderColor: TOUR_HIGHLIGHT_BORDER_COLOR,
        boxShadow: TOUR_HIGHLIGHT_BASE_SHADOW,
      },
    ];
    const timing: KeyframeAnimationOptions = {
      duration: 500,
      easing: "ease-out",
      fill: "forwards",
    };
    highlightFlashAnimation = highlightBox.animate(keyframes, timing);
    if (includeSecondary) {
      secondaryHighlightFlashAnimation = secondaryHighlightBox.animate(keyframes, timing);
    }
  };

  const positionWelcomeToast = () => {
    if (welcomeToast.classList.contains("hidden")) return;
    const containerRect = container.getBoundingClientRect();
    const insetPad = 8;
    const toastToHelpGap = 12;
    const helpAnchorVerticalNudge = 40;
    const fallbackBottomOffset = 72;

    welcomeToast.style.maxWidth = `${Math.max(220, Math.min(352, containerRect.width - insetPad * 2))}px`;
    welcomeToast.style.left = `${insetPad}px`;
    welcomeToast.style.top = `${insetPad}px`;

    const toastRect = welcomeToast.getBoundingClientRect();
    const toastWidth = toastRect.width;
    const toastHeight = toastRect.height;

    const clampLeft = (left: number): number => {
      const maxLeft = Math.max(insetPad, containerRect.width - toastWidth - insetPad);
      return Math.min(Math.max(left, insetPad), maxLeft);
    };
    const clampTop = (top: number): number => {
      const maxTop = Math.max(insetPad, containerRect.height - toastHeight - insetPad);
      return Math.min(Math.max(top, insetPad), maxTop);
    };

    // Default placement keeps the intro near the lower-right controls.
    let nextLeft = clampLeft(containerRect.width - toastWidth - insetPad);
    let nextTop = clampTop(containerRect.height - toastHeight - fallbackBottomOffset);

    // When help is visible, anchor the intro directly to the left of the help icon.
    const helpTarget = getHelpButtonTarget();
    if (helpTarget) {
      const helpRect = helpTarget.getBoundingClientRect();
      const localHelpLeft = helpRect.left - containerRect.left;
      const localHelpCenterY = helpRect.top - containerRect.top + helpRect.height / 2;
      nextLeft = clampLeft(localHelpLeft - toastWidth - toastToHelpGap);
      nextTop = clampTop(localHelpCenterY - toastHeight / 2 - helpAnchorVerticalNudge);
    }

    welcomeToast.style.left = `${nextLeft}px`;
    welcomeToast.style.top = `${nextTop}px`;
  };

  const positionRestartHintToast = () => {
    if (restartHintToast.classList.contains("hidden")) return;
    const containerRect = container.getBoundingClientRect();
    const insetPad = 8;
    const toastToHelpGap = 10;

    restartHintToast.style.maxWidth = `${Math.max(180, Math.min(240, containerRect.width - insetPad * 2))}px`;
    restartHintToast.style.left = `${insetPad}px`;
    restartHintToast.style.top = `${insetPad}px`;

    const toastRect = restartHintToast.getBoundingClientRect();
    const toastWidth = toastRect.width;
    const toastHeight = toastRect.height;

    const clampLeft = (left: number): number => {
      const maxLeft = Math.max(insetPad, containerRect.width - toastWidth - insetPad);
      return Math.min(Math.max(left, insetPad), maxLeft);
    };
    const clampTop = (top: number): number => {
      const maxTop = Math.max(insetPad, containerRect.height - toastHeight - insetPad);
      return Math.min(Math.max(top, insetPad), maxTop);
    };

    let nextLeft = clampLeft(containerRect.width - toastWidth - insetPad);
    let nextTop = clampTop(containerRect.height - toastHeight - 16);

    const helpTarget = getHelpButtonTarget();
    if (helpTarget) {
      const helpRect = helpTarget.getBoundingClientRect();
      const localHelpLeft = helpRect.left - containerRect.left;
      const localHelpCenterY = helpRect.top - containerRect.top + helpRect.height / 2;
      nextLeft = clampLeft(localHelpLeft - toastWidth - toastToHelpGap);
      nextTop = clampTop(localHelpCenterY - toastHeight / 2);
    }

    restartHintToast.style.left = `${nextLeft}px`;
    restartHintToast.style.top = `${nextTop}px`;
  };

  const showRestartHintToast = () => {
    clearRestartHintTimer();
    restartHintToast.classList.add("opacity-0");
    restartHintToast.classList.remove("opacity-100");
    restartHintToast.classList.remove("hidden");
    requestAnimationFrame(() => {
      positionRestartHintToast();
      restartHintToast.classList.remove("opacity-0");
      restartHintToast.classList.add("opacity-100");
    });
    restartHintTimer = window.setTimeout(() => {
      hideRestartHintToast();
    }, 3000);
  };

  const positionTourStep = (target: HTMLElement) => {
    highlightBox.classList.remove("hidden");
    const containerRect = container.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    const pad = 6;
    const insetPad = 8;

    const highlightLeft = Math.max(insetPad, targetRect.left - containerRect.left - pad);
    const highlightTop = Math.max(insetPad, targetRect.top - containerRect.top - pad);
    const highlightWidth = Math.max(40, targetRect.width + pad * 2);
    const highlightHeight = Math.max(30, targetRect.height + pad * 2);

    const targetOutsideContainer =
      targetRect.left < containerRect.left ||
      targetRect.right > containerRect.right ||
      targetRect.top < containerRect.top ||
      targetRect.bottom > containerRect.bottom;
    const useViewportHighlight =
      targetOutsideContainer &&
      (onboardingStep === "brandLogo" ||
        onboardingStep === "sidebarStatDetails" ||
        onboardingStep === "advancedStats" ||
        onboardingStep === "sidebarAddAreas" ||
        onboardingStep === "sidebarDemographicsExpand" ||
        onboardingStep === "sidebarOtherStats" ||
        onboardingStep === "sidebarOrgsTab" ||
        onboardingStep === "sidebarHoursFilter" ||
        onboardingStep === "sidebarCategoryFilter");
    if (useViewportHighlight) {
      stepOverlay.style.zIndex = "45";
      highlightBox.style.position = "fixed";
      highlightBox.style.left = `${Math.max(4, targetRect.left - pad)}px`;
      highlightBox.style.top = `${Math.max(4, targetRect.top - pad)}px`;
    } else {
      stepOverlay.style.zIndex = "14";
      highlightBox.style.position = "absolute";
      highlightBox.style.left = `${highlightLeft}px`;
      highlightBox.style.top = `${highlightTop}px`;
    }
    highlightBox.style.width = `${highlightWidth}px`;
    highlightBox.style.height = `${highlightHeight}px`;

    const secondaryTarget = onboardingStep === "advancedStats" ? getAdvancedStatsSecondaryTarget() : null;
    if (secondaryTarget) {
      const secondaryRect = secondaryTarget.getBoundingClientRect();
      const secondaryLeft = secondaryRect.left - containerRect.left - pad;
      const secondaryTop = secondaryRect.top - containerRect.top - pad;
      const secondaryWidth = Math.max(36, secondaryRect.width + pad * 2);
      const secondaryHeight = Math.max(24, secondaryRect.height + pad * 2);
      secondaryHighlightBox.classList.remove("hidden");
      if (useViewportHighlight) {
        secondaryHighlightBox.style.position = "fixed";
        secondaryHighlightBox.style.left = `${Math.max(4, secondaryRect.left - pad)}px`;
        secondaryHighlightBox.style.top = `${Math.max(4, secondaryRect.top - pad)}px`;
      } else {
        secondaryHighlightBox.style.position = "absolute";
        secondaryHighlightBox.style.left = `${secondaryLeft}px`;
        secondaryHighlightBox.style.top = `${secondaryTop}px`;
      }
      secondaryHighlightBox.style.width = `${secondaryWidth}px`;
      secondaryHighlightBox.style.height = `${secondaryHeight}px`;
    } else {
      secondaryHighlightBox.classList.add("hidden");
    }
    if (onboardingStep) {
      flashHighlight(onboardingStep, Boolean(secondaryTarget));
    }

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
    const addAvoidRectFor = (el: HTMLElement | null) => {
      if (!el) return;
      avoidRects.push(getLocalRect(el.getBoundingClientRect()));
    };

    if (onboardingStep === "change") {
      addAvoidRectFor(getPrimaryStatMenuTarget());
    }
    if (onboardingStep === "share") {
      const sharePanel = getSharePanelTarget();
      addAvoidRectFor(sharePanel);
    }
    if (
      onboardingStep === "showingExtremas" ||
      onboardingStep === "showingOrganizations" ||
      onboardingStep === "showingAreas"
    ) {
      addAvoidRectFor(getShowingPanelTarget());
    }
    if (onboardingStep === "showingAreas") {
      addAvoidRectFor(getShowingAreasMenuTarget());
    }
    if (onboardingStep === "advancedStats") {
      addAvoidRectFor(getAdvancedStatsSecondaryTarget());
    }
    if (onboardingStep === "sidebarCategoryFilter") {
      addAvoidRectFor(getSidebarCategoryMenuTarget());
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

    const isShowingSubStep =
      onboardingStep === "showingExtremas" ||
      onboardingStep === "showingOrganizations" ||
      onboardingStep === "showingAreas";

    const currentStep = onboardingStep;
    const stickyPosition =
      onboardingCardPosition && currentStep && onboardingCardPosition.step === currentStep
        ? {
            left: clampLeft(onboardingCardPosition.left),
            top: clampTop(onboardingCardPosition.top),
          }
        : null;
    if (stickyPosition && scoreCandidate(stickyPosition.left, stickyPosition.top) === 0) {
      stepCard.style.left = `${stickyPosition.left}px`;
      stepCard.style.top = `${stickyPosition.top}px`;
      stepCard.style.visibility = "visible";
      onboardingCardPosition = currentStep
        ? { step: currentStep, left: stickyPosition.left, top: stickyPosition.top }
        : null;
      return;
    }

    let best = candidates[0] ?? { left: clampLeft(highlightLeft), top: clampTop(highlightTop + highlightHeight + 10) };
    let bestScore = scoreCandidate(best.left, best.top);
    let bestDistance =
      stickyPosition ? Math.abs(best.left - stickyPosition.left) + Math.abs(best.top - stickyPosition.top) : 0;

    if (isShowingSubStep) {
      const leftCandidates = candidates.filter((candidate) => candidate.left < highlightLeft);
      if (leftCandidates.length > 0) {
        best = leftCandidates[0];
        bestScore = scoreCandidate(best.left, best.top);
        for (let i = 1; i < leftCandidates.length; i += 1) {
          const next = leftCandidates[i];
          const nextScore = scoreCandidate(next.left, next.top);
          const bestTopDistance = Math.abs(best.top - highlightTop);
          const nextTopDistance = Math.abs(next.top - highlightTop);
          if (nextScore < bestScore || (nextScore === bestScore && nextTopDistance < bestTopDistance)) {
            best = next;
            bestScore = nextScore;
          }
        }
      }
    } else {
      for (let i = 1; i < candidates.length; i += 1) {
        const next = candidates[i];
        const nextScore = scoreCandidate(next.left, next.top);
        const nextDistance =
          stickyPosition ? Math.abs(next.left - stickyPosition.left) + Math.abs(next.top - stickyPosition.top) : 0;
        if (nextScore < bestScore || (nextScore === bestScore && nextDistance < bestDistance)) {
          best = next;
          bestScore = nextScore;
          bestDistance = nextDistance;
          if (bestScore === 0 && stickyPosition) {
            break;
          }
        }
      }
    }

    stepCard.style.left = `${best.left}px`;
    stepCard.style.top = `${best.top}px`;
    stepCard.style.visibility = "visible";
    onboardingCardPosition = currentStep ? { step: currentStep, left: best.left, top: best.top } : null;
  };

  const positionFinalTourStep = () => {
    highlightBox.classList.add("hidden");
    secondaryHighlightBox.classList.add("hidden");
    stepOverlay.style.zIndex = "14";
    stepCard.style.visibility = "hidden";
    const containerRect = container.getBoundingClientRect();
    const insetPad = 8;
    stepCard.style.maxWidth = `${Math.max(220, Math.min(352, containerRect.width - insetPad * 2))}px`;
    const cardRect = stepCard.getBoundingClientRect();
    const left = Math.max(
      insetPad,
      Math.min((containerRect.width - cardRect.width) / 2, containerRect.width - cardRect.width - insetPad),
    );
    const top = Math.max(
      insetPad,
      Math.min(containerRect.height - cardRect.height - 18, containerRect.height - cardRect.height - insetPad),
    );
    stepCard.style.left = `${left}px`;
    stepCard.style.top = `${top}px`;
    stepCard.style.visibility = "visible";
    onboardingCardPosition = null;
  };

  const renderTourCard = (
    message: TourCardContent,
    primary: { label: string; onClick: () => void },
    secondary?: { label: string; onClick: () => void; tone?: "neutral" | "primary" },
    tertiary?: { label: string; onClick: () => void; tone?: "neutral" | "primary" },
  ) => {
    stepCard.replaceChildren();
    const appendCardText = (content: string | Node, className: string) => {
      if (typeof content === "string") {
        const copy = document.createElement("p");
        copy.className = className;
        copy.textContent = content;
        stepCard.appendChild(copy);
        return;
      }
      stepCard.appendChild(content);
    };

    // Supports two-section step copy: general context + explicit user action callout.
    if (typeof message === "string" || message instanceof Node) {
      appendCardText(message, "text-xs leading-5 text-slate-700 dark:text-slate-200");
    } else {
      if (message.body) {
        appendCardText(message.body, "text-xs leading-5 text-slate-700 dark:text-slate-200");
      }
      if (message.action) {
        const callout = document.createElement("div");
        callout.className = "mt-3 flex items-start gap-2 rounded-lg bg-slate-50/90 px-2.5 py-2 dark:bg-slate-800/70";
        const icon = document.createElement("span");
        icon.className = "mt-1 ml-0.5 flex h-4 w-4 shrink-0 items-center justify-center text-slate-500 dark:text-slate-300";
        icon.innerHTML =
          '<svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true" class="h-4 w-4"><path d="M3 2.5 13 9l-4.05 1.35 1.95 4.7-1.8.8-1.95-4.7L4 13.9z"/></svg>';
        const actionText = document.createElement("p");
        actionText.className = "text-xs leading-5 text-slate-700 dark:text-slate-100";
        if (typeof message.action === "string") {
          actionText.textContent = message.action;
        } else {
          actionText.appendChild(message.action);
        }
        callout.appendChild(icon);
        callout.appendChild(actionText);
        stepCard.appendChild(callout);
      }
      if (message.note) {
        appendCardText(message.note, "mt-2 text-xs leading-5 text-slate-700 dark:text-slate-200");
      }
    }

    const stepIndex = onboardingStep ? TOUR_STEP_SEQUENCE.indexOf(onboardingStep) : -1;
    const completedSteps = countProgressStepsThrough(onboardingStep);
    const showProgress = onboardingStep !== "tourFinale" && TOUR_PROGRESS_TOTAL_STEPS > 0;
    const canGoBack = stepIndex > 0 && primary.label === "Next";

    const footer = document.createElement("div");
    footer.className = showProgress
      ? "mt-3 flex items-center justify-between gap-2"
      : "mt-3 flex items-center justify-end gap-2";
    if (showProgress) {
      const progress = document.createElement("p");
      progress.className = "text-[11px] text-slate-400 dark:text-slate-500";
      progress.textContent = `${Math.min(completedSteps, TOUR_PROGRESS_TOTAL_STEPS)}/${TOUR_PROGRESS_TOTAL_STEPS} Steps`;
      footer.appendChild(progress);
    }

    const actions = document.createElement("div");
    actions.className = "flex items-center justify-end gap-2";
    if (secondary) {
      const secondaryBtn = document.createElement("button");
      secondaryBtn.type = "button";
      secondaryBtn.className =
        secondary.tone === "primary"
          ? TOUR_PRIMARY_BUTTON_CLASS
          : secondary.label === "Dismiss"
            ? TOUR_DISMISS_BUTTON_CLASS
            : TOUR_NEUTRAL_BUTTON_CLASS;
      secondaryBtn.textContent = secondary.label;
      secondaryBtn.addEventListener("click", secondary.onClick);
      actions.appendChild(secondaryBtn);
    }
    if (canGoBack) {
      const backBtn = document.createElement("button");
      backBtn.type = "button";
      backBtn.className = TOUR_NEUTRAL_BUTTON_CLASS;
      backBtn.textContent = "Back";
      backBtn.addEventListener("click", () => showPreviousStep());
      actions.appendChild(backBtn);
    }
    if (tertiary) {
      const tertiaryBtn = document.createElement("button");
      tertiaryBtn.type = "button";
      tertiaryBtn.className =
        tertiary.tone === "primary"
          ? TOUR_PRIMARY_BUTTON_CLASS
          : tertiary.label === "Dismiss"
            ? TOUR_DISMISS_BUTTON_CLASS
            : TOUR_NEUTRAL_BUTTON_CLASS;
      tertiaryBtn.textContent = tertiary.label;
      tertiaryBtn.addEventListener("click", tertiary.onClick);
      actions.appendChild(tertiaryBtn);
    }
    const primaryBtn = document.createElement("button");
    primaryBtn.type = "button";
    primaryBtn.className = TOUR_PRIMARY_BUTTON_CLASS;
    primaryBtn.textContent = primary.label;
    primaryBtn.addEventListener("click", primary.onClick);
    actions.appendChild(primaryBtn);
    footer.appendChild(actions);
    stepCard.appendChild(footer);
  };

  const completeTour = () => {
    hideWelcomeToast();
    hideTourStep();
    setOnboardingDismissed();
  };

  const completeTourAndResetMapView = () => {
    completeTour();
    resetAppToDefaults();
    clearOnboardingRetry();
    onboardingRetryTimer = window.setTimeout(() => {
      onboardingRetryTimer = null;
      applyTourStat(TOUR_DEFAULT_STAT_ID);
      applyTourCamera(TOUR_POST_RESET_LAT, TOUR_POST_RESET_LNG, TOUR_POST_RESET_ZOOM);
    }, TOUR_STATE_SETTLE_MS);
  };

  const dismissTour = () => {
    completeTour();
    showRestartHintToast();
  };

  const openFeedbackFromTour = () => {
    completeTour();
    window.dispatchEvent(new CustomEvent(MAP_TOUR_OPEN_FEEDBACK_EVENT));
  };

  // If a step target never appears, continue forward so the tour never gets stuck in a loop.
  const skipToNextStep = (step: OnboardingStep, next: () => void) => {
    console.warn(`[tour] Skipping step "${step}" because its target is unavailable.`);
    if (step === "showingOrganizations") {
      setTourLock(null);
      continueAfterShowingOrganizationsExit(next);
      return;
    }
    if (step === "sidebarAddAreas") {
      closeSidebarAddAreasDropdown();
    }
    if (step === "sidebarDemographicsExpand") {
      ensureSidebarDemographicsExpanded(false);
    }
    if (step === "sidebarOtherStats") {
      applyTourSecondaryStat(null);
    }
    setTourLock(null);
    next();
  };

  const showChangeStep = (attempt = 0) => {
    clearOnboardingRetry();
    applyTourStat(TOUR_CHANGE_OVER_TIME_STAT_ID);
    openSelectedStatDropdown();
    const target = getChangeOptionTarget();
    if (!target) {
      if (attempt < (onboardingForceStart ? 120 : 12)) {
        onboardingRetryTimer = window.setTimeout(() => showChangeStep(attempt + 1), 100);
      } else {
        skipToNextStep("change", showShowingExtremasStep);
      }
      return;
    }
    onboardingStep = "change";
    setTourLock(MAP_TOUR_LOCKS.primaryStatMenu);
    stepOverlay.classList.remove("hidden");
    renderTourCard(
      {
        body: "Change the version of your mapped statistic.",
        action:
          "See areas of OK gaining (blue) & losing (red) the most residents, loading in now.",
      },
      {
        label: "Next",
        onClick: () => {
          setTourLock(null);
          closeSelectedStatDropdown();
          showShowingExtremasStep();
        },
      },
      { label: "Dismiss", onClick: dismissTour },
    );
    positionTourStep(target);
  };

  const showShowingExtremasStep = (attempt = 0) => {
    clearOnboardingRetry();
    applyTourStat(TOUR_DEFAULT_STAT_ID);
    if (attempt === 0) {
      applyTourState(MAP_TOUR_EXTREMAS_PRESET);
      onboardingRetryTimer = window.setTimeout(() => showShowingExtremasStep(1), TOUR_STATE_SETTLE_MS);
      return;
    }
    setTourLock(null);
    closeSelectedStatDropdown();
    if (!openShowingPanel()) {
      if (attempt < 24) {
        onboardingRetryTimer = window.setTimeout(() => showShowingExtremasStep(attempt + 1), 100);
      } else {
        skipToNextStep("showingExtremas", showShowingOrganizationsStep);
      }
      return;
    }
    const target = getShowingExtremasTarget();
    if (!target) {
      if (attempt < 24) {
        onboardingRetryTimer = window.setTimeout(() => showShowingExtremasStep(attempt + 1), 100);
      } else {
        skipToNextStep("showingExtremas", showShowingOrganizationsStep);
      }
      return;
    }
    onboardingStep = "showingExtremas";
    setTourLock(MAP_TOUR_LOCKS.showingPanel);
    stepOverlay.classList.remove("hidden");
    renderTourCard(
      {
        body: "Extremas are currently showing the highest and lowest value locations for different statistics.",
        action:
          "Hover your mouse over the two red triangles on Oklahoma county to see the most pressing issues among the highest OK population.",
      },
      { label: "Next", onClick: () => showShowingOrganizationsStep() },
      { label: "Dismiss", onClick: dismissTour },
    );
    positionTourStep(target);
  };

  const showShowingOrganizationsStep = (attempt = 0) => {
    clearOnboardingRetry();
    if (attempt === 0) {
      applyTourState(MAP_TOUR_ORGS_PRESET);
      onboardingRetryTimer = window.setTimeout(() => showShowingOrganizationsStep(1), TOUR_STATE_SETTLE_MS);
      return;
    }
    if (!openShowingPanel()) {
      if (attempt < 24) {
        onboardingRetryTimer = window.setTimeout(() => showShowingOrganizationsStep(attempt + 1), 100);
      } else {
        skipToNextStep("showingOrganizations", showShowingAreasStep);
      }
      return;
    }
    // Ensure organizations are actually toggled on before showing this step.
    // This guards against occasional async state ordering where preset apply lags.
    if (!ensureShowingOrganizationsVisible(true)) {
      if (attempt < 24) {
        onboardingRetryTimer = window.setTimeout(() => showShowingOrganizationsStep(attempt + 1), 100);
      } else {
        skipToNextStep("showingOrganizations", showShowingAreasStep);
      }
      return;
    }
    const target = getShowingOrganizationsTarget();
    if (!target) {
      if (attempt < 24) {
        onboardingRetryTimer = window.setTimeout(() => showShowingOrganizationsStep(attempt + 1), 100);
      } else {
        skipToNextStep("showingOrganizations", showShowingAreasStep);
      }
      return;
    }
    onboardingStep = "showingOrganizations";
    setTourLock(MAP_TOUR_LOCKS.showingPanel);
    stepOverlay.classList.remove("hidden");
    renderTourCard(
      {
        body: "Organizations appear as orange number clusters or single circles on the map.",
        action:
          "Hover or click the orange circles to see which orgs are closest to these blue ZIP-areas with high SNAP Food need.",
      },
      {
        label: "Next",
        onClick: () => {
          continueAfterShowingOrganizationsExit(showShowingAreasStep);
        },
      },
      { label: "Dismiss", onClick: dismissTour },
    );
    positionTourStep(target);
  };

  const showShowingAreasStep = (attempt = 0) => {
    clearOnboardingRetry();
    if (attempt === 0) {
      ensureShowingOrganizationsVisible(false);
      applyTourState(MAP_TOUR_SHOWING_AREAS_PRESET);
      if (onboardingStep === "showingOrganizations") {
        closeSidebarPanel();
      }
      onboardingRetryTimer = window.setTimeout(() => showShowingAreasStep(1), TOUR_STATE_SETTLE_MS);
      return;
    }
    if (!openShowingPanel()) {
      if (attempt < 24) {
        onboardingRetryTimer = window.setTimeout(() => showShowingAreasStep(attempt + 1), 100);
      } else {
        skipToNextStep("showingAreas", showShareStep);
      }
      return;
    }
    const target = getShowingAreasTarget();
    if (!target) {
      if (attempt < 24) {
        onboardingRetryTimer = window.setTimeout(() => showShowingAreasStep(attempt + 1), 100);
      } else {
        skipToNextStep("showingAreas", showShareStep);
      }
      return;
    }
    onboardingStep = "showingAreas";
    setTourLock(MAP_TOUR_LOCKS.showingPanel);
    stepOverlay.classList.remove("hidden");
    renderTourCard(
      {
        body: "See map boundaries update by zoom level or fix to ZIP, county, etc.",
        action:
          "Zoom in to Payne county or select Areas: ZIP to see which ZIPs are hardest hit by Payne's exceeding rent burden.",
      },
      {
        label: "Next",
        onClick: () => {
          setTourLock(null);
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
    if (attempt === 0) {
      shareStepAutoCopyTriggered = false;
      applyTourStat(TOUR_SHARE_STAT_ID);
      applyTourCamera(TOUR_SHARE_LAT, TOUR_SHARE_LNG, TOUR_SHARE_ZOOM);
      if (openShowingPanel()) {
        ensureShowingExtremasVisible(false);
        closeShowingPanel();
      }
    }
    setTourLock(null);
    closeShowingPanel();
    if (!openSharePanel()) {
      if (attempt < 24) {
        onboardingRetryTimer = window.setTimeout(() => showShareStep(attempt + 1), 100);
      } else {
        skipToNextStep("share", showMyLocationStep);
      }
      return;
    }
    const target = getShareChipTarget();
    if (!target) {
      if (attempt < 24) {
        onboardingRetryTimer = window.setTimeout(() => showShareStep(attempt + 1), 100);
      } else {
        skipToNextStep("share", showMyLocationStep);
      }
      return;
    }
    onboardingStep = "share";
    setTourLock(MAP_TOUR_LOCKS.sharePanel);
    stepOverlay.classList.remove("hidden");
    renderTourCard(
      {
        body: "Share your current map with others! Embed in your website, etc.",
        action:
          "Paste this marriage % map (command/control+v) into a doc, presentation, etc.).",
      },
      {
        label: "Next",
        onClick: () => {
          shareStepAutoCopyTriggered = false;
          setTourLock(null);
          closeSharePanel();
          showMyLocationStep();
        },
      },
      { label: "Dismiss", onClick: dismissTour },
    );
    if (!shareStepAutoCopyTriggered) {
      if (triggerShareScreenshotCopy()) {
        shareStepAutoCopyTriggered = true;
      } else {
        window.setTimeout(() => {
          if (onboardingStep !== "share" || shareStepAutoCopyTriggered) return;
          if (triggerShareScreenshotCopy()) {
            shareStepAutoCopyTriggered = true;
          }
        }, 80);
      }
    }
    positionTourStep(target);
  };

  const showSearchMenuStep = (attempt = 0) => {
    clearOnboardingRetry();
    setTourLock(null);
    closeSharePanel();
    closeSidebarPanel();
    const target = getSearchBarTarget();
    if (!target) {
      if (attempt < 24) {
        onboardingRetryTimer = window.setTimeout(() => showSearchMenuStep(attempt + 1), 120);
      } else {
        skipToNextStep("searchMenu", showSidebarStatDetailsStep);
      }
      return;
    }
    onboardingStep = "searchMenu";
    stepOverlay.classList.remove("hidden");
    renderTourCard(
      {
        body: "Search for stats, orgs, zips, or addresses.",
        action: "Click the three-lined hamburger menu icon now to browse options.",
      },
      {
        label: "Next",
        onClick: () => {
          if (!openSidebarPanel()) return;
          showSidebarStatDetailsStep();
        },
      },
      { label: "Dismiss", onClick: dismissTour },
    );
    positionTourStep(target);
  };

  const showSidebarStatDetailsStep = (attempt = 0) => {
    clearOnboardingRetry();
    applyTourStat(TOUR_SIDEBAR_STAT_DETAILS_ID);
    if (attempt === 0) {
      applyTourCamera(
        TOUR_SIDEBAR_STAT_DETAILS_LAT,
        TOUR_SIDEBAR_STAT_DETAILS_LNG,
        TOUR_SIDEBAR_STAT_DETAILS_ZOOM,
      );
    }
    openSidebarPanel();
    const target = getSidebarStatDetailsTarget();
    if (!target) {
      if (attempt < 28) {
        onboardingRetryTimer = window.setTimeout(() => showSidebarStatDetailsStep(attempt + 1), 120);
      } else {
        skipToNextStep("sidebarStatDetails", showAdvancedStatsStep);
      }
      return;
    }
    onboardingStep = "sidebarStatDetails";
    stepOverlay.classList.remove("hidden");
    renderTourCard(
      {
        body: "Learn more about & adjust the active stat (e.g. High School Graduation).",
        action:
          'Click "Other Degrees: Graduate..." plus "Options: Change \'21-23" on to see which areas are getting the most new graduate degrees relative to size recently.',
      },
      { label: "Next", onClick: () => showAdvancedStatsStep() },
      { label: "Dismiss", onClick: dismissTour },
    );
    positionTourStep(target);
  };

  const showAdvancedStatsStep = (attempt = 0) => {
    clearOnboardingRetry();
    if (attempt === 0) {
      applyAdvancedStatsPreset();
      onboardingRetryTimer = window.setTimeout(() => showAdvancedStatsStep(1), TOUR_STATE_SETTLE_MS);
      return;
    }
    openSidebarPanel();
    const target = getAdvancedStatsPrimaryTarget();
    if (!target) {
      if (attempt < 28) {
        onboardingRetryTimer = window.setTimeout(() => showAdvancedStatsStep(attempt + 1), 120);
      } else {
        skipToNextStep("advancedStats", showSidebarAddAreasStep);
      }
      return;
    }
    onboardingStep = "advancedStats";
    stepOverlay.classList.remove("hidden");
    renderTourCard(
      {
        body: "Advanced stats mode to see charts for your selected map area(s).",
        action: "Hover over the graph to see how quickly population is increasing for 73108.",
      },
      { label: "Next", onClick: () => showSidebarAddAreasStep() },
      { label: "Dismiss", onClick: dismissTour },
    );
    positionTourStep(target);
  };

  const showSidebarAddAreasStep = (attempt = 0) => {
    clearOnboardingRetry();
    if (attempt === 0) {
      applyTourState(MAP_TOUR_ADD_AREAS_PRESET);
      onboardingRetryTimer = window.setTimeout(() => showSidebarAddAreasStep(1), TOUR_STATE_SETTLE_MS);
      return;
    }
    openSidebarPanel();
    const target = getSidebarAddAreasTarget();
    if (!target) {
      if (attempt < 28) {
        onboardingRetryTimer = window.setTimeout(() => showSidebarAddAreasStep(attempt + 1), 120);
      } else {
        skipToNextStep("sidebarAddAreas", showSidebarDemographicsExpandStep);
      }
      return;
    }
    onboardingStep = "sidebarAddAreas";
    stepOverlay.classList.remove("hidden");
    expandSidebarAddAreasDropdown(target);
    renderTourCard(
      {
        body: "Add additional areas to compare.",
        action: "Type a zip or shift+click one on the map! Like 73129 just added.",
        note: "Why is one area growing and its neighbor dropping?",
      },
      {
        label: "Next",
        onClick: () => {
          closeSidebarAddAreasDropdown();
          showSidebarDemographicsExpandStep();
        },
      },
      { label: "Dismiss", onClick: dismissTour },
    );
    positionTourStep(target);
  };

  const showSidebarDemographicsExpandStep = (attempt = 0) => {
    clearOnboardingRetry();
    if (attempt === 0) {
      closeSidebarAddAreasDropdown();
      applyTourState(MAP_TOUR_DEMOGRAPHICS_PRESET);
      onboardingRetryTimer = window.setTimeout(() => showSidebarDemographicsExpandStep(1), TOUR_STATE_SETTLE_MS);
      return;
    }
    closeSidebarAddAreasDropdown();
    openSidebarPanel();
    const target = getSidebarDemographicsExpandTarget();
    if (!target) {
      if (attempt < 28) {
        onboardingRetryTimer = window.setTimeout(() => showSidebarDemographicsExpandStep(attempt + 1), 120);
      } else {
        skipToNextStep("sidebarDemographicsExpand", showSidebarOtherStatsStep);
      }
      return;
    }
    onboardingStep = "sidebarDemographicsExpand";
    stepOverlay.classList.remove("hidden");
    ensureSidebarDemographicsExpanded(true);
    renderTourCard(
      {
        body: "Expand to see demographic breakdown of your selected area(s).",
        action:
          "Hover bars with your mouse to see the largest ethnicities, income levels, etc. for this fast growing area of the city",
      },
      {
        label: "Next",
        onClick: () => {
          ensureSidebarDemographicsExpanded(false);
          showSidebarOtherStatsStep();
        },
      },
      { label: "Dismiss", onClick: dismissTour },
    );
    positionTourStep(target);
  };

  const showSidebarOtherStatsStep = (attempt = 0) => {
    clearOnboardingRetry();
    if (attempt === 0) {
      applyTourState(MAP_TOUR_OTHER_STATS_PRESET);
      onboardingRetryTimer = window.setTimeout(() => showSidebarOtherStatsStep(1), TOUR_STATE_SETTLE_MS);
      return;
    }
    openSidebarPanel();
    const target = getSidebarOtherStatsTarget();
    if (!target) {
      if (attempt < 28) {
        onboardingRetryTimer = window.setTimeout(() => showSidebarOtherStatsStep(attempt + 1), 120);
      } else {
        skipToNextStep("sidebarOtherStats", showSidebarOrgsTabStep);
      }
      return;
    }
    onboardingStep = "sidebarOtherStats";
    stepOverlay.classList.remove("hidden");
    applyTourSecondaryStat(TOUR_OTHER_STATS_SECONDARY_STAT_ID);
    renderTourCard(
      {
        body: "More statistics to explore (e.g. Households Receiving SNAP showing) or layer...",
        action:
          'We\'ve also shift+clicked the "Has Disability" stat to layer (green dots) over our SNAP statistic.',
        note: "Which areas have both high food and disability needs?",
      },
      {
        label: "Next",
        onClick: () => {
          applyTourSecondaryStat(null);
          showSidebarOrgsTabStep();
        },
      },
      { label: "Dismiss", onClick: dismissTour },
    );
    positionTourStep(target);
  };

  const showSidebarOrgsTabStep = (attempt = 0) => {
    clearOnboardingRetry();
    if (attempt === 0) {
      applyTourState(MAP_TOUR_SIDEBAR_ORGS_PRESET);
      onboardingRetryTimer = window.setTimeout(() => showSidebarOrgsTabStep(1), TOUR_STATE_SETTLE_MS);
      return;
    }
    applyTourSecondaryStat(null);
    openSidebarPanel();
    openSidebarOrgsTab();
    const target = getSidebarOrgsTabTarget();
    if (!target) {
      if (attempt < 28) {
        onboardingRetryTimer = window.setTimeout(() => showSidebarOrgsTabStep(attempt + 1), 120);
      } else {
        skipToNextStep("sidebarOrgsTab", showSidebarHoursFilterStep);
      }
      return;
    }
    onboardingStep = "sidebarOrgsTab";
    stepOverlay.classList.remove("hidden");
    ensureShowingOrganizationsVisible(true);
    renderTourCard(
      {
        body: "Switch to the organizations tab to browse organizations involved in your current map view",
        action:
          "Click an org card in the list to see its location among these areas of high SNAP need & population",
      },
      { label: "Next", onClick: () => showSidebarHoursFilterStep() },
      { label: "Dismiss", onClick: dismissTour },
    );
    positionTourStep(target);
  };

  const showSidebarHoursFilterStep = (attempt = 0) => {
    clearOnboardingRetry();
    openSidebarPanel();
    openSidebarOrgsTab();
    const target = getSidebarHoursFilterTarget();
    if (!target) {
      if (attempt < 28) {
        onboardingRetryTimer = window.setTimeout(() => showSidebarHoursFilterStep(attempt + 1), 120);
      } else {
        skipToNextStep("sidebarHoursFilter", showSidebarCategoryFilterStep);
      }
      return;
    }
    onboardingStep = "sidebarHoursFilter";
    stepOverlay.classList.remove("hidden");
    renderTourCard(
      {
        action: "Filter orgs (e.g. food banks) by hours of operation.",
      },
      { label: "Next", onClick: () => showSidebarCategoryFilterStep() },
      { label: "Dismiss", onClick: dismissTour },
    );
    positionTourStep(target);
  };

  const showSidebarCategoryFilterStep = (attempt = 0) => {
    clearOnboardingRetry();
    if (attempt === 0) {
      applyTourState(MAP_TOUR_SIDEBAR_CATEGORY_PRESET);
      onboardingRetryTimer = window.setTimeout(() => showSidebarCategoryFilterStep(1), TOUR_STATE_SETTLE_MS);
      return;
    }
    if (attempt === 1) {
      applyTourState(MAP_TOUR_SIDEBAR_CATEGORY_PRESET);
      onboardingRetryTimer = window.setTimeout(() => showSidebarCategoryFilterStep(2), TOUR_STATE_SETTLE_MS);
      return;
    }
    openSidebarPanel();
    openSidebarOrgsTab();
    if (!openSidebarCategoryMenu()) {
      if (attempt < 28) {
        onboardingRetryTimer = window.setTimeout(() => showSidebarCategoryFilterStep(attempt + 1), 120);
      } else {
        skipToNextStep("sidebarCategoryFilter", showTourFinaleStep);
      }
      return;
    }
    const target = getSidebarCategoryFilterTarget();
    if (!target) {
      if (attempt < 28) {
        onboardingRetryTimer = window.setTimeout(() => showSidebarCategoryFilterStep(attempt + 1), 120);
      } else {
        skipToNextStep("sidebarCategoryFilter", showTourFinaleStep);
      }
      return;
    }
    onboardingStep = "sidebarCategoryFilter";
    stepOverlay.classList.remove("hidden");
    renderTourCard(
      {
        body: "Filter both orgs and stats so you can see org efforts related to certain types of needs.",
        action: "Drag map to see sidebar update with just Edu orgs in view.",
        note: "Which organizations are concentrated around areas of lowest high school graduation?",
      },
      { label: "Next", onClick: () => showTourFinaleStep() },
      { label: "Dismiss", onClick: dismissTour },
    );
    positionTourStep(target);
  };

  const showTourFinaleStep = () => {
    clearOnboardingRetry();
    onboardingStep = "tourFinale";
    stepOverlay.classList.remove("hidden");
    const copy = document.createElement("p");
    copy.className = "text-xs leading-5 text-slate-700 dark:text-slate-200";
    copy.append("Thank you for exploring with us! If you have any questions or ideas, please reach out to ");
    const emailLink = document.createElement("a");
    emailLink.href = "#";
    emailLink.className = "font-medium text-brand-600 underline underline-offset-2 hover:text-brand-700";
    emailLink.textContent = "troy.robinson@9bcorp.com";
    emailLink.addEventListener("click", (event) => {
      event.preventDefault();
      openFeedbackFromTour();
    });
    copy.append(emailLink);
    copy.append(".");
    renderTourCard(
      copy,
      { label: "Done", onClick: completeTourAndResetMapView },
      { label: "Dismiss", onClick: dismissTour },
      { label: "Submit Feedback", onClick: openFeedbackFromTour },
    );
    positionFinalTourStep();
  };

  const showMyLocationStep = (attempt = 0) => {
    clearOnboardingRetry();
    if (attempt === 0) {
      myLocationStepAutoTriggered = false;
      applyTourStat(TOUR_MY_LOCATION_STAT_ID);
      // Prevent stale Share UI while My Location target is still resolving.
      onboardingStep = "myLocation";
      stepOverlay.classList.add("hidden");
      onboardingCardPosition = null;
    }
    setHelpMenuSuppressed(true);
    const target = getMyLocationTarget();
    if (!target) {
      if (attempt < 24) {
        onboardingRetryTimer = window.setTimeout(() => showMyLocationStep(attempt + 1), 120);
      } else {
        skipToNextStep("myLocation", showLegendStep);
      }
      return;
    }
    onboardingStep = "myLocation";
    stepOverlay.classList.remove("hidden");
    if (!myLocationStepAutoTriggered && target instanceof HTMLButtonElement) {
      target.click();
      myLocationStepAutoTriggered = true;
    }
    renderTourCard(
      {
        body: "Zoom to your current location.",
        action: "What do you notice about the income level of individuals in or around your location?",
      },
      { label: "Next", onClick: () => showLegendStep() },
      { label: "Dismiss", onClick: dismissTour },
    );
    positionTourStep(target);
  };

  const showLegendStep = (attempt = 0) => {
    clearOnboardingRetry();
    setHelpMenuSuppressed(false);
    const target = getLegendTarget();
    if (!target) {
      if (attempt < 24) {
        onboardingRetryTimer = window.setTimeout(() => showLegendStep(attempt + 1), 120);
      } else {
        skipToNextStep("legend", showBrandLogoStep);
      }
      return;
    }
    onboardingStep = "legend";
    stepOverlay.classList.remove("hidden");
    renderTourCard(
      "Shows the highest and lowest values possible for your active statistic.",
      { label: "Next", onClick: () => showBrandLogoStep() },
      { label: "Dismiss", onClick: dismissTour },
    );
    positionTourStep(target);
  };

  const showBrandLogoStep = (attempt = 0) => {
    clearOnboardingRetry();
    if (attempt === 0) {
      brandLogoStepAutoTriggered = false;
    }
    setHelpMenuSuppressed(false);
    const target = getBrandLogoTarget();
    if (!target) {
      if (attempt < 24) {
        onboardingRetryTimer = window.setTimeout(() => showBrandLogoStep(attempt + 1), 120);
      } else {
        skipToNextStep("brandLogo", showSearchMenuStep);
      }
      return;
    }
    onboardingStep = "brandLogo";
    stepOverlay.classList.remove("hidden");
    if (!brandLogoStepAutoTriggered) {
      target.click();
      brandLogoStepAutoTriggered = true;
    }
    renderTourCard(
      {
        body: "Reset the map and UI back to defaults.",
        action: "Clicked the NE App's logo in the top left corner to refresh.",
      },
      { label: "Next", onClick: () => showSearchMenuStep() },
      { label: "Dismiss", onClick: dismissTour },
    );
    positionTourStep(target);
  };

  const showStepByKey = (step: OnboardingStep) => {
    switch (step) {
      case "change":
        showChangeStep();
        return;
      case "showingExtremas":
        showShowingExtremasStep();
        return;
      case "showingOrganizations":
        showShowingOrganizationsStep();
        return;
      case "showingAreas":
        showShowingAreasStep();
        return;
      case "share":
        showShareStep();
        return;
      case "myLocation":
        showMyLocationStep();
        return;
      case "legend":
        showLegendStep();
        return;
      case "brandLogo":
        showBrandLogoStep();
        return;
      case "searchMenu":
        showSearchMenuStep();
        return;
      case "sidebarStatDetails":
        showSidebarStatDetailsStep();
        return;
      case "advancedStats":
        showAdvancedStatsStep();
        return;
      case "sidebarAddAreas":
        showSidebarAddAreasStep();
        return;
      case "sidebarDemographicsExpand":
        showSidebarDemographicsExpandStep();
        return;
      case "sidebarOtherStats":
        showSidebarOtherStatsStep();
        return;
      case "sidebarOrgsTab":
        showSidebarOrgsTabStep();
        return;
      case "sidebarHoursFilter":
        showSidebarHoursFilterStep();
        return;
      case "sidebarCategoryFilter":
        showSidebarCategoryFilterStep();
        return;
      case "tourFinale":
        showTourFinaleStep();
        return;
      default:
        return;
    }
  };

  const showPreviousStep = () => {
    if (!onboardingStep) return;
    if (onboardingStep === "showingOrganizations") {
      exitShowingOrganizationsStep();
    }
    if (onboardingStep === "sidebarAddAreas") {
      closeSidebarAddAreasDropdown();
    }
    if (onboardingStep === "sidebarDemographicsExpand") {
      ensureSidebarDemographicsExpanded(false);
    }
    if (onboardingStep === "sidebarOtherStats") {
      applyTourSecondaryStat(null);
    }
    const currentIndex = TOUR_STEP_SEQUENCE.indexOf(onboardingStep);
    if (currentIndex <= 0) return;
    const previous = TOUR_STEP_SEQUENCE[currentIndex - 1];
    showStepByKey(previous);
  };

  const targetForStep = (step: OnboardingStep): HTMLElement | null => {
    switch (step) {
      case "change":
        return getChangeOptionTarget();
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
      case "sidebarStatDetails":
        return getSidebarStatDetailsTarget();
      case "advancedStats":
        return getAdvancedStatsPrimaryTarget();
      case "sidebarAddAreas":
        return getSidebarAddAreasTarget();
      case "sidebarDemographicsExpand":
        return getSidebarDemographicsExpandTarget();
      case "sidebarOtherStats":
        return getSidebarOtherStatsTarget();
      case "sidebarOrgsTab":
        return getSidebarOrgsTabTarget();
      case "sidebarHoursFilter":
        return getSidebarHoursFilterTarget();
      case "sidebarCategoryFilter":
        return getSidebarCategoryFilterTarget();
      case "tourFinale":
        return null;
      case "myLocation":
        return getMyLocationTarget();
      case "legend":
        return getLegendTarget();
      case "brandLogo":
        return getBrandLogoTarget();
      default:
        return null;
    }
  };

  const startTourFlowFromBanner = () => {
    setHelpMenuSuppressed(false);
    hideRestartHintToast();
    hideWelcomeToast();
    clearOnboardingDismissed();
    hideTourStep();
    onboardingForceStart = true;
    resetAppToDefaults();
    closeSidebarPanel();
    clearOnboardingRetry();
    onboardingRetryTimer = window.setTimeout(() => {
      onboardingRetryTimer = null;
      showChangeStep();
    }, TOUR_STATE_SETTLE_MS);
  };

  const start = () => {
    setHelpMenuSuppressed(false);
    hideRestartHintToast();
    clearOnboardingDismissed();
    hideTourStep();
    onboardingForceStart = true;
    resetAppToDefaults();
    closeSidebarPanel();
    clearOnboardingRetry();
    onboardingRetryTimer = window.setTimeout(() => {
      onboardingRetryTimer = null;
      showChangeStep();
    }, TOUR_STATE_SETTLE_MS);
  };

  const showIntro = () => {
    setHelpMenuSuppressed(false);
    hideRestartHintToast();
    clearOnboardingDismissed();
    hideTourStep();
    showWelcomeToast({ force: true });
  };

  const setAutoPromptEnabled = (enabled: boolean) => {
    autoPromptEnabled = enabled;
    if (!autoPromptEnabled) {
      hideWelcomeToast();
      return;
    }
    if (!onboardingStep && !onboardingDismissed) {
      showWelcomeToast();
    }
  };

  const refresh = () => {
    positionWelcomeToast();
    positionRestartHintToast();
    setHelpMenuSuppressed(onboardingStep === "myLocation");
    if (!onboardingStep) return;
    if (onboardingPositionRaf !== null) {
      cancelAnimationFrame(onboardingPositionRaf);
    }
    onboardingPositionRaf = requestAnimationFrame(() => {
      onboardingPositionRaf = null;
      const currentStep = onboardingStep;
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
      if (
        currentStep === "sidebarStatDetails" ||
        currentStep === "advancedStats" ||
        currentStep === "sidebarAddAreas" ||
        currentStep === "sidebarDemographicsExpand" ||
        currentStep === "sidebarOtherStats" ||
        currentStep === "sidebarOrgsTab" ||
        currentStep === "sidebarHoursFilter" ||
        currentStep === "sidebarCategoryFilter"
      ) {
        openSidebarPanel();
      }
      if (currentStep === "sidebarDemographicsExpand") {
        ensureSidebarDemographicsExpanded(true);
      }
      if (currentStep === "sidebarOrgsTab" || currentStep === "sidebarHoursFilter") {
        openSidebarOrgsTab();
      }
      if (currentStep === "sidebarCategoryFilter") {
        openSidebarOrgsTab();
        openSidebarCategoryMenu();
      }
      if (currentStep === "tourFinale") {
        positionFinalTourStep();
        return;
      }
      const target = targetForStep(currentStep);
      if (target) {
        positionTourStep(target);
      }
    });
  };

  const advanceSearchMenuOnSidebarToggleClick = (event: MouseEvent) => {
    if (onboardingStep !== "searchMenu") return;
    const target = event.target;
    if (!(target instanceof Element)) return;
    const button = target.closest("button[title]");
    if (!(button instanceof HTMLButtonElement)) return;
    const title = (button.getAttribute("title") ?? "").trim().toLowerCase();
    if (!title.includes("sidebar") || (!title.includes("expand") && !title.includes("collapse"))) return;
    window.setTimeout(() => {
      if (onboardingStep !== "searchMenu") return;
      showSidebarStatDetailsStep();
    }, 90);
  };

  const jumpToOrganizationsStepOnClick = (event: MouseEvent) => {
    if (!event.isTrusted) return;
    if (!onboardingStep || onboardingStep === "showingOrganizations") return;
    const target = event.target;
    if (!(target instanceof Element)) return;
    const orgButton = target.closest(targetSelector(MAP_TOUR_TARGETS.showingOrganizations));
    if (!orgButton) return;
    window.setTimeout(() => {
      if (!onboardingStep || onboardingStep === "showingOrganizations") return;
      showShowingOrganizationsStep();
    }, 0);
  };

  const jumpToAreasStepOnOptionClick = (event: MouseEvent) => {
    if (!onboardingStep || onboardingStep === "showingAreas") return;
    const target = event.target;
    if (!(target instanceof Element)) return;
    const option = target.closest<HTMLElement>("[data-areas-mode]");
    if (!option) return;
    const inAreasMenu = option.closest(targetSelector(MAP_TOUR_TARGETS.showingAreasMenu));
    if (!inAreasMenu) return;
    window.setTimeout(() => {
      if (!onboardingStep || onboardingStep === "showingAreas") return;
      showShowingAreasStep();
    }, 0);
  };

  const closeRestartHintOnHelpHover = (event: PointerEvent) => {
    if (restartHintToast.classList.contains("hidden")) return;
    const target = event.target;
    if (!(target instanceof Element)) return;
    const helpButton = target.closest('button[aria-label="Help"]');
    if (!helpButton) return;
    hideRestartHintToast(true);
  };

  dismissWelcomeBtn.addEventListener("click", dismissTour);
  startTourBtn.addEventListener("click", startTourFlowFromBanner);
  window.addEventListener("resize", refresh);
  window.addEventListener("pointerup", refresh, true);
  window.addEventListener("keyup", refresh, true);
  window.addEventListener("click", advanceSearchMenuOnSidebarToggleClick, true);
  window.addEventListener("click", jumpToOrganizationsStepOnClick, true);
  window.addEventListener("click", jumpToAreasStepOnOptionClick, true);
  window.addEventListener("pointerover", closeRestartHintOnHelpHover, true);

  if (autoPromptEnabled && !onboardingDismissed) {
    showWelcomeToast();
  }

  const destroy = () => {
    clearOnboardingRetry();
    clearRestartHintTimer();
    setHelpMenuSuppressed(false);
    if (onboardingPositionRaf !== null) {
      cancelAnimationFrame(onboardingPositionRaf);
      onboardingPositionRaf = null;
    }
    dismissWelcomeBtn.removeEventListener("click", dismissTour);
    startTourBtn.removeEventListener("click", startTourFlowFromBanner);
    window.removeEventListener("resize", refresh);
    window.removeEventListener("pointerup", refresh, true);
    window.removeEventListener("keyup", refresh, true);
    window.removeEventListener("click", advanceSearchMenuOnSidebarToggleClick, true);
    window.removeEventListener("click", jumpToOrganizationsStepOnClick, true);
    window.removeEventListener("click", jumpToAreasStepOnOptionClick, true);
    window.removeEventListener("pointerover", closeRestartHintOnHelpHover, true);
    hideTourStep();
    welcomeToast.remove();
    restartHintToast.remove();
    stepOverlay.remove();
  };

  return { start, showIntro, setAutoPromptEnabled, refresh, destroy };
};
