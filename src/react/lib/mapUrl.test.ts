import { describe, expect, it, vi, afterEach } from "vitest";

import { getMapStateFromUrl, updateUrlWithMapState } from "./mapUrl";

type WindowLike = {
  location: { href: string; search: string; hostname: string };
  history: { replaceState: (data: any, unused: string, url: string) => void };
};

function setWindowUrl(url: string) {
  const u = new URL(url);
  const loc = (globalThis as any).window.location;
  loc.href = u.toString();
  loc.search = u.search;
  loc.hostname = u.hostname;
}

describe("mapUrl selection persistence", () => {
  const originalWindow = (globalThis as any).window;

  afterEach(() => {
    (globalThis as any).window = originalWindow;
  });

  it("parses zips + counties from URL and trims whitespace", () => {
    const w: WindowLike = {
      location: { href: "http://example.test/", search: "", hostname: "example.test" },
      history: {
        replaceState: vi.fn((_data, _unused, url) => {
          setWindowUrl(url);
        }),
      },
    };
    (globalThis as any).window = w;

    setWindowUrl("http://example.test/?zips=74129,%2074145&counties=40037,%2040039");

    const state = getMapStateFromUrl();
    expect(state.selectedZips).toEqual(["74129", "74145"]);
    expect(state.selectedCounties).toEqual(["40037", "40039"]);
  });

  it("parses primary + secondary stats from URL", () => {
    const w: WindowLike = {
      location: { href: "http://example.test/", search: "", hostname: "example.test" },
      history: {
        replaceState: vi.fn((_data, _unused, url) => {
          setWindowUrl(url);
        }),
      },
    };
    (globalThis as any).window = w;

    setWindowUrl("http://example.test/?stat=primary&stat2=secondary");

    const state = getMapStateFromUrl();
    expect(state.statId).toBe("primary");
    expect(state.secondaryStatId).toBe("secondary");
  });

  it("writes secondary stat to URL and removes it when empty", () => {
    const w: WindowLike = {
      location: { href: "http://example.test/", search: "", hostname: "example.test" },
      history: {
        replaceState: vi.fn((_data, _unused, url) => {
          setWindowUrl(url);
        }),
      },
    };
    (globalThis as any).window = w;

    setWindowUrl("http://example.test/");

    updateUrlWithMapState(
      36.0,
      -95.9,
      10,
      "primary",
      "secondary",
      null,
      [],
      false,
      false,
      "auto",
      [],
      [],
      "orgs",
      {
        statVizVisible: true,
        statVizCollapsed: false,
        demographicsVisible: true,
        demographicsExpanded: false,
      },
      false,
    );

    const search = (globalThis as any).window.location.search;
    expect(search).toContain("stat=primary");
    expect(search).toContain("stat2=secondary");

    updateUrlWithMapState(
      36.0,
      -95.9,
      10,
      "primary",
      null,
      null,
      [],
      false,
      false,
      "auto",
      [],
      [],
      "orgs",
      {
        statVizVisible: true,
        statVizCollapsed: false,
        demographicsVisible: true,
        demographicsExpanded: false,
      },
      false,
    );

    const search2 = (globalThis as any).window.location.search;
    expect(search2).toContain("stat=primary");
    expect(search2).not.toContain("stat2=");
  });

  it("writes zips + counties to URL and removes them when empty", () => {
    const w: WindowLike = {
      location: { href: "http://example.test/", search: "", hostname: "example.test" },
      history: {
        replaceState: vi.fn((_data, _unused, url) => {
          setWindowUrl(url);
        }),
      },
    };
    (globalThis as any).window = w;

    setWindowUrl("http://example.test/?zips=74129&counties=40037");

    updateUrlWithMapState(
      36.0,
      -95.9,
      10,
      null,
      null,
      null,
      [],
      false,
      false,
      "auto",
      ["74129"],
      ["40037"],
      "orgs",
      {
        statVizVisible: true,
        statVizCollapsed: false,
        demographicsVisible: true,
        demographicsExpanded: false,
      },
      false,
    );

    expect((globalThis as any).window.location.search).toContain("zips=74129");
    expect((globalThis as any).window.location.search).toContain("counties=40037");

    updateUrlWithMapState(
      36.0,
      -95.9,
      10,
      null,
      null,
      null,
      [],
      false,
      false,
      "auto",
      [],
      [],
      "orgs",
      {
        statVizVisible: true,
        statVizCollapsed: false,
        demographicsVisible: true,
        demographicsExpanded: false,
      },
      false,
    );

    const search = (globalThis as any).window.location.search;
    expect(search).not.toContain("zips=");
    expect(search).not.toContain("counties=");
  });

  it("parses sidebar tab from URL and respects domain defaults", () => {
    const w: WindowLike = {
      location: { href: "http://example.test/", search: "", hostname: "example.test" },
      history: {
        replaceState: vi.fn((_data, _unused, url) => {
          setWindowUrl(url);
        }),
      },
    };
    (globalThis as any).window = w;

    setWindowUrl("http://example.test/?tab=stats");
    const state = getMapStateFromUrl();
    expect(state.sidebarTab).toBe("stats");

    setWindowUrl("http://example.test/");
    const state2 = getMapStateFromUrl();
    expect(state2.sidebarTab).toBe("stats");

    setWindowUrl("http://okfoodmap.com/");
    const state3 = getMapStateFromUrl();
    expect(state3.sidebarTab).toBe("orgs");
  });

  it("writes sidebar tab to URL and removes it when default", () => {
    const w: WindowLike = {
      location: { href: "http://example.test/", search: "", hostname: "example.test" },
      history: {
        replaceState: vi.fn((_data, _unused, url) => {
          setWindowUrl(url);
        }),
      },
    };
    (globalThis as any).window = w;

    setWindowUrl("http://example.test/");

    updateUrlWithMapState(
      36.0,
      -95.9,
      10,
      null,
      null,
      null,
      [],
      false,
      false,
      "auto",
      [],
      [],
      "stats",
      {
        statVizVisible: true,
        statVizCollapsed: false,
        demographicsVisible: true,
        demographicsExpanded: false,
      },
      false,
    );

    expect((globalThis as any).window.location.search).not.toContain("tab=");

    updateUrlWithMapState(
      36.0,
      -95.9,
      10,
      null,
      null,
      null,
      [],
      false,
      false,
      "auto",
      [],
      [],
      "orgs",
      {
        statVizVisible: true,
        statVizCollapsed: false,
        demographicsVisible: true,
        demographicsExpanded: false,
      },
      false,
    );

    expect((globalThis as any).window.location.search).toContain("tab=orgs");

    updateUrlWithMapState(
      36.0,
      -95.9,
      10,
      null,
      null,
      null,
      [],
      false,
      false,
      "auto",
      [],
      [],
      "stats",
      {
        statVizVisible: true,
        statVizCollapsed: false,
        demographicsVisible: true,
        demographicsExpanded: false,
      },
      false,
    );

    expect((globalThis as any).window.location.search).not.toContain("tab=");
  });

  it("uses orgs as the default tab on okfoodmap domains", () => {
    const w: WindowLike = {
      location: { href: "http://okfoodmap.com/", search: "", hostname: "okfoodmap.com" },
      history: {
        replaceState: vi.fn((_data, _unused, url) => {
          setWindowUrl(url);
        }),
      },
    };
    (globalThis as any).window = w;

    setWindowUrl("http://okfoodmap.com/");
    updateUrlWithMapState(
      36.0,
      -95.9,
      10,
      null,
      null,
      null,
      [],
      false,
      false,
      "auto",
      [],
      [],
      "orgs",
      {
        statVizVisible: true,
        statVizCollapsed: false,
        demographicsVisible: true,
        demographicsExpanded: false,
      },
      false,
    );

    expect((globalThis as any).window.location.search).not.toContain("tab=");

    updateUrlWithMapState(
      36.0,
      -95.9,
      10,
      null,
      null,
      null,
      [],
      false,
      false,
      "auto",
      [],
      [],
      "stats",
      {
        statVizVisible: true,
        statVizCollapsed: false,
        demographicsVisible: true,
        demographicsExpanded: false,
      },
      false,
    );

    expect((globalThis as any).window.location.search).toContain("tab=stats");
  });

  it("parses sidebar insights visibility + expansion state from URL", () => {
    const w: WindowLike = {
      location: { href: "http://example.test/", search: "", hostname: "example.test" },
      history: {
        replaceState: vi.fn((_data, _unused, url) => {
          setWindowUrl(url);
        }),
      },
    };
    (globalThis as any).window = w;

    setWindowUrl("http://example.test/?sv=false&svc=true&demo=true&demoe=false");
    const state = getMapStateFromUrl();
    expect(state.sidebarInsights.hasAnyParam).toBe(true);
    expect(state.sidebarInsights.statVizVisible).toBe(false);
    expect(state.sidebarInsights.statVizCollapsed).toBe(true);
    expect(state.sidebarInsights.demographicsVisible).toBe(true);
    expect(state.sidebarInsights.demographicsExpanded).toBe(false);
  });

  it("writes sidebar insights state to URL when persistence is enabled, and clears when disabled", () => {
    const w: WindowLike = {
      location: { href: "http://example.test/", search: "", hostname: "example.test" },
      history: {
        replaceState: vi.fn((_data, _unused, url) => {
          setWindowUrl(url);
        }),
      },
    };
    (globalThis as any).window = w;

    setWindowUrl("http://example.test/");
    updateUrlWithMapState(
      36.0,
      -95.9,
      10,
      null,
      null,
      null,
      [],
      false,
      true,
      "auto",
      [],
      [],
      "orgs",
      {
        statVizVisible: true,
        statVizCollapsed: true,
        demographicsVisible: false,
        demographicsExpanded: true,
      },
      true,
    );

    const search = (globalThis as any).window.location.search;
    expect(search).toContain("sv=true");
    expect(search).toContain("svc=true");
    expect(search).toContain("demo=false");
    expect(search).toContain("demoe=true");

    updateUrlWithMapState(
      36.0,
      -95.9,
      10,
      null,
      null,
      null,
      [],
      false,
      true,
      "auto",
      [],
      [],
      "orgs",
      {
        statVizVisible: true,
        statVizCollapsed: false,
        demographicsVisible: true,
        demographicsExpanded: false,
      },
      false,
    );

    const search2 = (globalThis as any).window.location.search;
    expect(search2).not.toContain("sv=");
    expect(search2).not.toContain("svc=");
    expect(search2).not.toContain("demo=");
    expect(search2).not.toContain("demoe=");
  });
});
