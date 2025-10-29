import "dotenv/config";
import minimist from "minimist";
import { init as initAdmin } from "@instantdb/admin";

type OrganizationRow = {
  id: string;
  name?: string | null;
  address?: string | null;
  postalCode?: string | null;
};

const args = minimist(process.argv.slice(2), {
  boolean: ["apply", "quiet"],
  default: { apply: false, quiet: false, chunk: 100, limit: 0 },
});

const APPLY = Boolean(args.apply);
const QUIET = Boolean(args.quiet);
const CHUNK_SIZE = Math.max(Number(args.chunk) || 100, 1);
const LIMIT = Math.max(Number(args.limit) || 0, 0);

const appId = process.env.VITE_INSTANT_APP_ID;
const adminToken = process.env.INSTANT_APP_ADMIN_TOKEN;

if (!appId || !adminToken) {
  console.error("Missing VITE_INSTANT_APP_ID or INSTANT_APP_ADMIN_TOKEN in environment.");
  process.exit(1);
}

const db = initAdmin({ appId, adminToken });

const ZIP_REGEX = /\b(\d{5})(?:-\d{4})?\b/;

const extractZip = (address?: string | null): string | null => {
  if (!address) return null;
  const match = address.match(ZIP_REGEX);
  if (!match) return null;
  const [zip5] = match;
  return zip5?.slice(0, 5) ?? null;
};

const log = (...values: unknown[]) => {
  if (QUIET) return;
  console.log(...values);
};

async function main(): Promise<void> {
  let offset = 0;
  let processed = 0;
  let alreadySet = 0;
  let parsed = 0;
  let updated = 0;
  let missing = 0;
  const failures: OrganizationRow[] = [];
  const staged: Array<{ id: string; zip: string }> = [];

  log("Fetching organizations…");

  while (true) {
    const pageLimit = LIMIT > 0 ? Math.min(500, LIMIT - processed) : 500;
    if (pageLimit <= 0) break;

    const resp = await db.query({
      organizations: {
        $: {
          limit: pageLimit,
          offset,
          order: { name: "asc" },
        },
      },
    });

    const rows: OrganizationRow[] =
      (resp as any)?.data?.organizations ??
      (resp as any)?.organizations ??
      [];
    if (rows.length === 0) break;

    offset += rows.length;
    processed += rows.length;

    for (const row of rows) {
      const currentZip = typeof row.postalCode === "string" ? row.postalCode.trim() : null;
      if (currentZip && currentZip.length >= 5) {
        alreadySet += 1;
        continue;
      }

      const extracted = extractZip(row.address);
      if (!extracted) {
        missing += 1;
        failures.push(row);
        continue;
      }

      parsed += 1;
      staged.push({ id: row.id, zip: extracted });

      if (!APPLY) continue;
      if (staged.length >= CHUNK_SIZE) {
        await flush(staged);
        updated += staged.length;
        staged.length = 0;
      }
    }

    if (LIMIT > 0 && processed >= LIMIT) break;

    // Respect API defaults by paging until the backend stops returning rows.
    if (rows.length < 500 && LIMIT === 0) break;
  }

  if (APPLY && staged.length > 0) {
    await flush(staged);
    updated += staged.length;
    staged.length = 0;
  }

  log("—");
  log(`Processed organizations: ${processed}`);
  log(`Already had postalCode: ${alreadySet}`);
  log(`Parsed ZIP from address: ${parsed}`);
  log(`Updated postalCode records: ${updated}`);
  log(`Still missing postalCode: ${missing}`);
  log(`Mode: ${APPLY ? "APPLY (updates written)" : "DRY RUN"}`);

  if (failures.length > 0) {
    log("Sample rows without resolvable ZIP:");
    failures.slice(0, 10).forEach((row) => {
      log(`  • ${row.name ?? row.id}: address="${row.address ?? ""}"`);
    });
    if (failures.length > 10) {
      log(`  …and ${failures.length - 10} more`);
    }
  }
}

async function flush(staged: Array<{ id: string; zip: string }>): Promise<void> {
  if (staged.length === 0) return;
  const txs = staged.map(({ id, zip }) => db.tx.organizations[id].update({ postalCode: zip }));
  await db.transact(txs);
}

main()
  .then(() => {
    if (!QUIET) console.log("Done.");
    process.exit(0);
  })
  .catch((error) => {
    console.error("Postal code update failed:", error);
    process.exit(1);
  });
