import type { Category } from "../types/organization";

export interface OrganizationSeed {
  name: string;
  url: string;
  latitude: number;
  longitude: number;
  category: Category;
}

export const organizationSeedData: OrganizationSeed[] = [
  {
    name: "Greenwood Community Works",
    url: "https://greenwoodworks.example",
    latitude: 36.1615,
    longitude: -95.9885,
    category: "economy",
  },
  {
    name: "Arkansas River Conservancy",
    url: "https://arkansasriverconservancy.example",
    latitude: 36.1433,
    longitude: -96.0009,
    category: "justice",
  },
  {
    name: "Tulsa Tech Collaborative",
    url: "https://tulsatechcollab.example",
    latitude: 36.1492,
    longitude: -95.9383,
    category: "education",
  },
  {
    name: "Osage Hills Cultural Center",
    url: "https://osagehillsculture.example",
    latitude: 36.1755,
    longitude: -96.0057,
    category: "justice",
  },
  {
    name: "Blue Dome Arts Collective",
    url: "https://bluedomearts.example",
    latitude: 36.1551,
    longitude: -95.9877,
    category: "health",
  },
];
