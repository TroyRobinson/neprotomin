// Docs: https://www.instantdb.com/docs/modeling-data

import { i } from '@instantdb/core';

const _schema = i.schema({
  entities: {
    $files: i.entity({
      path: i.string().unique().indexed(),
      url: i.string(),
    }),
    // (users/auth removed)
    organizations: i.entity({
      name: i.string().indexed(),
      url: i.string(),
      latitude: i.number(),
      longitude: i.number(),
      category: i.string().indexed(),
    }),
    stats: i.entity({
      name: i.string().indexed(),
      category: i.string().indexed(),
      goodIfUp: i.boolean().optional(),
    }),
    statData: i.entity({
      statId: i.string().indexed(),
      name: i.string().indexed(), // e.g., "root" or sub-stat name
      area: i.string().indexed(), // e.g., Tulsa
      boundaryType: i.string().indexed(), // e.g., ZIP
      date: i.string().indexed(), // e.g., year like "2025"
      type: i.string(), // e.g., count | percent | rate | years | currency
      data: i.json<Record<string, number>>(), // map of area key (e.g., ZIP) -> value
    }),
    // Persisted per-user/per-guest UI state
    uiState: i.entity({
      owner: i.string().indexed(), // auth.id (works for guests too)
      selection: i.json<{ zips: string[]; pinned: string[]; boundaryMode: string | null }>(),
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
