#!/usr/bin/env tsx
import { spawn } from "node:child_process";
import path from "node:path";

import minimist from "minimist";

import { getAllCountyIds, getCountyBounds, getCountyName } from "../../src/lib/countyBoundaries";

type Bounds = {
  minLat: number;
  minLng: number;
  maxLat: number;
  maxLng: number;
};

const RUN_DIR = process.cwd();

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const runCommand = async (
  command: string,
  args: string[],
  { retries = 0, delayMs = 2000 }: { retries?: number; delayMs?: number } = {},
) => {
  let attempt = 0;
  for (;;) {
    try {
      await new Promise<void>((resolve, reject) => {
        const child = spawn(command, args, {
          cwd: RUN_DIR,
          stdio: "inherit",
          env: process.env,
        });
        child.on("error", reject);
        child.on("exit", (code) => {
          if (code === 0) resolve();
          else reject(new Error(`${command} ${args.join(" ")} exited with ${code}`));
        });
      });
      return;
    } catch (error) {
      if (attempt >= retries) throw error;
      attempt += 1;
      console.warn(
        `[run-counties] Command failed (attempt ${attempt}/${retries}), retrying in ${delayMs}ms…`,
        error instanceof Error ? error.message : error,
      );
      await wait(delayMs);
    }
  }
};

const pad = (value: number, decimals = 4) => value.toFixed(decimals);

const makeBoundsArgs = (bounds: Bounds): string => {
  return `${pad(bounds.minLat)},${pad(bounds.minLng)},${pad(bounds.maxLat)},${pad(bounds.maxLng)}`;
};

const estimateRadiusMeters = (bounds: Bounds): number => {
  const latDiff = bounds.maxLat - bounds.minLat;
  const lngDiff = bounds.maxLng - bounds.minLng;
  const approxLatMeters = latDiff * 111_000;
  const approxLngMeters = Math.abs(Math.cos(((bounds.minLat + bounds.maxLat) / 2) * (Math.PI / 180))) * lngDiff * 111_000;
  const span = Math.max(approxLatMeters, approxLngMeters);
  return Math.min(Math.max(Math.round(span * 0.75), 8000), 50000);
};

const estimateStepDegrees = (bounds: Bounds): number => {
  const latDiff = bounds.maxLat - bounds.minLat;
  const lngDiff = bounds.maxLng - bounds.minLng;
  const base = Math.max(latDiff, lngDiff) / 4;
  return Math.max(0.15, Math.min(0.6, Number(base.toFixed(3))));
};

const main = async () => {
  const args = minimist(process.argv.slice(2), {
    string: ["start", "only", "skip"],
    alias: { s: "start", o: "only" },
  });

  const allCounties = getAllCountyIds()
    .map((id) => {
      const rawBounds = getCountyBounds(id);
      if (!rawBounds) return null;
      const [[minLng, minLat], [maxLng, maxLat]] = rawBounds;
      return {
        id,
        name: getCountyName(id) ?? id,
        bounds: { minLat, minLng, maxLat, maxLng },
      };
    })
    .filter(Boolean) as { id: string; name: string; bounds: Bounds }[];

  let counties = allCounties;

  if (typeof args.only === "string" && args.only.trim().length > 0) {
    const onlySet = new Set(args.only.split(",").map((item) => item.trim()).filter(Boolean));
    counties = counties.filter((county) => onlySet.has(county.id) || onlySet.has(county.name));
  } else if (typeof args.start === "string" && args.start.trim().length > 0) {
    const startValue = args.start.trim();
    const startIndex = counties.findIndex((county) => county.id === startValue || county.name === startValue);
    if (startIndex >= 0) {
      counties = counties.slice(startIndex);
    }
  }

  if (typeof args.skip === "string" && args.skip.trim().length > 0) {
    const skipSet = new Set(args.skip.split(",").map((item) => item.trim()).filter(Boolean));
    counties = counties.filter((county) => !skipSet.has(county.id) && !skipSet.has(county.name));
  }

  console.log(`[run-counties] Preparing to process ${counties.length} counties…`);

  for (const county of counties) {
    const { id, name, bounds } = county;
    const boundsArg = makeBoundsArgs(bounds);
    const radius = estimateRadiusMeters(bounds);
    const step = estimateStepDegrees(bounds);
    const outputFile = path.join("tmp", `food_places_${id}.json`);

    console.log(`\n[run-counties] ===== ${name} (${id}) =====`);
    console.log(
      `[run-counties] bounds=${boundsArg} step=${step.toFixed(3)} radius=${radius}m -> ${outputFile}`,
    );

    try {
      await runCommand("npx", [
        "tsx",
        "scripts/google-places/collect-food-places.ts",
        `--bounds=${boundsArg}`,
        `--step=${step}`,
        `--radius=${radius}`,
        "--maxPages=3",
        `--out=${outputFile}`,
        "--cache=refresh",
      ], { retries: 2, delayMs: 5000 });

      await runCommand("npx", [
        "tsx",
        "scripts/google-places/preview-food-orgs.ts",
        `--file=${outputFile}`,
      ]);

      await runCommand("npx", [
        "tsx",
        "scripts/google-places/load-food-orgs.ts",
        `--file=${outputFile}`,
      ]);
    } catch (error) {
      console.error(`[run-counties] ${name} (${id}) failed:`, error);
      continue;
    }
  }

  console.log("\n[run-counties] All counties processed.");
};

main().catch((error) => {
  console.error("[run-counties] fatal error:", error);
  process.exitCode = 1;
});
