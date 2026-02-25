export const MAP_TOUR_APPLY_STATE_EVENT = "ne:map-tour:apply-state";
export const MAP_TOUR_OPEN_FEEDBACK_EVENT = "ne:map-tour:open-feedback";
export const MAP_TOUR_SET_STAT_EVENT = "ne:map-tour:set-stat";

export interface MapTourApplyStateDetail {
  lat: number;
  lng: number;
  zoom: number;
  statId: string;
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
  statId: string;
}

export const MAP_TOUR_ADVANCED_STATS_PRESET: MapTourApplyStateDetail = {
  lat: 35.4304,
  lng: -97.5743,
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

export const MAP_TOUR_EXTREMAS_PRESET: MapTourApplyStateDetail = {
  lat: 35.4998,
  lng: -97.433,
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

export const MAP_TOUR_ORGS_PRESET: MapTourApplyStateDetail = {
  lat: 35.1064,
  lng: -96.9776,
  zoom: 8.5,
  statId: "8807bf0b-5a85-4a73-82f2-cd18c8140072",
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
