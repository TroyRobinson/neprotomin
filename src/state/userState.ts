import { id } from "@instantdb/core";
import { db } from "../lib/db";

export interface PersistedUserState {
  selectedZips: string[];
  pinnedZips: string[];
  mapCenter?: { lng: number; lat: number } | null;
  mapZoom?: number | null;
}

const DEFAULT_STATE: PersistedUserState = {
  selectedZips: [],
  pinnedZips: [],
  mapCenter: null,
  mapZoom: null,
};

export async function loadUserState(): Promise<PersistedUserState> {
  try {
    const user = await db.getAuth();
    const userId = (user as any)?.id as string | undefined;
    if (!userId) return DEFAULT_STATE;
    const { data } = await db.queryOnce({
      userState: {
        $: { where: { userId } },
      },
    });
    const rec = (data as any)?.userState?.[0];
    if (!rec) return DEFAULT_STATE;
    const selectedZips = Array.isArray(rec.selectedZips) ? rec.selectedZips.filter((z: any) => typeof z === "string") : [];
    const pinnedZips = Array.isArray(rec.pinnedZips) ? rec.pinnedZips.filter((z: any) => typeof z === "string") : [];
    const mapCenter = (rec.mapCenter && typeof rec.mapCenter.lng === "number" && typeof rec.mapCenter.lat === "number")
      ? { lng: rec.mapCenter.lng, lat: rec.mapCenter.lat } : null;
    const mapZoom = typeof rec.mapZoom === "number" ? rec.mapZoom : null;
    return { selectedZips, pinnedZips, mapCenter, mapZoom };
  } catch {
    return DEFAULT_STATE;
  }
}

export async function saveUserState(next: PersistedUserState): Promise<void> {
  try {
    const user = await db.getAuth();
    const userId = (user as any)?.id as string | undefined;
    if (!userId) return;

    const { data } = await db.queryOnce({
      userState: {
        $: { where: { userId } },
      },
    });
    const existing = (data as any)?.userState?.[0];
    if (existing && existing.id) {
      await db.transact(
        db.tx.userState[existing.id].update({
          userId,
          selectedZips: next.selectedZips,
          pinnedZips: next.pinnedZips,
          mapCenter: next.mapCenter ?? null,
          mapZoom: typeof next.mapZoom === "number" ? next.mapZoom : null,
        }),
      );
    } else {
      await db.transact(
        db.tx.userState[id()].update({
          userId,
          selectedZips: next.selectedZips,
          pinnedZips: next.pinnedZips,
          mapCenter: next.mapCenter ?? null,
          mapZoom: typeof next.mapZoom === "number" ? next.mapZoom : null,
        }),
      );
    }
  } catch {
    // ignore persistence errors (e.g., offline)
  }
}



