import { id } from "@instantdb/core";

import { organizationSeedData } from "../data/organizations";
import { getAllZipCodes } from "./zipBoundaries";
import { db } from "./db";
import { statsSeedData } from "../data/stats";

let seedPromise: Promise<void> | null = null;

export const ensureOrganizationsSeeded = async (): Promise<void> => {
  if (seedPromise) {
    return seedPromise;
  }

  seedPromise = (async () => {
    try {
      const { data } = await db.queryOnce({
        organizations: {
          $: {
            order: { name: "asc" },
          },
        },
      });

      const existingByName = new Map<string, any>();
      for (const org of data.organizations ?? []) {
        if (org?.name) existingByName.set(org.name, org);
      }

      const txs: any[] = [];
      for (const seed of organizationSeedData) {
        const existing = existingByName.get(seed.name);
        if (existing && existing.id) {
          // Update if any field differs or category missing
          const needsUpdate =
            existing.url !== seed.url ||
            existing.latitude !== seed.latitude ||
            existing.longitude !== seed.longitude ||
            existing.category !== seed.category;
          if (needsUpdate) {
            txs.push(
              db.tx.organizations[existing.id].update({
                name: seed.name,
                url: seed.url,
                latitude: seed.latitude,
                longitude: seed.longitude,
                category: seed.category,
              }),
            );
          }
        } else {
          // Create new
          txs.push(
            db.tx.organizations[id()].update({
              name: seed.name,
              url: seed.url,
              latitude: seed.latitude,
              longitude: seed.longitude,
              category: seed.category,
            }),
          );
        }
      }

      if (txs.length > 0) {
        await db.transact(txs);
      }
    } catch (error) {
      console.warn(
        "InstantDB seed encountered an error (likely offline); skipping seed",
        error,
      );
    }
  })();

  return seedPromise;
};

let seedAreasPromise: Promise<void> | null = null;

// Deterministic pseudo-random generator from a string key
const hashToUnit = (key: string): number => {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  // Xorshift
  h ^= h << 13;
  h ^= h >>> 17;
  h ^= h << 5;
  // Normalize to [0, 1)
  return ((h >>> 0) % 100000) / 100000;
};

export const ensureAreasSeeded = async (): Promise<void> => {
  if (seedAreasPromise) return seedAreasPromise;

  seedAreasPromise = (async () => {
    try {
      const { data } = await db.queryOnce({
        areas: {
          $: {
            order: { key: "asc" },
          },
        },
      });

      const existingByKey = new Map<string, any>();
      for (const row of data.areas ?? []) {
        if (row?.key) existingByKey.set(row.key, row);
      }

      // Build deterministic demo stats for all Tulsa ZIP codes
      const zips = getAllZipCodes();
      const txs: any[] = [];
      for (const zip of zips) {
        const r1 = hashToUnit(zip);
        const r2 = hashToUnit(zip + ":b");
        const r3 = hashToUnit(zip + ":c");

        // Population: 6k - 42k, rounded to nearest 100
        const populationRaw = 6000 + Math.round(r1 * 36000);
        const population = Math.round(populationRaw / 100) * 100;
        // Avg age: 28 - 44
        const avgAge = Math.round(28 + r2 * 16);
        // Married percent: 22% - 68%
        const marriedPercent = Math.round(22 + r3 * 46);

        const existing = existingByKey.get(zip);
        if (existing && existing.id) {
          const needsUpdate =
            existing.type !== "ZIP" ||
            existing.population !== population ||
            existing.avgAge !== avgAge ||
            existing.marriedPercent !== marriedPercent;
          if (needsUpdate) {
            txs.push(
              db.tx.areas[existing.id].update({
                key: zip,
                type: "ZIP",
                population,
                avgAge,
                marriedPercent,
              }),
            );
          }
        } else {
          txs.push(
            db.tx.areas[id()].update({
              key: zip,
              type: "ZIP",
              population,
              avgAge,
              marriedPercent,
            }),
          );
        }
      }

      if (txs.length > 0) {
        await db.transact(txs);
      }
    } catch (error) {
      console.warn(
        "InstantDB areas seed encountered an error (likely offline); skipping seed",
        error,
      );
    }
  })();

  return seedAreasPromise;
};

