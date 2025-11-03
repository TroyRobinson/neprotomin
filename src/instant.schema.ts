// Docs: https://www.instantdb.com/docs/modeling-data

import { i } from '@instantdb/react';

const _schema = i.schema({
  entities: {
    $files: i.entity({
      path: i.string().unique().indexed(),
      url: i.string(),
    }),
    // (users/auth removed)
    organizations: i.entity({
      name: i.string().indexed(),
      ownerEmail: i.string().indexed().optional(),
      website: i.string().optional(),
      latitude: i.number(),
      longitude: i.number(),
      category: i.string().indexed(),
      placeId: i.string().unique().indexed().optional(),
      source: i.string().indexed().optional(),
      address: i.string().optional(),
      city: i.string().indexed().optional(),
      state: i.string().indexed().optional(),
      postalCode: i.string().indexed().optional(),
      phone: i.string().optional(),
      hours: i.json<{
        periods?: Array<{
          day: number;
          openTime?: string | null;
          closeTime?: string | null;
          isOvernight?: boolean;
          status?: string | null;
        }>;
        weekdayText?: string[];
        status?: string;
        isUnverified?: boolean;
      }>().optional(),
      googleCategory: i.string().indexed().optional(),
      keywordFound: i.string().optional(),
      status: i.string().indexed().optional(),
      lastSyncedAt: i.number().indexed().optional(),
      raw: i.json<Record<string, unknown>>().optional(),
      moderationStatus: i.string().indexed().optional(),
      moderationChangedAt: i.number().indexed().optional(),
      submittedAt: i.number().indexed().optional(),
      queueSortKey: i.number().indexed().optional(),
      issueCount: i.number().indexed().optional(),
    }),
    comments: i.entity({
      orgId: i.string().indexed(),
      orgName: i.string(),
      text: i.string(),
      source: i.string().indexed(),
      reporterId: i.string().indexed().optional(),
      reporterEmail: i.string().optional(),
      reporterKey: i.string().indexed().optional(),
      reporterIsAdmin: i.boolean().indexed().optional(),
      ipHash: i.string().indexed().optional(),
      createdAt: i.number().indexed(),
      context: i
        .json<{
          userAgent?: string | null;
          referer?: string | null;
          pageUrl?: string | null;
          locale?: string | null;
        }>()
        .optional(),
    }),
    areas: i.entity({
      code: i.string().unique().indexed(), // e.g., ZIP / county FIPS
      kind: i.string().indexed(), // matches AreaKind
      name: i.string().indexed(),
      parentCode: i.string().indexed().optional(),
      centroid: i.json<[number, number]>().optional(),
      bounds: i.json<[[number, number], [number, number]]>().optional(),
      isActive: i.boolean().optional(),
      updatedAt: i.number().indexed().optional(),
    }),
    stats: i.entity({
      name: i.string().indexed(),
      category: i.string().indexed(),
      neId: i.string().unique().indexed().optional(),
      source: i.string().indexed().optional(), // e.g., "NE" | "Census"
      goodIfUp: i.boolean().optional(),
      // Used to control which stats appear as selectable chips in the map UI
      // Indexed because we filter by this field in queries
      featured: i.boolean().indexed().optional(),
      active: i.boolean().indexed().optional(),
      createdOn: i.number().indexed().optional(),
      lastUpdated: i.number().indexed().optional(),
    }),
    statData: i.entity({
      statId: i.string().indexed(),
      name: i.string().indexed(), // e.g., "root" or sub-stat name
      statTitle: i.string().optional(), // Human-readable title of the associated stat
      parentArea: i.string().indexed(), // e.g., Tulsa County bucket
      boundaryType: i.string().indexed(), // e.g., ZIP
      date: i.string().indexed(), // e.g., year like "2025"
      type: i.string().indexed(), // e.g., count | percent | rate | years | currency
      data: i.json<Record<string, number>>(), // map of area key (e.g., ZIP) -> value
      source: i.string().indexed().optional(),
      statNameHint: i.string().optional(), // convenience alias; prefer stats.name
      censusVariable: i.string().indexed().optional(), // e.g., B22003_001E
      censusSurvey: i.string().indexed().optional(), // e.g., acs5
      censusUniverse: i.string().optional(),
      censusTableUrl: i.string().optional(),
      marginOfError: i.json<Record<string, number>>().optional(),
      createdOn: i.number().indexed().optional(),
      lastUpdated: i.number().indexed().optional(),
    }),
    // Persisted per-user/per-guest UI state
    uiState: i.entity({
      owner: i.string().indexed(), // auth.id (works for guests too)
      selection: i.json<{
        version?: number;
        boundaryMode?: string | null;
        areaSelections?: Record<
          string,
          { selected?: string[]; pinned?: string[]; transient?: string[] }
        >;
        // Legacy fields we keep around so older clients can still parse the payload
        zips?: string[];
        pinned?: string[];
        counties?: { selected?: string[]; pinned?: string[] };
      }>(),
      updatedAt: i.number().indexed(),
    }),
  },
  links: {},
  rooms: {},
});

// This helps Typescript display nicer intellisense
type _AppSchema = typeof _schema;
interface AppSchema extends _AppSchema {}
const schema: AppSchema = _schema;

export type { AppSchema };
export default schema;
