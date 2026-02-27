export const MAP_TOUR_APPLY_STATE_EVENT = "ne:map-tour:apply-state";
export const MAP_TOUR_OPEN_FEEDBACK_EVENT = "ne:map-tour:open-feedback";
export const MAP_TOUR_SET_STAT_EVENT = "ne:map-tour:set-stat";
export const MAP_TOUR_SET_CAMERA_EVENT = "ne:map-tour:set-camera";
export const MAP_TOUR_CLOSE_ADD_AREAS_EVENT = "ne:map-tour:close-add-areas";
export const MAP_TOUR_OPEN_ADD_AREAS_EVENT = "ne:map-tour:open-add-areas";
export const MAP_TOUR_RESET_TO_DEFAULTS_EVENT = "ne:map-tour:reset-to-defaults";

export interface MapTourApplyStateDetail {
  lat: number;
  lng: number;
  zoom: number;
  statId: string;
  categoryFilter?: string | null;
  selectedOrganizationIds?: string[];
  orgPinsVisible?: boolean;
  extremasVisible?: boolean;
  areasMode?: "auto" | "zips" | "counties" | "none";
  showAdvanced: boolean;
  sidebarCollapsed: boolean;
  sidebarTab: "orgs" | "stats";
  sidebarInsights: {
    statVizVisible: boolean;
    statVizCollapsed: boolean;
    demographicsVisible: boolean;
    demographicsExpanded: boolean;
  };
  selectedZips: string[];
  selectedCounties: string[];
}

export interface MapTourSetStatDetail {
  statId?: string;
  secondaryStatId?: string | null;
}

export interface MapTourSetCameraDetail {
  lat: number;
  lng: number;
  zoom: number;
}

export const MAP_TOUR_ADVANCED_STATS_PRESET: MapTourApplyStateDetail = {
  lat: 35.4401,
  lng: -97.6648,
  zoom: 10.26,
  statId: "8807bf0b-5a85-4a73-82f2-cd18c8140072",
  showAdvanced: true,
  sidebarCollapsed: false,
  sidebarTab: "stats",
  sidebarInsights: {
    statVizVisible: true,
    statVizCollapsed: false,
    demographicsVisible: true,
    demographicsExpanded: false,
  },
  selectedZips: ["73108"],
  selectedCounties: [],
};

export const MAP_TOUR_DEMOGRAPHICS_PRESET: MapTourApplyStateDetail = {
  lat: 35.5075,
  lng: -97.6245,
  zoom: 10.2,
  statId: "8807bf0b-5a85-4a73-82f2-cd18c8140072",
  showAdvanced: true,
  sidebarCollapsed: false,
  sidebarTab: "stats",
  sidebarInsights: {
    statVizVisible: true,
    statVizCollapsed: false,
    demographicsVisible: true,
    demographicsExpanded: false,
  },
  selectedZips: ["73108"],
  selectedCounties: [],
};

export const MAP_TOUR_ADD_AREAS_PRESET: MapTourApplyStateDetail = {
  lat: 35.482,
  lng: -97.5958,
  zoom: 10.2,
  statId: "8807bf0b-5a85-4a73-82f2-cd18c8140072",
  showAdvanced: true,
  sidebarCollapsed: false,
  sidebarTab: "stats",
  sidebarInsights: {
    statVizVisible: true,
    statVizCollapsed: false,
    demographicsVisible: true,
    demographicsExpanded: false,
  },
  selectedZips: ["73108", "73129"],
  selectedCounties: [],
};

export const MAP_TOUR_OTHER_STATS_PRESET: MapTourApplyStateDetail = {
  lat: 35.5891,
  lng: -97.6423,
  zoom: 10.31,
  statId: "ad0bade2-872a-4f30-bbf2-49bf3d14e7d7",
  showAdvanced: false,
  sidebarCollapsed: false,
  sidebarTab: "stats",
  sidebarInsights: {
    statVizVisible: true,
    statVizCollapsed: false,
    demographicsVisible: true,
    demographicsExpanded: false,
  },
  selectedZips: [],
  selectedCounties: [],
};

export const MAP_TOUR_EXTREMAS_PRESET: MapTourApplyStateDetail = {
  lat: 35.7687,
  lng: -97.4625,
  zoom: 7.97,
  statId: "8807bf0b-5a85-4a73-82f2-cd18c8140072",
  orgPinsVisible: false,
  extremasVisible: true,
  areasMode: "auto",
  showAdvanced: false,
  sidebarCollapsed: true,
  sidebarTab: "stats",
  sidebarInsights: {
    statVizVisible: true,
    statVizCollapsed: false,
    demographicsVisible: true,
    demographicsExpanded: false,
  },
  selectedZips: [],
  selectedCounties: [],
};

export const MAP_TOUR_SHOWING_AREAS_PRESET: MapTourApplyStateDetail = {
  lat: 36.191,
  lng: -97.0221,
  zoom: 8.79,
  statId: "8665d3d9-90de-4376-b538-b72826e4ffde",
  categoryFilter: null,
  orgPinsVisible: false,
  extremasVisible: false,
  areasMode: "auto",
  showAdvanced: false,
  sidebarCollapsed: true,
  sidebarTab: "stats",
  sidebarInsights: {
    statVizVisible: true,
    statVizCollapsed: false,
    demographicsVisible: true,
    demographicsExpanded: false,
  },
  selectedZips: [],
  selectedCounties: [],
};

export const MAP_TOUR_ORGS_PRESET: MapTourApplyStateDetail = {
  lat: 35.5167,
  lng: -97.4445,
  zoom: 11.26,
  statId: "8383685c-2741-40a2-96ff-759c42ddd586",
  categoryFilter: "food",
  orgPinsVisible: true,
  extremasVisible: false,
  areasMode: "auto",
  showAdvanced: false,
  sidebarCollapsed: true,
  sidebarTab: "orgs",
  sidebarInsights: {
    statVizVisible: true,
    statVizCollapsed: false,
    demographicsVisible: true,
    demographicsExpanded: false,
  },
  selectedZips: [],
  selectedCounties: [],
};

export const MAP_TOUR_SIDEBAR_ORGS_PRESET: MapTourApplyStateDetail = {
  lat: 35.5125,
  lng: -97.6893,
  zoom: 10.64,
  statId: "ad0bade2-872a-4f30-bbf2-49bf3d14e7d7",
  orgPinsVisible: true,
  extremasVisible: false,
  areasMode: "auto",
  showAdvanced: false,
  sidebarCollapsed: false,
  sidebarTab: "orgs",
  sidebarInsights: {
    statVizVisible: true,
    statVizCollapsed: false,
    demographicsVisible: true,
    demographicsExpanded: false,
  },
  selectedZips: [],
  selectedCounties: [],
};

export const MAP_TOUR_SIDEBAR_CATEGORY_PRESET: MapTourApplyStateDetail = {
  lat: 35.5545,
  lng: -97.6551,
  zoom: 10.04,
  statId: "ce870153-e57c-4c7b-97b9-14af9072dbd3",
  categoryFilter: "education",
  orgPinsVisible: true,
  extremasVisible: false,
  areasMode: "auto",
  showAdvanced: false,
  sidebarCollapsed: false,
  sidebarTab: "orgs",
  sidebarInsights: {
    statVizVisible: true,
    statVizCollapsed: false,
    demographicsVisible: true,
    demographicsExpanded: false,
  },
  selectedZips: [],
  selectedCounties: [],
};
