#!/usr/bin/env node
import "dotenv/config";

process.env.NODE_ENV ??= "development";
process.env.DEV ??= "true";
process.env.VITE_ENABLE_SYNTHETIC_SEED ??= "true";

import {
  ensureAreasSeeded,
  ensureOrganizationsSeeded,
  ensureStatDataSeeded,
  ensureStatsSeeded,
} from "../src/lib/seed";

const run = async () => {
  try {
    console.log("[seed] Starting synthetic seed for organizations/areas/stats…");
    await ensureOrganizationsSeeded();
    await ensureAreasSeeded();
    await ensureStatsSeeded();
    await ensureStatDataSeeded();
    console.log("[seed] Seed completed successfully.");
    process.exit(0);
  } catch (error) {
    console.error("[seed] Seed failed:", error);
    process.exit(1);
  }
};

run();
