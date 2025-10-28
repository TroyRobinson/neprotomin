#!/usr/bin/env node
/**
 * Builds Oklahoma ZCTA geometry chunks and manifest files.
 *
 * This script expects mapshaper to be installed (npm i -D mapshaper).
 *
 * Example usage:
 *   node scripts/geo/build-oklahoma-zctas.js \
 *     --input data/raw/oklahoma_zctas.geojson \
 *     --outDir src/data/zcta/oklahoma \
 *     --simplify "10%" \
 *     --zip-field ZCTA5CE20 \
 *     --county-field COUNTYFP \
 *     --county-name-field NAME
 */

import fs from "fs/promises";
import path from "path";
import os from "os";
import { spawn } from "child_process";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DEFAULT_SIMPLIFY = "10%";
const DEFAULT_OUT_DIR = "src/data/zcta/oklahoma";
const DEFAULT_STATE_CODE = "ok";
const DEFAULT_ZIP_FIELD = "ZCTA5CE20";
const DEFAULT_COUNTY_FIELD = "COUNTYFP";
const DEFAULT_COUNTY_NAME_FIELD = "NAME";

const TYPES_TEMPLATE = `import type { FeatureCollection } from "geojson";`;

const banner = `/**
 * AUTO-GENERATED FILE.
 * Generated via scripts/geo/build-oklahoma-zctas.js
 * Do not edit by hand.
 */`;

const parseArgs = () => {
  const args = process.argv.slice(2);
  const options = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!arg.startsWith("--")) continue;
    const key = arg.replace(/^--/, "");
    const next = args[i + 1];
    if (!next || next.startsWith("--")) {
      options[key] = true;
      continue;
    }
    options[key] = next;
    i += 1;
  }

  return {
    input: options.input,
    outDir: options["outDir"] || DEFAULT_OUT_DIR,
    simplify: options.simplify || DEFAULT_SIMPLIFY,
    state: options.state || DEFAULT_STATE_CODE,
    zipField: options["zip-field"] || DEFAULT_ZIP_FIELD,
    countyField: options["county-field"] || DEFAULT_COUNTY_FIELD,
    countyNameField: options["county-name-field"] || DEFAULT_COUNTY_NAME_FIELD,
  };
};

const slugify = (value) =>
  String(value || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

const runMapshaper = (inputPath, outputPath, { simplify, zipField, countyField, countyNameField }) => {
  return new Promise((resolve, reject) => {
    const args = [
      inputPath,
      "-simplify",
      simplify,
      "keep-shapes",
      "-rename-fields",
      `zip=${zipField},county=${countyField},name=${countyNameField}`,
      "-o",
      `format=geojson`,
      outputPath,
    ];

    const child = spawn("mapshaper", args, { stdio: "inherit" });
    child.on("error", (err) => reject(err));
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`mapshaper exited with code ${code}`));
      }
    });
  });
};

const computeBounds = (feature) => {
  if (!feature.geometry) return null;
  let minLng = Infinity;
  let maxLng = -Infinity;
  let minLat = Infinity;
  let maxLat = -Infinity;

  const extend = (coords) => {
    if (!Array.isArray(coords)) return;
    if (typeof coords[0] === "number" && typeof coords[1] === "number") {
      const [lng, lat] = coords;
      if (lng < minLng) minLng = lng;
      if (lng > maxLng) maxLng = lng;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
      return;
    }
    for (const coord of coords) extend(coord);
  };

  extend(feature.geometry.coordinates);
  if (!Number.isFinite(minLng) || !Number.isFinite(minLat) || !Number.isFinite(maxLng) || !Number.isFinite(maxLat)) {
    return null;
  }
  return [
    [minLng, minLat],
    [maxLng, maxLat],
  ];
};

