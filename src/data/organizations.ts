export interface OrganizationSeed {
  name: string;
  url: string;
  latitude: number;
  longitude: number;
}

export const organizationSeedData: OrganizationSeed[] = [
  {
    name: "Greenwood Community Works",
    url: "https://greenwoodworks.example",
    latitude: 36.1615,
    longitude: -95.9885,
  },
  {
    name: "Arkansas River Conservancy",
    url: "https://arkansasriverconservancy.example",
    latitude: 36.1433,
    longitude: -96.0009,
  },
  {
    name: "Tulsa Tech Collaborative",
    url: "https://tulsatechcollab.example",
    latitude: 36.1492,
    longitude: -95.9383,
  },
  {
    name: "Osage Hills Cultural Center",
    url: "https://osagehillsculture.example",
    latitude: 36.1755,
    longitude: -96.0057,
  },
  {
    name: "Blue Dome Arts Collective",
    url: "https://bluedomearts.example",
    latitude: 36.1551,
    longitude: -95.9877,
  },
];
