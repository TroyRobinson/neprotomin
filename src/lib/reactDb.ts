// React-specific database instance
import { init } from "@instantdb/react";
import schema from "../instant.schema";

export const db = init({
  appId: (() => {
    const id = import.meta.env.VITE_INSTANT_APP_ID as string | undefined;
    if (!id) {
      console.warn("[InstantDB] Missing VITE_INSTANT_APP_ID. Auth/queries will fail.");
      return "__MISSING_APP_ID__";
    }
    return id;
  })(),
  schema,
  useDateObjects: true,
});
