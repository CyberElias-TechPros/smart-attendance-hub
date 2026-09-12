import { describe, expect, it } from "vitest";
import { generateCode, haversineMeters } from "../src/db";

describe("generateCode", () => {
  it("returns a 6-digit string between 100000 and 999999", () => {
    for (let i = 0; i < 200; i++) {
      const code = generateCode();
      expect(code).toMatch(/^\d{6}$/);
      const n = Number(code);
      expect(n).toBeGreaterThanOrEqual(100000);
      expect(n).toBeLessThan(1000000);
    }
  });
});

describe("haversineMeters", () => {
  it("returns 0 for identical points", () => {
    expect(haversineMeters({ lat: 10, lng: 20 }, { lat: 10, lng: 20 })).toBeCloseTo(0, 6);
  });

  it("matches known distances (±0.5%)", () => {
    // ~111.2 km along the equator for 1 degree of longitude
    const d = haversineMeters({ lat: 0, lng: 0 }, { lat: 0, lng: 1 });
    expect(d / 111195).toBeGreaterThan(0.995);
    expect(d / 111195).toBeLessThan(1.005);

    // NYC -> LA approx 3936 km
    const nyc = { lat: 40.7128, lng: -74.006 };
    const la = { lat: 34.0522, lng: -118.2437 };
    const nycLa = haversineMeters(nyc, la);
    expect(nycLa / 3936000).toBeGreaterThan(0.97);
    expect(nycLa / 3936000).toBeLessThan(1.03);
  });

  it("is symmetric", () => {
    const a = { lat: 6.4281, lng: 3.4219 }; // Lagos
    const b = { lat: 51.5074, lng: -0.1278 }; // London
    expect(haversineMeters(a, b)).toBeCloseTo(haversineMeters(b, a), 3);
  });
});
