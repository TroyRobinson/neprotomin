export type AreasChipMode = "auto" | "zips" | "counties" | "none";

export const AREA_MODE_OPTIONS: Array<{ value: AreasChipMode; label: string }> = [
  { value: "auto", label: "Zoom" },
  { value: "zips", label: "ZIPs" },
  { value: "counties", label: "Counties" },
  { value: "none", label: "None" },
];

export interface ShowingSummaryState {
  hasSpecificSelection: boolean;
  hasOrgs: boolean;
  hasExtremas: boolean;
  trailingSegments: string[];
}

export const formatAreasModeLabel = (mode: AreasChipMode): string => {
  const match = AREA_MODE_OPTIONS.find((entry) => entry.value === mode);
  return match?.label ?? "Zoom";
};

export const getShowingSummaryState = ({
  areasMode,
  orgsVisible,
  extremasVisible,
}: {
  areasMode: AreasChipMode;
  orgsVisible: boolean;
  extremasVisible: boolean;
}): ShowingSummaryState => {
  const trailingSegments: string[] = [];
  if (areasMode === "zips") trailingSegments.push("Zips");
  else if (areasMode !== "auto") trailingSegments.push(formatAreasModeLabel(areasMode));
  return {
    hasSpecificSelection: orgsVisible || extremasVisible || trailingSegments.length > 0,
    hasOrgs: orgsVisible,
    hasExtremas: extremasVisible,
    trailingSegments,
  };
};

export const getExportCsvAreasUnavailableHelpText = () =>
  "Enable Advanced Stats mode and select one or more ZIPs or Counties to export CSV.";

export const formatStatChipLabel = (name: string): string => {
  if (name.length <= 12) return name;
  const words = name.split(/\s+/).filter(Boolean);
  if (words.length === 0) return name.slice(0, 12);
  const first = words[0];
  const second = words[1];
  if (!second) return first;
  const hasMore = second.length > 5 || words.length > 2;
  return `${first} ${second.slice(0, 5)}${hasMore ? " ..." : ""}`;
};