let seedStatsPromise: Promise<void> | null = null;

export const ensureStatsSeeded = async (): Promise<void> => {
  if (seedStatsPromise) return seedStatsPromise;

  seedStatsPromise = (async () => {
    try {
      const { data } = await db.queryOnce({
        stats: {
          $: { order: { name: "asc" } },
        },
      });

      const existingByComposite = new Map<string, any>();
      for (const row of data.stats ?? []) {
        const n = (row as any)?.name as string | undefined;
        const c = (row as any)?.category as string | undefined;
        if (n && c) existingByComposite.set(`${n}::${c}`.toLowerCase(), row);
      }

      // Handle legacy renames so we replace any previously seeded "Rate" stats in-place
      // rather than creating duplicates with new percent-based names.
      const legacyToNew = new Map<string, string>([
        ["ER Visits Rate", "ER Visits Percent"],
        ["Juvenile Arrest Rate", "Juvenile Arrest Percent"],
        ["Incarceration Rate", "Incarceration Percent"],
        ["Unemployment Rate", "Unemployment Percent"],
      ]);
      const newToLegacyNames = new Map<string, string[]>();
      for (const [oldName, newName] of legacyToNew) {
        const arr = newToLegacyNames.get(newName) ?? [];
        arr.push(oldName);
        newToLegacyNames.set(newName, arr);
      }

      const txs: any[] = [];
      for (const seed of statsSeedData) {
        const comp = `${seed.name}::${seed.category}`.toLowerCase();
        let existing = existingByComposite.get(comp);
        if (existing && existing.id) {
          const needsUpdate =
            (existing as any).name !== seed.name ||
            (existing as any).category !== seed.category ||
            (existing as any).goodIfUp !== (seed as any).goodIfUp;
          if (needsUpdate) {
            txs.push(
              db.tx.stats[existing.id].update({
                name: seed.name,
                category: seed.category,
                goodIfUp: (seed as any).goodIfUp,
              }),
            );
          }
        } else {
          // Try to find legacy entry by old name for this category to rename in-place
          const legacyCandidates = newToLegacyNames.get(seed.name) ?? [];
          let renamed = false;
          for (const oldName of legacyCandidates) {
            const legacyComp = `${oldName}::${seed.category}`.toLowerCase();
            const legacyExisting = existingByComposite.get(legacyComp);
            if (legacyExisting && legacyExisting.id) {
              txs.push(
                db.tx.stats[legacyExisting.id].update({
                  name: seed.name,
                  category: seed.category,
                  goodIfUp: (seed as any).goodIfUp,
                }),
              );
              renamed = true;
              break;
            }
          }
          if (!renamed) {
            txs.push(
              db.tx.stats[id()].update({
                name: seed.name,
                category: seed.category,
                goodIfUp: (seed as any).goodIfUp,
              }),
            );
          }
        }
      }

      if (txs.length > 0) {
        await db.transact(txs);
      }
    } catch (error) {
      console.warn(
        "InstantDB stats seed encountered an error (likely offline); skipping seed",
        error,
      );
    }
  })();

  return seedStatsPromise;
};

let seedStatDataPromise: Promise<void> | null = null;

