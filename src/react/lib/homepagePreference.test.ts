import { afterEach, describe, expect, it, vi } from "vitest";

import {
  canProbeHomepageRedirectState,
  inferHomepageRedirectState,
  readHomepageRedirectState,
} from "./homepagePreference";

const response = (
  overrides: Partial<Pick<Response, "ok" | "redirected" | "status" | "type" | "url">>,
) =>
  ({
    ok: false,
    redirected: false,
    status: 0,
    type: "cors",
    url: "https://www.neighborhoodexplorer.org/",
    ...overrides,
  }) as Pick<Response, "ok" | "redirected" | "status" | "type" | "url">;

describe("homepagePreference", () => {
  const originalWindow = (globalThis as any).window;

  afterEach(() => {
    (globalThis as any).window = originalWindow;
    vi.restoreAllMocks();
  });

  it("probes only neighborhoodexplorer.org hosts", () => {
    (globalThis as any).window = { location: { hostname: "map.neighborhoodexplorer.org" } };
    expect(canProbeHomepageRedirectState()).toBe(true);

    (globalThis as any).window = { location: { hostname: "okfoodmap.com" } };
    expect(canProbeHomepageRedirectState()).toBe(false);
  });

  it("infers map mode from manual redirects and map URLs", () => {
    expect(inferHomepageRedirectState(response({ type: "opaqueredirect" }))).toBe("map");
    expect(
      inferHomepageRedirectState(
        response({
          ok: true,
          status: 200,
          url: "https://map.neighborhoodexplorer.org/",
        }),
      ),
    ).toBe("map");
    expect(inferHomepageRedirectState(response({ status: 302 }))).toBe("map");
  });

  it("infers original mode from a readable successful homepage response", () => {
    expect(inferHomepageRedirectState(response({ ok: true, status: 200 }))).toBe("original");
  });

  it("returns unknown for unreadable or failed states", () => {
    expect(inferHomepageRedirectState(response({ status: 404 }))).toBe("unknown");
  });

  it("reads homepage state with credentialed manual redirect fetch", async () => {
    const fetchMock = vi.fn().mockResolvedValue(response({ type: "opaqueredirect" }));

    await expect(readHomepageRedirectState(fetchMock as unknown as typeof fetch)).resolves.toBe("map");
    expect(fetchMock).toHaveBeenCalledWith("https://www.neighborhoodexplorer.org/", {
      cache: "no-store",
      credentials: "include",
      method: "GET",
      mode: "cors",
      redirect: "manual",
    });
  });

  it("falls back to unknown when probing fails", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("Blocked"));

    await expect(readHomepageRedirectState(fetchMock as unknown as typeof fetch)).resolves.toBe("unknown");
  });
});
