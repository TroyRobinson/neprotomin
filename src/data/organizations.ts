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
  // Additional Tulsa organizations to broaden seed coverage across the city
  {
    name: "Kendall-Whittier Neighborhood Alliance",
    url: "https://kendallwhittieralliance.example",
    latitude: 36.1565,
    longitude: -95.9647,
    category: "justice",
  },
  {
    name: "Pearl District Wellness Network",
    url: "https://pearldistrictwellness.example",
    latitude: 36.1505,
    longitude: -95.9695,
    category: "health",
  },
  {
    name: "Brookside Learning Hub",
    url: "https://brooksidellearninghub.example",
    latitude: 36.106,
    longitude: -95.975,
    category: "education",
  },
  {
    name: "Riverside Environmental Stewardship",
    url: "https://riversidestewardship.example",
    latitude: 36.127,
    longitude: -96.002,
    category: "justice",
  },
  {
    name: "Red Fork Community Resource Center",
    url: "https://redforkresources.example",
    latitude: 36.103,
    longitude: -96.022,
    category: "economy",
  },
  {
    name: "East Tulsa Workforce Partnership",
    url: "https://easttulsaworkforce.example",
    latitude: 36.139,
    longitude: -95.8615,
    category: "economy",
  },
  {
    name: "Midtown Health Access Collaborative",
    url: "https://midtownhealthaccess.example",
    latitude: 36.131,
    longitude: -95.947,
    category: "health",
  },
  {
    name: "North Tulsa Youth Education Coalition",
    url: "https://northtulsayouthedu.example",
    latitude: 36.201,
    longitude: -95.984,
    category: "education",
  },
  {
    name: "Cherry Street Food Security Initiative",
    url: "https://cherrystreetfoodsecurity.example",
    latitude: 36.141,
    longitude: -95.961,
    category: "health",
  },
  {
    name: "Tulsa Hills Small Business Council",
    url: "https://tulsahillssbc.example",
    latitude: 36.065,
    longitude: -96.035,
    category: "economy",
  },
  {
    name: "Expo Square Education Fund",
    url: "https://exposquareeducation.example",
    latitude: 36.131,
    longitude: -95.946,
    category: "education",
  },
  {
    name: "University Square Civic League",
    url: "https://universitysquarecivics.example",
    latitude: 36.153,
    longitude: -95.945,
    category: "justice",
  },
  {
    name: "Owen Park Heritage Society",
    url: "https://owenparkheritage.example",
    latitude: 36.169,
    longitude: -96.01,
    category: "justice",
  },
  {
    name: "Airport Gateway Jobs Initiative",
    url: "https://airportgatewayjobs.example",
    latitude: 36.192,
    longitude: -95.889,
    category: "economy",
  },
  {
    name: "South Tulsa Family Services",
    url: "https://southtulsafamilies.example",
    latitude: 36.037,
    longitude: -95.922,
    category: "health",
  },
];
