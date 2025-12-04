export interface MapLoadingIndicatorController {
  element: HTMLElement;
  setLoading: (loading: boolean) => void;
  destroy: () => void;
}

/**
 * Creates a loading indicator that displays at the bottom of the map.
 * Shows a spinner and "Loading map..." text during tile/data loading.
 */
export const createMapLoadingIndicator = (): MapLoadingIndicatorController => {
  const wrapper = document.createElement("div");
  wrapper.className = [
    "pointer-events-none absolute bottom-4 left-1/2 z-20 -translate-x-1/2",
    "flex items-center gap-2 rounded-full bg-white/90 px-3 py-1.5 shadow-md",
    "dark:bg-slate-800/90 dark:shadow-slate-900/50",
    "text-xs font-medium text-slate-600 dark:text-slate-300",
    "transition-opacity duration-200",
  ].join(" ");
  // Start visible since map begins loading
  wrapper.style.opacity = "1";
  wrapper.style.visibility = "visible";

  // Spinner SVG
  const spinner = document.createElement("div");
  spinner.className = "h-4 w-4 animate-spin";
  spinner.innerHTML = `
    <svg class="h-4 w-4" viewBox="0 0 24 24" fill="none">
      <circle 
        class="opacity-25" 
        cx="12" cy="12" r="10" 
        stroke="currentColor" 
        stroke-width="3"
      />
      <path 
        class="opacity-75" 
        fill="currentColor" 
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
      />
    </svg>
  `;

  const label = document.createElement("span");
  label.textContent = "Loading map…";

  wrapper.appendChild(spinner);
  wrapper.appendChild(label);

  let isVisible = true; // Starts visible for initial load
  let showTimer: ReturnType<typeof setTimeout> | null = null;
  let hideTimer: ReturnType<typeof setTimeout> | null = null;

  // Minimum time loading must persist before showing indicator (ms)
  const SHOW_DELAY_MS = 150;

  const show = () => {
    if (isVisible) return;
    isVisible = true;
    wrapper.style.visibility = "visible";
    requestAnimationFrame(() => {
      wrapper.style.opacity = "1";
    });
  };

  const hide = () => {
    if (!isVisible) return;
    isVisible = false;
    wrapper.style.opacity = "0";
    // Delay hiding visibility until fade completes
    hideTimer = setTimeout(() => {
      wrapper.style.visibility = "hidden";
    }, 200);
  };

  const setLoading = (loading: boolean) => {
    // Clear any pending timers
    if (showTimer) {
      clearTimeout(showTimer);
      showTimer = null;
    }
    if (hideTimer) {
      clearTimeout(hideTimer);
      hideTimer = null;
    }

    if (loading) {
      // Delay showing to avoid flicker on fast/cached tile loads
      showTimer = setTimeout(() => {
        show();
      }, SHOW_DELAY_MS);
    } else {
      hide();
    }
  };

  const destroy = () => {
    if (showTimer) clearTimeout(showTimer);
    if (hideTimer) clearTimeout(hideTimer);
    wrapper.remove();
  };

  return { element: wrapper, setLoading, destroy };
};
