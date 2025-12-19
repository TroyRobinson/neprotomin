// Domain helpers shared across the React app.
export const isFoodMapDomain = (): boolean => {
  if (typeof window === "undefined") return false;
  const hostname = window.location.hostname.toLowerCase();
  return hostname === "okfoodmap.com" || hostname.endsWith(".okfoodmap.com");
};
