// Docs: https://www.instantdb.com/docs/modeling-data

import { i } from '@instantdb/core';

const _schema = i.schema({
  entities: {
    $files: i.entity({
      path: i.string().unique().indexed(),
      url: i.string(),
    }),
    $users: i.entity({
      email: i.string().unique().indexed().optional(),
    }),
    organizations: i.entity({
      name: i.string().indexed(),
      url: i.string(),
      latitude: i.number(),
      longitude: i.number(),
      category: i.string().indexed(),
    }),
    areas: i.entity({
      key: i.string().unique().indexed(),
      type: i.string().indexed(),
      population: i.number(),
      avgAge: i.number(),
      marriedPercent: i.number(),
    }),
    stats: i.entity({
      name: i.string().indexed(),
      category: i.string().indexed(),
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
