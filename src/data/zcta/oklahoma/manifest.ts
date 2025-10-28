/**
 * AUTO-GENERATED FILE.
 * Generated via scripts/geo/build-oklahoma-zctas.js
 * Do not edit by hand.
 */
import type { FeatureCollection } from "geojson";

export type BoundsArray = [[number, number], [number, number]];

export interface OklahomaZctaChunkMeta {
  id: string;
  countyId: string;
  name: string;
  bbox: BoundsArray;
  load: () => Promise<FeatureCollection<GeoJSON.MultiPolygon | GeoJSON.Polygon, { zip: string; county?: string; name?: string; [key: string]: unknown }>>;
}

export const oklahomaZctaManifest: OklahomaZctaChunkMeta[] = [
  {
    id: "ok-001",
    countyId: "001",
    name: "Adair",
    bbox: [[-94.866625,35.638328],[-94.477843,36.110949]],
    load: async () => {
      const module = await import("./adair");
      return module.default;
    },
  },
  {
    id: "ok-003",
    countyId: "003",
    name: "Alfalfa",
    bbox: [[-98.54059,36.289352],[-97.912902,36.998741]],
    load: async () => {
      const module = await import("./alfalfa");
      return module.default;
    },
  },
  {
    id: "ok-005",
    countyId: "005",
    name: "Atoka",
    bbox: [[-96.401162,34.026475],[-95.51421,34.759848]],
    load: async () => {
      const module = await import("./atoka");
      return module.default;
    },
  },
  {
    id: "ok-007",
    countyId: "007",
    name: "Beaver",
    bbox: [[-100.954348,36.499288],[-99.563928,37.002312]],
    load: async () => {
      const module = await import("./beaver");
      return module.default;
    },
  },
  {
    id: "ok-009",
    countyId: "009",
    name: "Beckham",
    bbox: [[-100.000419,35.029889],[-99.311376,35.580723]],
    load: async () => {
      const module = await import("./beckham");
      return module.default;
    },
  },
  {
    id: "ok-011",
    countyId: "011",
    name: "Blaine",
    bbox: [[-98.789778,35.233036],[-98.135954,36.216859]],
    load: async () => {
      const module = await import("./blaine");
      return module.default;
    },
  },
  {
    id: "ok-999",
    countyId: "999",
    name: "Border ZCTAs",
    bbox: [[-103.37973,32.985875],[-93.66444,37.469528]],
    load: async () => {
      const module = await import("./border-zctas");
      return module.default;
    },
  },
  {
    id: "ok-013",
    countyId: "013",
    name: "Bryan",
    bbox: [[-96.63002,33.686216],[-95.885809,34.15685]],
    load: async () => {
      const module = await import("./bryan");
      return module.default;
    },
  },
  {
    id: "ok-015",
    countyId: "015",
    name: "Caddo",
    bbox: [[-98.588382,34.793112],[-97.881685,35.551639]],
    load: async () => {
      const module = await import("./caddo");
      return module.default;
    },
  },
  {
    id: "ok-017",
    countyId: "017",
    name: "Canadian",
    bbox: [[-98.286141,35.232638],[-97.601005,35.72597]],
    load: async () => {
      const module = await import("./canadian");
      return module.default;
    },
  },
  {
    id: "ok-019",
    countyId: "019",
    name: "Carter",
    bbox: [[-97.579943,33.904822],[-96.893845,34.514102]],
    load: async () => {
      const module = await import("./carter");
      return module.default;
    },
  },
  {
    id: "ok-021",
    countyId: "021",
    name: "Cherokee",
    bbox: [[-95.282992,35.579736],[-94.552116,36.17975]],
    load: async () => {
      const module = await import("./cherokee");
      return module.default;
    },
  },
  {
    id: "ok-023",
    countyId: "023",
    name: "Choctaw",
    bbox: [[-95.991578,33.834785],[-94.898539,34.312888]],
    load: async () => {
      const module = await import("./choctaw");
      return module.default;
    },
  },
  {
    id: "ok-025",
    countyId: "025",
    name: "Cimarron",
    bbox: [[-103.002413,36.400753],[-101.690634,37.00015]],
    load: async () => {
      const module = await import("./cimarron");
      return module.default;
    },
  },
  {
    id: "ok-027",
    countyId: "027",
    name: "Cleveland",
    bbox: [[-97.671415,34.927417],[-97.124315,35.444262]],
    load: async () => {
      const module = await import("./cleveland");
      return module.default;
    },
  },
  {
    id: "ok-029",
    countyId: "029",
    name: "Coal",
    bbox: [[-96.513787,34.41823],[-96.04633,34.76758]],
    load: async () => {
      const module = await import("./coal");
      return module.default;
    },
  },
  {
    id: "ok-031",
    countyId: "031",
    name: "Comanche",
    bbox: [[-98.843656,34.420289],[-97.664078,34.855595]],
    load: async () => {
      const module = await import("./comanche");
      return module.default;
    },
  },
  {
    id: "ok-033",
    countyId: "033",
    name: "Cotton",
    bbox: [[-98.610058,34.06227],[-97.562323,34.598487]],
    load: async () => {
      const module = await import("./cotton");
      return module.default;
    },
  },
  {
    id: "ok-035",
    countyId: "035",
    name: "Craig",
    bbox: [[-95.503646,36.442323],[-94.814178,36.99965]],
    load: async () => {
      const module = await import("./craig");
      return module.default;
    },
  },
  {
    id: "ok-037",
    countyId: "037",
    name: "Creek",
    bbox: [[-96.628028,35.623837],[-95.959076,36.196337]],
    load: async () => {
      const module = await import("./creek");
      return module.default;
    },
  },
  {
    id: "ok-039",
    countyId: "039",
    name: "Custer",
    bbox: [[-99.364632,35.262297],[-98.593947,35.909667]],
    load: async () => {
      const module = await import("./custer");
      return module.default;
    },
  },
  {
    id: "ok-041",
    countyId: "041",
    name: "Delaware",
    bbox: [[-94.957517,36.104358],[-94.565214,36.69293]],
    load: async () => {
      const module = await import("./delaware");
      return module.default;
    },
  },
  {
    id: "ok-043",
    countyId: "043",
    name: "Dewey",
    bbox: [[-99.381039,35.812302],[-98.475531,36.202674]],
    load: async () => {
      const module = await import("./dewey");
      return module.default;
    },
  },
  {
    id: "ok-045",
    countyId: "045",
    name: "Ellis",
    bbox: [[-100.07886,35.841955],[-99.381022,36.652078]],
    load: async () => {
      const module = await import("./ellis");
      return module.default;
    },
  },
  {
    id: "ok-047",
    countyId: "047",
    name: "Garfield",
    bbox: [[-98.104427,36.058006],[-97.23806,36.660237]],
    load: async () => {
      const module = await import("./garfield");
      return module.default;
    },
  },
  {
    id: "ok-049",
    countyId: "049",
    name: "Garvin",
    bbox: [[-97.703659,34.375417],[-96.827088,34.914083]],
    load: async () => {
      const module = await import("./garvin");
      return module.default;
    },
  },
  {
    id: "ok-051",
    countyId: "051",
    name: "Grady",
    bbox: [[-98.18082,34.677587],[-97.459183,35.345627]],
    load: async () => {
      const module = await import("./grady");
      return module.default;
    },
  },
  {
    id: "ok-053",
    countyId: "053",
    name: "Grant",
    bbox: [[-98.110473,36.535755],[-97.39044,36.999085]],
    load: async () => {
      const module = await import("./grant");
      return module.default;
    },
  },
  {
    id: "ok-055",
    countyId: "055",
    name: "Greer",
    bbox: [[-99.912398,34.724555],[-99.289412,35.170023]],
    load: async () => {
      const module = await import("./greer");
      return module.default;
    },
  },
  {
    id: "ok-057",
    countyId: "057",
    name: "Harmon",
    bbox: [[-100.000459,34.373577],[-99.459031,35.030263]],
    load: async () => {
      const module = await import("./harmon");
      return module.default;
    },
  },
  {
    id: "ok-059",
    countyId: "059",
    name: "Harper",
    bbox: [[-99.985335,36.656262],[-99.294944,37.001645]],
    load: async () => {
      const module = await import("./harper");
      return module.default;
    },
  },
  {
    id: "ok-061",
    countyId: "061",
    name: "Haskell",
    bbox: [[-95.511117,35.057631],[-94.743144,35.458894]],
    load: async () => {
      const module = await import("./haskell");
      return module.default;
    },
  },
  {
    id: "ok-063",
    countyId: "063",
    name: "Hughes",
    bbox: [[-96.441368,34.723901],[-95.979152,35.349464]],
    load: async () => {
      const module = await import("./hughes");
      return module.default;
    },
  },
  {
    id: "ok-065",
    countyId: "065",
    name: "Jackson",
    bbox: [[-99.544606,34.337767],[-99.037094,34.859488]],
    load: async () => {
      const module = await import("./jackson");
      return module.default;
    },
  },
  {
    id: "ok-067",
    countyId: "067",
    name: "Jefferson",
    bbox: [[-98.139198,33.849093],[-97.473977,34.296824]],
    load: async () => {
      const module = await import("./jefferson");
      return module.default;
    },
  },
  {
    id: "ok-069",
    countyId: "069",
    name: "Johnston",
    bbox: [[-96.942078,34.1141],[-96.302907,34.506128]],
    load: async () => {
      const module = await import("./johnston");
      return module.default;
    },
  },
  {
    id: "ok-071",
    countyId: "071",
    name: "Kay",
    bbox: [[-97.462477,36.550097],[-96.503535,36.999286]],
    load: async () => {
      const module = await import("./kay");
      return module.default;
    },
  },
  {
    id: "ok-073",
    countyId: "073",
    name: "Kingfisher",
    bbox: [[-98.210141,35.609389],[-97.497171,36.165039]],
    load: async () => {
      const module = await import("./kingfisher");
      return module.default;
    },
  },
  {
    id: "ok-075",
    countyId: "075",
    name: "Kiowa",
    bbox: [[-99.409291,34.526882],[-98.755422,35.196982]],
    load: async () => {
      const module = await import("./kiowa");
      return module.default;
    },
  },
  {
    id: "ok-077",
    countyId: "077",
    name: "Latimer",
    bbox: [[-95.514252,34.587632],[-94.670911,35.107365]],
    load: async () => {
      const module = await import("./latimer");
      return module.default;
    },
  },
  {
    id: "ok-079",
    countyId: "079",
    name: "Le Flore",
    bbox: [[-95.041938,34.371015],[-93.929941,35.387431]],
    load: async () => {
      const module = await import("./le-flore");
      return module.default;
    },
  },
  {
    id: "ok-081",
    countyId: "081",
    name: "Lincoln",
    bbox: [[-97.070088,35.391704],[-96.510787,35.963635]],
    load: async () => {
      const module = await import("./lincoln");
      return module.default;
    },
  },
  {
    id: "ok-083",
    countyId: "083",
    name: "Logan",
    bbox: [[-97.674068,35.536937],[-96.963881,36.14527]],
    load: async () => {
      const module = await import("./logan");
      return module.default;
    },
  },
  {
    id: "ok-085",
    countyId: "085",
    name: "Love",
    bbox: [[-97.463648,33.717044],[-96.934817,34.080212]],
    load: async () => {
      const module = await import("./love");
      return module.default;
    },
  },
  {
    id: "ok-093",
    countyId: "093",
    name: "Major",
    bbox: [[-99.050968,36.049826],[-97.98251,36.477929]],
    load: async () => {
      const module = await import("./major");
      return module.default;
    },
  },
  {
    id: "ok-095",
    countyId: "095",
    name: "Marshall",
    bbox: [[-96.974094,33.824407],[-96.547477,34.172748]],
    load: async () => {
      const module = await import("./marshall");
      return module.default;
    },
  },
  {
    id: "ok-097",
    countyId: "097",
    name: "Mayes",
    bbox: [[-95.430709,36.035322],[-94.833163,36.53959]],
    load: async () => {
      const module = await import("./mayes");
      return module.default;
    },
  },
  {
    id: "ok-087",
    countyId: "087",
    name: "McClain",
    bbox: [[-97.671415,34.724692],[-96.887362,35.337465]],
    load: async () => {
      const module = await import("./mcclain");
      return module.default;
    },
  },
  {
    id: "ok-089",
    countyId: "089",
    name: "McCurtain",
    bbox: [[-95.190858,33.615833],[-94.260254,34.478337]],
    load: async () => {
      const module = await import("./mccurtain");
      return module.default;
    },
  },
  {
    id: "ok-091",
    countyId: "091",
    name: "McIntosh",
    bbox: [[-95.981504,35.101585],[-95.141296,35.638679]],
    load: async () => {
      const module = await import("./mcintosh");
      return module.default;
    },
  },
  {
    id: "ok-099",
    countyId: "099",
    name: "Murray",
    bbox: [[-97.090084,34.332299],[-96.82723,34.637011]],
    load: async () => {
      const module = await import("./murray");
      return module.default;
    },
  },
  {
    id: "ok-101",
    countyId: "101",
    name: "Muskogee",
    bbox: [[-95.624411,35.372324],[-94.98871,35.822574]],
    load: async () => {
      const module = await import("./muskogee");
      return module.default;
    },
  },
  {
    id: "ok-103",
    countyId: "103",
    name: "Noble",
    bbox: [[-97.461125,36.159068],[-96.888213,36.600663]],
    load: async () => {
      const module = await import("./noble");
      return module.default;
    },
  },
  {
    id: "ok-105",
    countyId: "105",
    name: "Nowata",
    bbox: [[-95.835623,36.39059],[-95.352965,36.999395]],
    load: async () => {
      const module = await import("./nowata");
      return module.default;
    },
  },
  {
    id: "ok-107",
    countyId: "107",
    name: "Okfuskee",
    bbox: [[-96.6247,35.150838],[-95.737547,35.639095]],
    load: async () => {
      const module = await import("./okfuskee");
      return module.default;
    },
  },
  {
    id: "ok-109",
    countyId: "109",
    name: "Oklahoma",
    bbox: [[-97.706875,35.348324],[-97.034812,35.696752]],
    load: async () => {
      const module = await import("./oklahoma");
      return module.default;
    },
  },
  {
    id: "ok-111",
    countyId: "111",
    name: "Okmulgee",
    bbox: [[-96.221222,35.439814],[-95.544207,35.921073]],
    load: async () => {
      const module = await import("./okmulgee");
      return module.default;
    },
  },
  {
    id: "ok-113",
    countyId: "113",
    name: "Osage",
    bbox: [[-97.009785,36.131829],[-95.840842,36.999414]],
    load: async () => {
      const module = await import("./osage");
      return module.default;
    },
  },
  {
    id: "ok-115",
    countyId: "115",
    name: "Ottawa",
    bbox: [[-95.037735,36.625426],[-94.617758,36.999514]],
    load: async () => {
      const module = await import("./ottawa");
      return module.default;
    },
  },
  {
    id: "ok-117",
    countyId: "117",
    name: "Pawnee",
    bbox: [[-96.942838,36.031092],[-96.242823,36.503312]],
    load: async () => {
      const module = await import("./pawnee");
      return module.default;
    },
  },
  {
    id: "ok-119",
    countyId: "119",
    name: "Payne",
    bbox: [[-97.282809,35.825794],[-96.458604,36.307143]],
    load: async () => {
      const module = await import("./payne");
      return module.default;
    },
  },
  {
    id: "ok-121",
    countyId: "121",
    name: "Pittsburg",
    bbox: [[-96.092374,34.56074],[-95.323112,35.250401]],
    load: async () => {
      const module = await import("./pittsburg");
      return module.default;
    },
  },
  {
    id: "ok-123",
    countyId: "123",
    name: "Pontotoc",
    bbox: [[-96.967643,34.419569],[-96.284467,34.947037]],
    load: async () => {
      const module = await import("./pontotoc");
      return module.default;
    },
  },
  {
    id: "ok-125",
    countyId: "125",
    name: "Pottawatomie",
    bbox: [[-97.195079,34.856782],[-96.594167,35.55043]],
    load: async () => {
      const module = await import("./pottawatomie");
      return module.default;
    },
  },
  {
    id: "ok-127",
    countyId: "127",
    name: "Pushmataha",
    bbox: [[-95.806547,34.092297],[-94.990054,34.742391]],
    load: async () => {
      const module = await import("./pushmataha");
      return module.default;
    },
  },
  {
    id: "ok-129",
    countyId: "129",
    name: "Roger Mills",
    bbox: [[-100.000396,35.421954],[-99.11054,36.013668]],
    load: async () => {
      const module = await import("./roger-mills");
      return module.default;
    },
  },
  {
    id: "ok-131",
    countyId: "131",
    name: "Rogers",
    bbox: [[-95.861273,36.027915],[-95.112876,36.59763]],
    load: async () => {
      const module = await import("./rogers");
      return module.default;
    },
  },
  {
    id: "ok-133",
    countyId: "133",
    name: "Seminole",
    bbox: [[-96.777021,34.869586],[-96.087736,35.639087]],
    load: async () => {
      const module = await import("./seminole");
      return module.default;
    },
  },
  {
    id: "ok-135",
    countyId: "135",
    name: "Sequoyah",
    bbox: [[-95.097268,35.291214],[-94.431014,35.670131]],
    load: async () => {
      const module = await import("./sequoyah");
      return module.default;
    },
  },
  {
    id: "ok-137",
    countyId: "137",
    name: "Stephens",
    bbox: [[-98.261384,34.114262],[-97.439686,34.539559]],
    load: async () => {
      const module = await import("./stephens");
      return module.default;
    },
  },
  {
    id: "ok-139",
    countyId: "139",
    name: "Texas",
    bbox: [[-102.032087,36.499118],[-100.700589,36.99887]],
    load: async () => {
      const module = await import("./texas");
      return module.default;
    },
  },
  {
    id: "ok-141",
    countyId: "141",
    name: "Tillman",
    bbox: [[-99.23806,34.124238],[-98.504988,34.616256]],
    load: async () => {
      const module = await import("./tillman");
      return module.default;
    },
  },
  {
    id: "ok-143",
    countyId: "143",
    name: "Tulsa",
    bbox: [[-96.335528,35.856255],[-95.74037,36.364317]],
    load: async () => {
      const module = await import("./tulsa");
      return module.default;
    },
  },
  {
    id: "ok-145",
    countyId: "145",
    name: "Wagoner",
    bbox: [[-95.766133,35.549386],[-95.04697,36.239664]],
    load: async () => {
      const module = await import("./wagoner");
      return module.default;
    },
  },
  {
    id: "ok-147",
    countyId: "147",
    name: "Washington",
    bbox: [[-96.001038,36.315698],[-95.64755,36.999318]],
    load: async () => {
      const module = await import("./washington");
      return module.default;
    },
  },
  {
    id: "ok-149",
    countyId: "149",
    name: "Washita",
    bbox: [[-99.364569,34.854796],[-98.497772,35.450764]],
    load: async () => {
      const module = await import("./washita");
      return module.default;
    },
  },
  {
    id: "ok-151",
    countyId: "151",
    name: "Woods",
    bbox: [[-99.456203,36.3187],[-98.324641,37.000177]],
    load: async () => {
      const module = await import("./woods");
      return module.default;
    },
  },
  {
    id: "ok-153",
    countyId: "153",
    name: "Woodward",
    bbox: [[-99.590302,36.012726],[-98.924187,36.748322]],
    load: async () => {
      const module = await import("./woodward");
      return module.default;
    },
  },
];
