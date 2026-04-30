export const CATEGORY_CHIP_CLASSES =
  "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-all duration-300 shadow-sm backdrop-blur-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-400";

export const CATEGORY_CHIP_NEUTRAL_CLASSES =
  "border-slate-200 bg-white/40 text-slate-600 hover:border-brand-200 hover:bg-white/80 hover:text-brand-600 dark:border-slate-700 dark:bg-slate-900/80 dark:text-slate-200 dark:hover:border-slate-500 dark:hover:text-white";

export const TIME_OPEN_CHIP_CLASSES =
  "border-[#f5c4ae]/60 bg-[#fdd6c3]/20 text-[#7a4030] hover:border-[#e8a990]/80 hover:bg-[#fdd6c3]/40 hover:text-[#6b3525] dark:border-[#7a4030]/40 dark:bg-[#7a4030]/15 dark:text-[#f5c4ae] dark:hover:border-[#e8a990]/60 dark:hover:text-[#fdd6c3]";

export const AREAS_CHIP_CLASSES =
  "border-[0.5px] border-white/60 bg-white/18 text-slate-700 ring-1 ring-white/45 hover:border-brand-200/70 hover:bg-white/30 hover:text-brand-700 dark:border-slate-500/35 dark:bg-slate-900/22 dark:text-slate-200 dark:ring-white/8 dark:hover:border-brand-400/50 dark:hover:bg-slate-900/38 dark:hover:text-white";

export const SHOWING_CHIP_CLASSES = AREAS_CHIP_CLASSES;
export const SHOWING_CHIP_ACTIVE_CLASSES =
  "border-slate-300 bg-white/90 text-slate-800 ring-0 dark:border-slate-500 dark:bg-slate-900/45 dark:text-slate-100 dark:ring-0";
export const SHOWING_PANEL_ACTION_CLASSES =
  "border-slate-200/90 bg-slate-50 text-slate-600 hover:bg-white hover:border-slate-300 dark:border-slate-700/90 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-black dark:hover:border-slate-500";
export const SHOWING_PANEL_ACTION_SELECTED_BORDER_CLASSES =
  "!border-[1.5px] !border-slate-300 dark:!border-slate-500";
export const EXPORT_PANEL_ACTION_CLASSES =
  "border-slate-200/90 bg-slate-50 text-slate-700 hover:bg-white hover:border-slate-300 dark:border-slate-700/90 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-black dark:hover:border-slate-500";

export const ORGS_CHIP_ON_CLASSES =
  "border-[0.5px] border-transparent bg-[#f7e2d6] text-[#7a4030] shadow-floating hover:bg-[#f1d3c3] dark:bg-[#7a4030]/30 dark:text-[#d79c84] dark:hover:bg-black";

export const ORGS_CHIP_OFF_CLASSES = SHOWING_PANEL_ACTION_CLASSES;

export const EXTREMAS_CHIP_ON_CLASSES =
  "border-[0.5px] border-slate-200 bg-white text-slate-700 shadow-floating hover:bg-white dark:border-slate-600 dark:bg-black dark:text-slate-200 dark:hover:bg-black";

export const EXTREMAS_CHIP_OFF_CLASSES = ORGS_CHIP_OFF_CLASSES;

export const EXTREMAS_BADGE_ICON = `
  <svg viewBox="0 0 14 16" fill="none" aria-hidden="true" class="h-3.5 w-3">
    <path d="M7 3 9.5 7H4.5L7 3Z" fill="#6fc284" />
    <path d="M7 13 4.5 9H9.5L7 13Z" fill="#f15b41" />
  </svg>
`;

export const SEARCH_ICON = `
  <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true" class="h-3.5 w-3.5 translate-x-[0.2px] -translate-y-[0.2px] text-brand-600 dark:text-brand-400">
    <path
      fill-rule="evenodd"
      d="M9 3.5a5.5 5.5 0 013.894 9.394l3.703 3.703a.75.75 0 11-1.06 1.06l-3.703-3.703A5.5 5.5 0 119 3.5zm0 1.5a4 4 0 100 8 4 4 0 000-8z"
      clip-rule="evenodd"
    />
  </svg>
`;

export const ARROW_ICON = `
  <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true" class="h-3.5 w-3.5">
    <path
      fill-rule="evenodd"
      d="M3 10a.75.75 0 01.75-.75h10.638L10.23 5.29a.75.75 0 111.04-1.08l5.5 5.25a.75.75 0 010 1.08l-5.5 5.25a.75.75 0 11-1.04-1.08l4.158-3.96H3.75A.75.75 0 013 10z"
      clip-rule="evenodd"
    />
  </svg>
`;

export const CHEVRON_DOWN_ICON = `
  <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true" class="h-3 w-3 transition-transform duration-150">
    <path
      fill-rule="evenodd"
      d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z"
      clip-rule="evenodd"
    />
  </svg>
`;

export const SETTINGS_ICON = `
  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" class="h-3.5 w-3.5">
    <path
      d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 0 0 2.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 0 0 1.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 0 0-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 0 0-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 0 0-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 0 0-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 0 0 1.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065Z"
      stroke="currentColor"
      stroke-width="1.2"
      stroke-linejoin="round"
    />
    <circle
      cx="12"
      cy="12"
      r="2.4"
      stroke="currentColor"
      stroke-width="1.2"
    />
  </svg>
`;

