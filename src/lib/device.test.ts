import { describe, expect, it } from "vitest";

import { __resetDeviceMemo, getDeviceId, shortDeviceId } from "./device";

describe("device identity", () => {
  it("returns a stable id across calls", () => {
    __resetDeviceMemo();
    const a = getDeviceId();
    const b = getDeviceId();
    expect(a).toBeTruthy();
    expect(a).toBe(b);
  });

  it("works without localStorage (falls back to an in-memory id)", () => {
    __resetDeviceMemo();
    // Node test env has no localStorage — must not throw.
    expect(() => getDeviceId()).not.toThrow();
    expect(getDeviceId()).toBe(getDeviceId());
  });

  it("shortens ids for display", () => {
    expect(shortDeviceId("a1b2c3d4-e5f6")).toBe("a1b2c3d4");
    expect(shortDeviceId(undefined)).toBe("—");
    expect(shortDeviceId(null)).toBe("—");
  });
});
