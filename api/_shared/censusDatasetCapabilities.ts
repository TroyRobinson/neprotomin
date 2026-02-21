export type CensusDatasetSupportTier = "importable_now" | "research_only" | "out_of_scope";

export type CensusDatasetCapability = {
  dataset: string;
  label: string;
  searchable: boolean;
  importable: boolean;
  supportTier: CensusDatasetSupportTier;
  supportedGeographies: string[];
  notes: string;
};

const DATASET_CAPABILITIES: CensusDatasetCapability[] = [
  {
    dataset: "acs/acs5",
    label: "ACS 5-Year Detailed Tables",
    searchable: true,
    importable: true,
    supportTier: "importable_now",
    supportedGeographies: ["ZIP", "COUNTY"],
    notes: "Primary dataset path used by current import pipeline.",
  },
  {
    dataset: "acs/acs5/profile",
    label: "ACS 5-Year Data Profiles",
    searchable: true,
    importable: true,
    supportTier: "importable_now",
    supportedGeographies: ["ZIP", "COUNTY"],
    notes: "Supported when group prefixes resolve to profile tables (DP*).",
  },
  {
    dataset: "acs/acs5/subject",
    label: "ACS 5-Year Subject Tables",
    searchable: true,
    importable: true,
    supportTier: "importable_now",
    supportedGeographies: ["ZIP", "COUNTY"],
    notes: "Supported when group prefixes resolve to subject tables (S*).",
  },
  {
    dataset: "acs/acs5/cprofile",
    label: "ACS 5-Year Comparison Profiles",
    searchable: true,
    importable: true,
    supportTier: "importable_now",
    supportedGeographies: ["ZIP", "COUNTY"],
    notes: "Supported when group prefixes resolve to comparison profiles (CP*).",
  },
  {
    dataset: "cbp",
    label: "County Business Patterns",
    searchable: true,
    importable: false,
    supportTier: "research_only",
    supportedGeographies: ["COUNTY", "STATE", "US"],
    notes:
      "Business coverage is strong, but current importer assumes ZIP + COUNTY and CBP does not expose ZCTA geography.",
  },
  {
    dataset: "abscb",
    label: "Annual Business Survey",
    searchable: true,
    importable: false,
    supportTier: "research_only",
    supportedGeographies: ["COUNTY", "STATE", "US"],
    notes:
      "Useful for business planning research; import adapter is not wired yet for non-ZIP datasets.",
  },
];

const normalizeDataset = (dataset: string): string => dataset.trim().toLowerCase();

const CAPABILITY_BY_DATASET = new Map<string, CensusDatasetCapability>(
  DATASET_CAPABILITIES.map((entry) => [normalizeDataset(entry.dataset), entry]),
);

export const listDatasetCapabilities = (): CensusDatasetCapability[] => [...DATASET_CAPABILITIES];

export const getDatasetCapability = (dataset: string | null | undefined): CensusDatasetCapability | null => {
  if (!dataset) return null;
  const normalized = normalizeDataset(dataset);
  return CAPABILITY_BY_DATASET.get(normalized) ?? null;
};
