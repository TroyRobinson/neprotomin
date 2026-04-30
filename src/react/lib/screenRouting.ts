export type ScreenName = "map" | "report" | "roadmap" | "data" | "queue" | "addOrg" | "admin";

const HASH_TO_SCREEN: Record<string, ScreenName> = {
  "#roadmap": "roadmap",
  "#queue": "queue",
  "#admin": "admin",
};

export const screenFromHash = (hash: string): ScreenName | null => {
  if (!hash) return null;
  return HASH_TO_SCREEN[hash.toLowerCase()] ?? null;
};

export const hashForScreen = (screen: ScreenName): string | null => {
  switch (screen) {
    case "roadmap":
      return "#roadmap";
    case "queue":
      return "#queue";
    case "admin":
      return "#admin";
    default:
      return null;
  }
};

export const isHashRoutedScreen = (screen: ScreenName): boolean =>
  screen === "roadmap" || screen === "queue" || screen === "admin";

export const isKnownScreenHash = (hash: string): boolean =>
  Boolean(HASH_TO_SCREEN[hash.toLowerCase()]);