export const EXPORT_ICON = `
  <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" class="h-3.5 w-3.5">
    <path
      d="M11.5 4.75h3.75v3.75m0-3.75-5.5 5.5"
      stroke="currentColor"
      stroke-width="1.4"
      stroke-linecap="round"
      stroke-linejoin="round"
    />
    <path
      d="M9 4.75H5.5a1.75 1.75 0 0 0-1.75 1.75v8A1.75 1.75 0 0 0 5.5 16.25h8a1.75 1.75 0 0 0 1.75-1.75V11"
      stroke="currentColor"
      stroke-width="1.4"
      stroke-linecap="round"
      stroke-linejoin="round"
    />
  </svg>
`;

export const IMAGE_ICON = `
  <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" class="h-3.5 w-3.5">
    <path
      d="M4.75 4.75h10.5a1 1 0 011 1v8.5a1 1 0 01-1 1H4.75a1 1 0 01-1-1v-8.5a1 1 0 011-1Z"
      stroke="currentColor"
      stroke-width="1.25"
    />
    <circle cx="7.25" cy="8" r="1.1" fill="currentColor" />
    <path
      d="m5.75 13 2.55-2.8a.8.8 0 011.17-.03l1.46 1.52.95-.95a.8.8 0 011.15.02L14.25 13"
      stroke="currentColor"
      stroke-width="1.25"
      stroke-linecap="round"
      stroke-linejoin="round"
    />
  </svg>
`;

export const LINK_ICON = `
  <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" class="h-3.5 w-3.5">
    <path
      d="M8.35 11.65 11.65 8.35M7.9 7.25H5.6a3.1 3.1 0 1 0 0 6.2h2.3m4.2-6.2h2.3a3.1 3.1 0 1 1 0 6.2h-2.3"
      stroke="currentColor"
      stroke-width="1.55"
      stroke-linecap="round"
      stroke-linejoin="round"
    />
  </svg>
`;

export const SPREADSHEET_ICON = `
  <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" class="h-3.5 w-3.5">
    <path
      d="M4.75 3.75h10.5a1 1 0 0 1 1 1v10.5a1 1 0 0 1-1 1H4.75a1 1 0 0 1-1-1V4.75a1 1 0 0 1 1-1Z"
      stroke="currentColor"
      stroke-width="1.2"
    />
    <path d="M7 3.75v12.5M3.75 8h12.5M3.75 12h12.5" stroke="currentColor" stroke-width="1.1" />
  </svg>
`;

export const CHECK_ICON = `
  <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true" class="h-3.5 w-3.5">
    <path
      fill-rule="evenodd"
      d="M16.704 5.29a1 1 0 010 1.42l-7.24 7.24a1 1 0 01-1.42 0L3.29 9.196a1 1 0 011.42-1.42l4.044 4.044 6.53-6.53a1 1 0 011.42 0z"
      clip-rule="evenodd"
    />
  </svg>
`;

export const CATEGORY_CHIP_SELECTED_CLASSES =
  "border-transparent bg-brand-500 text-white shadow-floating hover:bg-brand-500 dark:bg-brand-900 dark:text-brand-200 dark:hover:bg-brand-800";

export const STAT_CHIP_SELECTED_CLASSES =
  "border-[1.5px] border-brand-500 bg-white text-brand-700 font-semibold shadow-floating hover:border-brand-500 hover:bg-white dark:border-brand-400 dark:bg-black dark:text-brand-300 dark:hover:border-brand-300 dark:hover:bg-black dark:!backdrop-blur-none";

export const STAT_YEAR_CHIP_CLASSES =
  "border-transparent bg-white text-brand-700 font-semibold shadow-floating hover:bg-white dark:bg-black dark:text-brand-300 dark:hover:bg-black dark:!backdrop-blur-none";

export const CATEGORY_CHIP_INACTIVE_FEATURED_CLASSES =
  "border-slate-300 bg-slate-200 text-slate-700 shadow-sm hover:bg-slate-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200";

export const MOBILE_STAT_CHIP_SELECTED_CLASSES =
  "border-[1.5px] border-brand-500 bg-white text-brand-700 font-semibold shadow-floating hover:border-brand-500 hover:bg-white dark:border-brand-400 dark:bg-black dark:text-brand-300 dark:hover:border-brand-300 dark:hover:bg-black px-3 py-1 text-xs";

export const MOBILE_STAT_CHIP_BASE_CLASSES =
  "inline-flex items-center gap-1.5 rounded-full border bg-white/90 text-brand-700 shadow-sm transition-all duration-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-400";

export const SECONDARY_STAT_CHIP_BASE_CLASSES =
  "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-all duration-300 shadow-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-400";

export const SECONDARY_STAT_CHIP_CLASSES =
  "bg-[#e9f5fa] text-[#2b8698] hover:bg-[#f1f9fc] dark:bg-[#2a7685]/22 dark:text-[#7f9ea7]";

export const CLOSE_ICON = `
  <svg viewBox="0 0 12 12" aria-hidden="true" class="block h-2.5 w-2.5">
    <path
      fill="currentColor"
      d="M9.53 2.47a.75.75 0 00-1.06-1.06L6 3.94 3.53 1.41A.75.75 0 002.47 2.47L4.94 5 2.47 7.53a.75.75 0 101.06 1.06L6 6.06l2.47 2.53a.75.75 0 001.06-1.06L7.06 5z"
    />
  </svg>
`;

export const CHIP_HIDDEN_STYLES = {
  opacity: "0",
  transform: "translateX(-8px) scale(0.95)",
  pointerEvents: "none" as const,
};

export const CHIP_VISIBLE_STYLES = {
  opacity: "1",
  transform: "translateX(0) scale(1)",
  pointerEvents: "auto" as const,
};

export const DESKTOP_CHIP_LEFT_OFFSET =
  "var(--map-chips-left-offset, calc(var(--desktop-sidebar-width, 24rem) + 0.25rem))";
