#!/usr/bin/env node
import "dotenv/config";

import { init as initAdmin, id as createId } from "@instantdb/admin";

type RoadmapSeed = {
  title: string;
  description?: string;
  status: "suggested" | "considering" | "inProcess" | "postponed";
  createdAt: number;
  statusChangedAt?: number | null;
  targetCompletionAt?: number | null;
  imageUrl?: string | null;
  comments?: Array<{
    authorId?: string;
    authorName?: string | null;
    body: string;
    createdAt?: number;
  }>;
  votes?: Array<{
    voterId: string;
    createdAt?: number;
  }>;
};

const resolveEnv = (key: string): string | undefined => {
  const raw = process.env[key];
  return typeof raw === "string" && raw.trim().length > 0 ? raw : undefined;
};

const APP_ID =
  resolveEnv("VITE_INSTANT_APP_ID") ??
  resolveEnv("NEXT_PUBLIC_INSTANT_APP_ID") ??
  resolveEnv("INSTANT_APP_ID");
const ADMIN_TOKEN =
  resolveEnv("INSTANT_APP_ADMIN_TOKEN") ??
  resolveEnv("INSTANT_ADMIN_TOKEN") ??
  resolveEnv("VITE_INSTANT_ADMIN_TOKEN");

if (!APP_ID || !ADMIN_TOKEN) {
  console.error("[roadmap:seed] Missing InstantDB credentials. Set VITE_INSTANT_APP_ID and INSTANT_APP_ADMIN_TOKEN.");
  process.exit(1);
}

const db = initAdmin({ appId: APP_ID, adminToken: ADMIN_TOKEN });

const seeds: RoadmapSeed[] = [
  {
    title: "Community Partner Portal",
    description:
      "Give food providers their own dashboard to update hours, share impact stories, and confirm inventory snapshots. Includes SMS nudges for quick updates.",
    status: "inProcess",
    createdAt: Date.now() - 1000 * 60 * 60 * 24 * 14,
    statusChangedAt: Date.now() - 1000 * 60 * 60 * 24 * 5,
    targetCompletionAt: Date.now() + 1000 * 60 * 60 * 24 * 30,
    imageUrl: null,
    comments: [
      {
        authorId: "seed-user-erica",
        authorName: "Erica (Food Bank)",
        body: "We would love to test this with a small pilot group—especially if the SMS nudges can be scheduled.",
      },
    ],
    votes: [
      { voterId: "seed-user-erica" },
      { voterId: "seed-user-andre" },
    ],
  },
  {
    title: "Mobile Map Offline Mode",
    description:
      "Cache the most recent Tulsa map data so residents can still find food resources even when their signal drops.",
    status: "considering",
    createdAt: Date.now() - 1000 * 60 * 60 * 24 * 9,
    imageUrl: null,
    votes: [{ voterId: "seed-user-andre" }],
  },
  {
    title: "Needs-based Recommendations",
    description:
      "Let residents share dietary needs and family size, then highlight organizations with matching services.",
    status: "suggested",
    createdAt: Date.now() - 1000 * 60 * 60 * 24 * 2,
    imageUrl: null,
  },
];

const ensureSeeded = async () => {
  const result = await db.query({
    roadmapItems: {
      $: { fields: ["id", "title"] },
    },
  });
  const data = result?.data ?? {};

  const existingByTitle = new Map<string, string>();
  const existingRoadmapItems =
    Array.isArray((data as any).roadmapItems) ? ((data as any).roadmapItems as any[]) : [];
  for (const item of existingRoadmapItems) {
    if (item?.title && item?.id) {
      existingByTitle.set(item.title as string, item.id as string);
    }
  }

  const txs: any[] = [];
  for (const seed of seeds) {
    const existingId = existingByTitle.get(seed.title);
    const itemId = existingId ?? createId();
    txs.push(
      db.tx.roadmapItems[itemId].update({
        title: seed.title,
        description: seed.description ?? null,
        status: seed.status,
        createdAt: seed.createdAt,
        statusChangedAt: seed.statusChangedAt ?? null,
        targetCompletionAt: seed.targetCompletionAt ?? null,
        imageUrl: seed.imageUrl ?? null,
      }),
    );

    if (!existingId) {
      const comments = seed.comments ?? [];
      for (const comment of comments) {
        const fallbackName = (comment.authorName ?? "guest").toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9\-]/g, "");
        const authorId = comment.authorId ?? `seed-user-${fallbackName || "guest"}`;
        txs.push(
          db.tx.roadmapItemComments[createId()].update({
            roadmapItemId: itemId,
            authorId,
            authorName: comment.authorName ?? null,
            body: comment.body,
            createdAt: comment.createdAt ?? seed.createdAt,
          }),
        );
      }

      const votes = seed.votes ?? [];
      for (const vote of votes) {
        txs.push(
          db.tx.roadmapItemVotes[createId()].update({
            roadmapItemId: itemId,
            voterId: vote.voterId,
            createdAt: vote.createdAt ?? seed.createdAt,
          }),
        );
      }
    }
  }

  if (txs.length === 0) {
    console.log("[roadmap:seed] Nothing to seed.");
    return;
  }

  await db.transact(txs);
  console.log(`[roadmap:seed] Seeded ${seeds.length} roadmap items.`);
};

ensureSeeded()
  .then(() => {
    console.log("[roadmap:seed] Done.");
    process.exit(0);
  })
  .catch((error) => {
    console.error("[roadmap:seed] Failed:", error);
    process.exit(1);
  });
