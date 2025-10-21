// React-specific database instance
import { init } from "@instantdb/react";
import schema from "../instant.schema";
import { getEnvString } from "./env";

const resolveAppId = (): string => {
  const fromImport = getEnvString("VITE_INSTANT_APP_ID");
  if (fromImport) return fromImport;
  const fromNext = getEnvString("NEXT_PUBLIC_INSTANT_APP_ID");
  if (fromNext) return fromNext;
  console.warn("[InstantDB] Missing VITE_INSTANT_APP_ID. Auth/queries will fail.");
  return "__MISSING_APP_ID__";
};

export const db = init({
  appId: resolveAppId(),
  schema,
  useDateObjects: true,
});