const writeChunkFile = async (outDir, countySlug, features) => {
  // Convert countySlug to valid JavaScript identifier by removing hyphens and capitalizing
  const validIdentifier = countySlug
    .split('-')
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');
  const exportName = `oklahoma${validIdentifier}ZctaBoundaries`;
  const filePath = path.join(outDir, `${countySlug}.ts`);
  const content = `${banner}
${TYPES_TEMPLATE}

export const ${exportName}: FeatureCollection<GeoJSON.MultiPolygon | GeoJSON.Polygon, { zip: string; county?: string; name?: string; [key: string]: unknown }> = ${JSON.stringify(
    {
      type: "FeatureCollection",
      features,
    },
    null,
    2,
  )} as const;

export default ${exportName};
`;
  await fs.writeFile(filePath, content, "utf8");
  return { filePath, exportName };
};

const writeManifest = async (outDir, state, entries) => {
  const manifestPath = path.join(outDir, "manifest.ts");
  const manifestContent = `${banner}
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
${entries
  .map(
    (entry) => `  {
    id: "${state}-${entry.countyId}",
    countyId: "${entry.countyId}",
    name: ${JSON.stringify(entry.name)},
    bbox: ${JSON.stringify(entry.bbox)},
    load: async () => {
      const module = await import("./${entry.slug}");
      return module.default;
    },
  },`,
  )
  .join("\n")}
];
`;
  await fs.writeFile(manifestPath, manifestContent, "utf8");
};

const main = async () => {
  const options = parseArgs();
  if (!options.input) {
    console.error("Missing required --input <path-to-zcta-geojson>");
    process.exit(1);
  }

  const inputPath = path.resolve(process.cwd(), options.input);
  const outDir = path.resolve(process.cwd(), options.outDir);

  await fs.mkdir(outDir, { recursive: true });

  const tmpGeojsonPath = path.join(os.tmpdir(), `oklahoma-zctas-${Date.now()}.geojson`);
  try {
    console.log(`→ Running mapshaper simplification (${options.simplify})`);
    await runMapshaper(inputPath, tmpGeojsonPath, options);

    const raw = JSON.parse(await fs.readFile(tmpGeojsonPath, "utf8"));
    if (!raw || !Array.isArray(raw.features)) {
      throw new Error("Simplified GeoJSON missing features array");
    }

    // Group features by county
    const grouped = new Map();
    for (const feature of raw.features) {
      const county = feature.properties?.county;
      if (!county) continue;
      if (!grouped.has(county)) {
        grouped.set(county, []);
      }
      grouped.get(county).push(feature);
    }

    const manifestEntries = [];
    const manifestSlugSet = new Set();

    for (const [countyIdRaw, features] of grouped.entries()) {
      const countyId = String(countyIdRaw);
      const countyName = features[0]?.properties?.name ?? countyId;
      const slug = slugify(countyName || countyId);
      if (!slug) {
        console.warn(`Skipping county ${countyId} due to empty slug`);
        continue;
      }
      manifestSlugSet.add(slug);
      console.log(`→ Writing chunk for ${countyName} (${countyId}) with ${features.length} features`);
      await writeChunkFile(outDir, slug, features);

      // Compute bbox for manifest
      let minLng = Infinity;
      let minLat = Infinity;
      let maxLng = -Infinity;
      let maxLat = -Infinity;
      for (const feature of features) {
        const bounds = computeBounds(feature);
        if (!bounds) continue;
        minLng = Math.min(minLng, bounds[0][0]);
        minLat = Math.min(minLat, bounds[0][1]);
        maxLng = Math.max(maxLng, bounds[1][0]);
        maxLat = Math.max(maxLat, bounds[1][1]);
      }
      const bbox =
        Number.isFinite(minLng) && Number.isFinite(minLat) && Number.isFinite(maxLng) && Number.isFinite(maxLat)
          ? [
              [minLng, minLat],
              [maxLng, maxLat],
            ]
          : [
              [-180, -90],
              [180, 90],
            ];

      manifestEntries.push({
        countyId: countyId.toLowerCase(),
        name: countyName,
        bbox,
        slug,
      });
    }

    manifestEntries.sort((a, b) => a.name.localeCompare(b.name));
    await writeManifest(outDir, options.state, manifestEntries);

    console.log(`✓ Generated ${manifestEntries.length} county chunks in ${options.outDir}`);
  } finally {
    try {
      await fs.unlink(tmpGeojsonPath);
    } catch {
      // ignore
    }
  }
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
