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
      ein: i.string().indexed().optional(),
      importBatchId: i.string().indexed().optional(),
      createdAt: i.number().indexed().optional(),
      updatedAt: i.number().indexed().optional(),
    }),
    orgImports: i.entity({
      label: i.string(),
      source: i.string().indexed().optional(),
      filters: i.json<Record<string, unknown>>().optional(),
      status: i.string().indexed(),
      requestedCount: i.number().indexed().optional(),
      importedCount: i.number().indexed().optional(),
      sampleOrgIds: i.json<string[]>().optional(),
      orgIds: i.json<string[]>().optional(),
      error: i.string().optional(),
      createdAt: i.number().indexed(),
      createdBy: i.string().indexed().optional(),
      updatedAt: i.number().indexed().optional(),
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
    roadmapItems: i.entity({
      title: i.string().indexed(),
      description: i.string().optional(),
      status: i.string().indexed(),
      createdAt: i.number().indexed(),
      statusChangedAt: i.number().indexed().optional(),
      targetCompletionAt: i.number().indexed().optional(),
      imageUrl: i.string().optional(),
      createdBy: i.string().indexed().optional(),
      order: i.number().indexed().optional(),
      tags: i.json<string[]>().optional(),
      effort: i.string().optional(),
    }),
    roadmapItemVotes: i.entity({
      roadmapItemId: i.string().indexed(),
      voterId: i.string().indexed(),
      createdAt: i.number().indexed(),
    }),
    roadmapItemComments: i.entity({
      roadmapItemId: i.string().indexed(),
      authorId: i.string().indexed(),
      authorName: i.string().optional(),
      body: i.string(),
      createdAt: i.number().indexed(),
      updatedAt: i.number().indexed().optional(),
    }),
    roadmapTags: i.entity({
      label: i.string().unique().indexed(),
      colorKey: i.string().indexed().optional(),
      shape: i.string().indexed().optional(),
      order: i.number().indexed().optional(),
      createdAt: i.number().indexed(),
      updatedAt: i.number().indexed().optional(),
      createdBy: i.string().indexed().optional(),
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
      // Human-friendly label for display (e.g., "Female Married w/o Spouse")
      // When set, shown as main title in UI; original name becomes subtitle
      label: i.string().indexed().optional(),
      category: i.string().indexed(),
      neId: i.string().unique().indexed().optional(),
      source: i.string().indexed().optional(), // e.g., "NE" | "Census"
      goodIfUp: i.boolean().optional(),
      // Used to control which stats appear as selectable chips in the map UI
      // Indexed because we filter by this field in queries
      featured: i.boolean().indexed().optional(),
      homeFeatured: i.boolean().indexed().optional(),
      active: i.boolean().indexed().optional(),
      // Visibility state: "inactive" | "private" | "public" (null => inherit from parent)
      visibility: i.string().indexed().optional(),
      // Owner of the stat (auth.id) for private/inactive visibility
      createdBy: i.string().indexed().optional(),
      type: i.string().indexed().optional(), // count | percent | rate | years | currency
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
    // Lightweight rollups for statData rows so the UI can render values without loading full ZIP maps.
    // One row per (statId, name, parentArea, boundaryType), representing the latest date available.
    statDataSummaries: i.entity({
      summaryKey: i.string().unique().indexed(), // `${statId}::${name}::${parentArea}::${boundaryType}`
      statId: i.string().indexed(),
      name: i.string().indexed(), // "root" (matches statData.name)
      parentArea: i.string().indexed(),
      boundaryType: i.string().indexed(), // "ZIP" | "COUNTY"
      date: i.string().indexed(), // latest date for this key
      // Optional min/max dates for this (statId,parentArea,boundaryType) context.
      // When present, Admin can show "2001–2023" without scanning statData.
      minDate: i.string().optional(),
      maxDate: i.string().optional(),
      type: i.string().indexed(),
      count: i.number(), // number of numeric entries in the data map
      sum: i.number(), // sum of numeric entries (useful for "count"/"currency"/etc.)
      avg: i.number(), // average of numeric entries (useful for "percent"/rates)
      min: i.number(),
      max: i.number(),
      updatedAt: i.number().indexed(),
      createdAt: i.number().indexed().optional(),
    }),
    // Parent/child relationships between stats
    statRelations: i.entity({
      // Composite uniqueness enforced via relationKey (parent::child::attribute)
      relationKey: i.string().unique().indexed(),
      parentStatId: i.string().indexed(),
      childStatId: i.string().indexed(),
      statAttribute: i.string().indexed(), // e.g., "Age", "Income"
      sortOrder: i.number().indexed().optional(), // Manual ordering within a group
      createdAt: i.number().indexed().optional(),
      updatedAt: i.number().indexed().optional(),
    }),
    // Centralized category definitions for stats, orgs, and UI surfaces
    categories: i.entity({
      slug: i.string().unique().indexed(), // canonical id (e.g., "food", "health")
      label: i.string(),                   // display name (e.g., "Food", "Health")
      sortOrder: i.number().indexed(),     // deterministic ordering in dropdowns/chips
      active: i.boolean().indexed().optional(), // soft-hide without deleting
      // Usage flags: enable/disable per surface
      forStats: i.boolean().indexed().optional(),      // can be used as stats.category
      forOrgs: i.boolean().indexed().optional(),       // allowed for organizations
      showOnMap: i.boolean().indexed().optional(),     // top category chips on map
      showInSidebar: i.boolean().indexed().optional(), // sidebar filter dropdown
      createdAt: i.number().indexed().optional(),
      updatedAt: i.number().indexed().optional(),
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
  links: {
    roadmapItemVotesByItem: {
      forward: { on: "roadmapItemVotes", has: "one", label: "item" },
      reverse: { on: "roadmapItems", has: "many", label: "votes" },
    },
    roadmapItemCommentsByItem: {
      forward: { on: "roadmapItemComments", has: "one", label: "item" },
      reverse: { on: "roadmapItems", has: "many", label: "comments" },
    },
  },
  rooms: {},
});

// This helps Typescript display nicer intellisense
type _AppSchema = typeof _schema;
interface AppSchema extends _AppSchema {}
const schema: AppSchema = _schema;

export type { AppSchema };
export default schema;
