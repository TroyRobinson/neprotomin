// React-specific database initialization with hooks support
import { init } from "@instantdb/react";
import schema from "../instant.schema";

// Export the React version of the db with hooks
export const db = init({
  appId: import.meta.env.VITE_INSTANT_APP_ID,
  schema,
  useDateObjects: true,
});
