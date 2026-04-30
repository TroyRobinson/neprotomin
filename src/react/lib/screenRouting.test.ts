import { describe, expect, it } from "vitest";
import {
  hashForScreen,
  isHashRoutedScreen,
  isKnownScreenHash,
  screenFromHash,
} from "./screenRouting";

describe("screenRouting", () => {
  it("parses supported hash-routed screens case-insensitively", () => {
    expect(screenFromHash("#roadmap")).toBe("roadmap");
    expect(screenFromHash("#QUEUE")).toBe("queue");
    expect(screenFromHash("#Admin")).toBe("admin");
  });

  it("ignores empty or unsupported hashes", () => {
    expect(screenFromHash("")).toBeNull();
    expect(screenFromHash("#map")).toBeNull();
    expect(screenFromHash("#report")).toBeNull();
  });

  it("serializes only hash-routed screens", () => {
    expect(hashForScreen("roadmap")).toBe("#roadmap");
    expect(hashForScreen("queue")).toBe("#queue");
    expect(hashForScreen("admin")).toBe("#admin");
    expect(hashForScreen("map")).toBeNull();
    expect(hashForScreen("report")).toBeNull();
  });

  it("checks hash-routed screen and hash membership", () => {
    expect(isHashRoutedScreen("admin")).toBe(true);
    expect(isHashRoutedScreen("map")).toBe(false);
    expect(isKnownScreenHash("#queue")).toBe(true);
    expect(isKnownScreenHash("#missing")).toBe(false);
  });
});