export const ensureStatDataSeeded = async (): Promise<void> => {
  if (seedStatDataPromise) return seedStatDataPromise;

  seedStatDataPromise = (async () => {
    try {
      // Ensure stats exist before seeding statData
      await ensureStatsSeeded();

      // Fetch stats and existing statData
      const { data: statsResp } = await db.queryOnce({
        stats: { $: { order: { name: "asc" as const } } },
      });

      const stats = (statsResp?.stats ?? []) as any[];

      const { data: statDataResp } = await db.queryOnce({
        statData: { $: { order: { name: "asc" as const } } },
      });

      const existingByComposite = new Map<string, any>();
      for (const row of statDataResp?.statData ?? []) {
        const sid = (row as any)?.statId as string | undefined;
        const nm = (row as any)?.name as string | undefined;
        const ar = (row as any)?.area as string | undefined;
        const bt = (row as any)?.boundaryType as string | undefined;
        const dt = (row as any)?.date as string | undefined;
        if (sid && nm && ar && bt && dt) {
          existingByComposite.set(`${sid}::${nm}::${ar}::${bt}::${dt}`.toLowerCase(), row);
        }
      }

      const zips = getAllZipCodes();

      const typeForStatName = (name: string): string => {
        const n = name.toLowerCase();
        if (n.includes("percent")) return "percent";
        if (n.includes("unemployment rate")) return "percent";
        if (n.includes("rate")) return "rate";
        if (n.includes("life expectancy") || n.includes("average age")) return "years";
        if (n.includes("income")) return "currency";
        return "count";
      };

      const hashToUnit = (key: string): number => {
        let h = 2166136261 >>> 0;
        for (let i = 0; i < key.length; i++) {
          h ^= key.charCodeAt(i);
          h = Math.imul(h, 16777619);
        }
        h ^= h << 13;
        h ^= h >>> 17;
        h ^= h << 5;
        return ((h >>> 0) % 100000) / 100000;
      };

      const valueFor = (type: string, statName: string, zip: string, date: string): number => {
        const u = hashToUnit(`${statName}::${zip}::${date}`);
        switch (type) {
          case "percent": {
            // 5% - 85%, 1 decimal
            const v = 5 + u * 80;
            return Math.round(v * 10) / 10;
          }
          case "rate": {
            // Generic rate: 0 - 200 per 1,000
            const v = u * 200;
            return Math.round(v * 10) / 10;
          }
          case "years": {
            // Life expectancy: 68 - 84 years
            const v = 68 + u * 16;
            return Math.round(v * 10) / 10;
          }
          case "currency": {
            // Income: $35k - $115k; round to nearest $100
            const raw = 35000 + Math.round(u * 80000);
            return Math.round(raw / 100) * 100;
          }
          case "count":
          default: {
            // Count: 100 - 10,000
            const raw = 100 + Math.round(u * 9900);
            return raw;
          }
        }
      };

      const txs: any[] = [];
      // Seed multiple years so we can render simple time series in UI
      const YEARS = ["2023", "2024", "2025"] as const;
      for (const s of stats) {
        const sid = (s as any)?.id as string | undefined;
        const name = (s as any)?.name as string | undefined;
        if (!sid || !name) continue;

        const entryName = "root"; // per spec for root stat data
        const area = "Tulsa";
        const boundaryType = "ZIP";
        const type = typeForStatName(name);

        for (const date of YEARS) {
          const dataObj: Record<string, number> = {};
          for (const zip of zips) {
            dataObj[zip] = valueFor(type, name, zip, date);
          }

          const comp = `${sid}::${entryName}::${area}::${boundaryType}::${date}`.toLowerCase();
          const existing = existingByComposite.get(comp);

          if (existing && existing.id) {
            // Update if any identifying fields or data changed
            const needsUpdate =
              (existing as any).type !== type ||
              JSON.stringify((existing as any).data ?? {}) !== JSON.stringify(dataObj);
            if (needsUpdate) {
              txs.push(
                db.tx.statData[existing.id].update({
                  statId: sid,
                  name: entryName,
                  area,
                  boundaryType,
                  date,
                  type,
                  data: dataObj,
                }),
              );
            }
          } else {
            txs.push(
              db.tx.statData[id()].update({
                statId: sid,
                name: entryName,
                area,
                boundaryType,
                date,
                type,
                data: dataObj,
              }),
            );
          }
        }
      }

      // Additionally seed demographic breakdowns for the Population stat using percent segments
      // Only for 2025, as the UI consumes the latest snapshot
      const populationStat = (stats as any[]).find((row) => (row as any)?.name === "Population");
      if (populationStat && (populationStat as any).id) {
        const popStatId = (populationStat as any).id as string;
        const date = "2025";
        const area = "Tulsa";
        const boundaryType = "ZIP";

        // Helper to produce integer percent buckets that sum to 100
        const percentBuckets = (seedKey: string, count: number): number[] => {
          const weights: { w: number; idx: number }[] = [];
          let sum = 0;
          for (let i = 0; i < count; i++) {
            const u = hashToUnit(`${seedKey}::seg:${i}`);
            const w = 0.2 + u; // ensure non-zero
            weights.push({ w, idx: i });
            sum += w;
          }
          const exacts = weights.map((x) => (x.w / sum) * 100);
          const floors = exacts.map((v) => Math.floor(v));
          let remainder = 100 - floors.reduce((a, b) => a + b, 0);
          const frac = exacts.map((v, i) => ({ f: v - floors[i], idx: i })).sort((a, b) => b.f - a.f);
          const result = floors.slice();
          for (let i = 0; i < remainder; i++) result[frac[i % frac.length].idx] += 1;
          return result;
        };

        type SegmentDef = { key: string; label: string };
        const groups: { group: string; segments: SegmentDef[] }[] = [
          {
            group: "ethnicity",
            segments: [
              { key: "white", label: "White" },
              { key: "black", label: "Black" },
              { key: "hispanic", label: "Hispanic" },
              { key: "asian", label: "Asian" },
              { key: "other", label: "Other" },
            ],
          },
          {
            group: "income",
            segments: [
              { key: "low", label: "Low" },
              { key: "middle", label: "Middle" },
              { key: "high", label: "High" },
            ],
          },
          {
            group: "education",
            segments: [
              { key: "hs_or_less", label: "HS or Less" },
              { key: "some_college", label: "Some College" },
              { key: "bachelor_plus", label: "Bachelor+" },
            ],
          },
        ];

        for (const { group, segments } of groups) {
          // Build a percent map per ZIP that sums to 100 across segments
          const perZipBuckets: Record<string, number[]> = {};
          for (const zip of zips) {
            perZipBuckets[zip] = percentBuckets(`Population::${group}::${zip}::${date}`, segments.length);
          }

          // Emit one statData row per segment (name = `${group}:${segmentKey}`)
          for (let si = 0; si < segments.length; si++) {
            const seg = segments[si];
            const segData: Record<string, number> = {};
            for (const zip of zips) {
              segData[zip] = perZipBuckets[zip][si];
            }

            const entryName = `${group}:${seg.key}`;
            const comp = `${popStatId}::${entryName}::${area}::${boundaryType}::${date}`.toLowerCase();
            const existing = existingByComposite.get(comp);
            if (existing && existing.id) {
              const needsUpdate =
                (existing as any).type !== "percent" ||
                JSON.stringify((existing as any).data ?? {}) !== JSON.stringify(segData);
              if (needsUpdate) {
                txs.push(
                  db.tx.statData[existing.id].update({
                    statId: popStatId,
                    name: entryName,
                    area,
                    boundaryType,
                    date,
                    type: "percent",
                    data: segData,
                  }),
                );
              }
            } else {
              txs.push(
                db.tx.statData[id()].update({
                  statId: popStatId,
                  name: entryName,
                  area,
                  boundaryType,
                  date,
                  type: "percent",
                  data: segData,
                }),
              );
            }
          }
        }
      }

      if (txs.length > 0) {
        await db.transact(txs);
      }
    } catch (error) {
      console.warn(
        "InstantDB statData seed encountered an error (likely offline); skipping seed",
        error,
      );
    }
  })();

  return seedStatDataPromise;
};
