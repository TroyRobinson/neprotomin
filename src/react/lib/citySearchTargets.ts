/**
 * City search targets provide pre-defined viewport settings for popular Oklahoma cities.
 * When the query matches one of these aliases, we can jump straight to a ZIP-level zoom.
 */
export interface CitySearchTarget {
  name: string;
  aliases: string[];
  center: [number, number]; // [lng, lat]
  zoom?: number;
  bounds?: [[number, number], [number, number]]; // [[minLng, minLat], [maxLng, maxLat]]
}

export const DEFAULT_CITY_ZOOM = 10;

const normalizeCityQuery = (value: string): string => {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\b(oklahoma|ok)\b$/g, "")
    .trim();
};

const createBounds = (center: [number, number], latDelta: number, lngDelta: number): [[number, number], [number, number]] => {
  const [lng, lat] = center;
  return [
    [lng - lngDelta, lat - latDelta],
    [lng + lngDelta, lat + latDelta],
  ];
};

const CITY_SEARCH_TARGETS: CitySearchTarget[] = [
  {
    name: "Oklahoma City",
    aliases: ["oklahoma city", "okc"],
    center: [-97.5164, 35.4676],
    bounds: createBounds([-97.5164, 35.4676], 0.27, 0.36),
  },
  {
    name: "Tulsa",
    aliases: ["tulsa"],
    center: [-95.9928, 36.154],
    bounds: createBounds([-95.9928, 36.154], 0.2, 0.25),
  },
  {
    name: "Norman",
    aliases: ["norman"],
    center: [-97.4395, 35.2226],
    bounds: createBounds([-97.4395, 35.2226], 0.12, 0.16),
  },
  {
    name: "Broken Arrow",
    aliases: ["broken arrow"],
    center: [-95.7975, 36.0609],
    bounds: createBounds([-95.7975, 36.0609], 0.12, 0.14),
  },
  {
    name: "Edmond",
    aliases: ["edmond"],
    center: [-97.4781, 35.6528],
    bounds: createBounds([-97.4781, 35.6528], 0.11, 0.13),
  },
  {
    name: "Lawton",
    aliases: ["lawton"],
    center: [-98.3959, 34.6036],
    bounds: createBounds([-98.3959, 34.6036], 0.12, 0.16),
  },
  {
    name: "Moore",
    aliases: ["moore"],
    center: [-97.4867, 35.3395],
    bounds: createBounds([-97.4867, 35.3395], 0.08, 0.1),
  },
  {
    name: "Midwest City",
    aliases: ["midwest city", "mid-west city"],
    center: [-97.3967, 35.4495],
    bounds: createBounds([-97.3967, 35.4495], 0.08, 0.1),
  },
  {
    name: "Enid",
    aliases: ["enid"],
    center: [-97.8784, 36.3956],
    bounds: createBounds([-97.8784, 36.3956], 0.1, 0.12),
  },
  {
    name: "Stillwater",
    aliases: ["stillwater"],
    center: [-97.0584, 36.1156],
    bounds: createBounds([-97.0584, 36.1156], 0.09, 0.11),
  },
  {
    name: "Owasso",
    aliases: ["owasso"],
    center: [-95.8547, 36.2695],
    bounds: createBounds([-95.8547, 36.2695], 0.07, 0.09),
  },
  {
    name: "Bartlesville",
    aliases: ["bartlesville"],
    center: [-95.9808, 36.7473],
    bounds: createBounds([-95.9808, 36.7473], 0.08, 0.1),
  },
  {
    name: "Shawnee",
    aliases: ["shawnee"],
    center: [-96.9253, 35.3273],
    bounds: createBounds([-96.9253, 35.3273], 0.09, 0.11),
  },
  {
    name: "Yukon",
    aliases: ["yukon"],
    center: [-97.7625, 35.5067],
    bounds: createBounds([-97.7625, 35.5067], 0.08, 0.1),
  },
  {
    name: "Bixby",
    aliases: ["bixby"],
    center: [-95.8833, 35.942],
    bounds: createBounds([-95.8833, 35.942], 0.07, 0.09),
  },
  {
    name: "Ardmore",
    aliases: ["ardmore"],
    center: [-97.1436, 34.1743],
    bounds: createBounds([-97.1436, 34.1743], 0.1, 0.12),
  },
  {
    name: "Ponca City",
    aliases: ["ponca city", "ponca"],
    center: [-97.0856, 36.706],
    bounds: createBounds([-97.0856, 36.706], 0.1, 0.12),
  },
  {
    name: "Duncan",
    aliases: ["duncan"],
    center: [-97.9578, 34.5023],
    bounds: createBounds([-97.9578, 34.5023], 0.1, 0.12),
  },
  {
    name: "Del City",
    aliases: ["del city", "delcity"],
    center: [-97.4401, 35.442],
    bounds: createBounds([-97.4401, 35.442], 0.07, 0.09),
  },
  {
    name: "Jenks",
    aliases: ["jenks"],
    center: [-95.9753, 36.0104],
    bounds: createBounds([-95.9753, 36.0104], 0.07, 0.09),
  },
  {
    name: "Sapulpa",
    aliases: ["sapulpa"],
    center: [-96.1142, 35.9987],
    bounds: createBounds([-96.1142, 35.9987], 0.08, 0.1),
  },
  {
    name: "Mustang",
    aliases: ["mustang"],
    center: [-97.7245, 35.3845],
    bounds: createBounds([-97.7245, 35.3845], 0.08, 0.1),
  },
  {
    name: "Sand Springs",
    aliases: ["sand springs"],
    center: [-96.1089, 36.1398],
    bounds: createBounds([-96.1089, 36.1398], 0.09, 0.11),
  },
  {
    name: "El Reno",
    aliases: ["el reno", "elreno"],
    center: [-97.955, 35.5323],
    bounds: createBounds([-97.955, 35.5323], 0.1, 0.12),
  },
  {
    name: "Muskogee",
    aliases: ["muskogee"],
    center: [-95.3697, 35.7479],
    bounds: createBounds([-95.3697, 35.7479], 0.1, 0.12),
  },
  {
    name: "Bethany",
    aliases: ["bethany"],
    center: [-97.6325, 35.5181],
    bounds: createBounds([-97.6325, 35.5181], 0.07, 0.09),
  },
  {
    name: "Altus",
    aliases: ["altus"],
    center: [-99.334, 34.6381],
    bounds: createBounds([-99.334, 34.6381], 0.1, 0.12),
  },
  {
    name: "Claremore",
    aliases: ["claremore"],
    center: [-95.6161, 36.3126],
    bounds: createBounds([-95.6161, 36.3126], 0.08, 0.1),
  },
  {
    name: "Durant",
    aliases: ["durant"],
    center: [-96.3708, 33.9934],
    bounds: createBounds([-96.3708, 33.9934], 0.1, 0.12),
  },
  {
    name: "Chickasha",
    aliases: ["chickasha"],
    center: [-97.9364, 35.0526],
    bounds: createBounds([-97.9364, 35.0526], 0.1, 0.12),
  },
];

const cityAliasMap = (() => {
  const map = new Map<string, CitySearchTarget>();
  for (const target of CITY_SEARCH_TARGETS) {
    const aliases = new Set<string>([target.name, ...target.aliases]);
    for (const alias of aliases) {
      const key = normalizeCityQuery(alias);
      if (!key) continue;
      map.set(key, target);
    }
  }
  return map;
})();

export const findCitySearchTarget = (query: string): CitySearchTarget | null => {
  const key = normalizeCityQuery(query);
  if (!key) return null;
  return cityAliasMap.get(key) ?? null;
};
