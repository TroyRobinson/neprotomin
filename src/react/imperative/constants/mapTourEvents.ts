export const MAP_TOUR_APPLY_STATE_EVENT = "ne:map-tour:apply-state";

export interface MapTourApplyStateDetail {
  lat: number;
  lng: number;
  zoom: number;
  statId: string;
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
