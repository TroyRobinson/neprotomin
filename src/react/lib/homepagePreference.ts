export type HomepageMode = "map" | "original";
export type HomepageRedirectState = HomepageMode | "unknown";

const HOMEPAGE_URL = "https://www.neighborhoodexplorer.org/";
const MAP_HOSTNAME = "map.neighborhoodexplorer.org";
const NE_DOMAIN_SUFFIX = ".neighborhoodexplorer.org";

const isNeighborhoodExplorerHost = (hostname: string): boolean => {
  const normalized = hostname.toLowerCase();
  return normalized === "neighborhoodexplorer.org" || normalized.endsWith(NE_DOMAIN_SUFFIX);
};

const isMapUrl = (url: string | null | undefined): boolean => {
  if (!url) return false;
  try {
    return new URL(url).hostname.toLowerCase() === MAP_HOSTNAME;
  } catch {
    return false;
  }
};

export const canProbeHomepageRedirectState = (): boolean => {
  if (typeof window === "undefined") return false;
  return isNeighborhoodExplorerHost(window.location.hostname);
};

export const inferHomepageRedirectState = (
  response: Pick<Response, "ok" | "redirected" | "status" | "type" | "url">,
): HomepageRedirectState => {
  if (isMapUrl(response.url)) return "map";
  if (response.type === "opaqueredirect") return "map";
  if (response.redirected && isMapUrl(response.url)) return "map";
  if (response.status >= 300 && response.status < 400) return "map";
  if (response.ok) return "original";
  return "unknown";
};

export const readHomepageRedirectState = async (
  fetchImpl?: typeof fetch,
): Promise<HomepageRedirectState> => {
  const effectiveFetch = fetchImpl ?? (typeof fetch === "function" ? fetch : null);
  if (!effectiveFetch) return "unknown";

  try {
    const response = await effectiveFetch(HOMEPAGE_URL, {
      cache: "no-store",
      credentials: "include",
      method: "GET",
      mode: "cors",
      redirect: "manual",
    });
    return inferHomepageRedirectState(response);
  } catch {
    return "unknown";
  }
};
