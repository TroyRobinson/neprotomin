import type { Category, OrganizationStatus } from "../types/organization";

export interface OrganizationSeed {
  name: string;
  website?: string;
  latitude: number;
  longitude: number;
  category: Category;
  status?: OrganizationStatus;
  address?: string;
  city?: string;
  state?: string;
  postalCode?: string;
}

/**
 * Test/example organization data.
 * 
 * NOTE: Automatic seeding of this test data is disabled. These organizations
 * will only appear if manually seeded via `npm run seed` or by calling
 * `ensureOrganizationsSeeded()` directly.
 */
export const organizationSeedData: OrganizationSeed[] = [
  {
    name: "Greenwood Community Works",
    website: "https://greenwoodworks.example",
    latitude: 36.1615,
    longitude: -95.9885,
    category: "economy",
  },
  {
    name: " ",
    website: "https://arkansasriverconservancy.example",
    latitude: 36.1433,
    longitude: -96.0009,
    category: "justice",
  },
  {
    name: "Tulsa Tech Collaborative",
    website: "https://tulsatechcollab.example",
    latitude: 36.1492,
    longitude: -95.9383,
    category: "education",
  },
  {
    name: "Osage Hills Cultural Center",
    website: "https://osagehillsculture.example",
    latitude: 36.1755,
    longitude: -96.0057,
    category: "justice",
  },
  {
    name: "Blue Dome Arts Collective",
    website: "https://bluedomearts.example",
    latitude: 36.1551,
    longitude: -95.9877,
    category: "health",
  },
  // Additional Tulsa organizations to broaden seed coverage across the city
  {
    name: "Kendall-Whittier Neighborhood Alliance",
    website: "https://kendallwhittieralliance.example",
    latitude: 36.1565,
    longitude: -95.9647,
    category: "justice",
  },
  {
    name: "Pearl District Wellness Network",
    website: "https://pearldistrictwellness.example",
    latitude: 36.1505,
    longitude: -95.9695,
    category: "health",
  },
  {
    name: "Brookside Learning Hub",
    website: "https://brooksidellearninghub.example",
    latitude: 36.106,
    longitude: -95.975,
    category: "education",
  },
  {
    name: "Riverside Environmental Stewardship",
    website: "https://riversidestewardship.example",
    latitude: 36.127,
    longitude: -96.002,
    category: "justice",
  },
  {
    name: "Red Fork Community Resource Center",
    website: "https://redforkresources.example",
    latitude: 36.103,
    longitude: -96.022,
    category: "economy",
  },
  {
    name: "East Tulsa Workforce Partnership",
    website: "https://easttulsaworkforce.example",
    latitude: 36.139,
    longitude: -95.8615,
    category: "economy",
  },
  {
    name: "Midtown Health Access Collaborative",
    website: "https://midtownhealthaccess.example",
    latitude: 36.131,
    longitude: -95.947,
    category: "health",
  },
  {
    name: "North Tulsa Youth Education Coalition",
    website: "https://northtulsayouthedu.example",
    latitude: 36.201,
    longitude: -95.984,
    category: "education",
  },
  {
    name: "Cherry Street Food Security Initiative",
    website: "https://cherrystreetfoodsecurity.example",
    latitude: 36.141,
    longitude: -95.961,
    category: "health",
  },
  {
    name: "Tulsa Hills Small Business Council",
    website: "https://tulsahillssbc.example",
    latitude: 36.065,
    longitude: -96.035,
    category: "economy",
  },
  {
    name: "Expo Square Education Fund",
    website: "https://exposquareeducation.example",
    latitude: 36.131,
    longitude: -95.946,
    category: "education",
  },
  {
    name: "University Square Civic League",
    website: "https://universitysquarecivics.example",
    latitude: 36.153,
    longitude: -95.945,
    category: "justice",
  },
  {
    name: "Owen Park Heritage Society",
    website: "https://owenparkheritage.example",
    latitude: 36.169,
    longitude: -96.01,
    category: "justice",
  },
  {
    name: "Airport Gateway Jobs Initiative",
    website: "https://airportgatewayjobs.example",
    latitude: 36.192,
    longitude: -95.889,
    category: "economy",
  },
  {
    name: "South Tulsa Family Services",
    website: "https://southtulsafamilies.example",
    latitude: 36.037,
    longitude: -95.922,
    category: "health",
  },
];
