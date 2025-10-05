// Initialize the database

import { init } from "@instantdb/core";
import schema from "../instant.schema";

// ---------
export const db = init({
  appId: (() => {
    const id = import.meta.env.VITE_INSTANT_APP_ID as string | undefined;
    if (!id) {
      console.warn("[InstantDB] Missing VITE_INSTANT_APP_ID. Admin/core client will not connect.");
      return "__MISSING_APP_ID__";
    }
    return id;
  })(),
  schema,
  useDateObjects: true,
});
