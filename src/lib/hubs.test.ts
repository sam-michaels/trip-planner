// ============================================================
// The hub table is hand-entered coordinates, and a flipped pair
// fails silently — the route engine just proposes something absurd
// with no error anywhere. These tests exist to make that loud.
//
// The bounding-box test is the important one: it is the only check
// here that catches a lng/lat swap on a hub nobody thought to assert
// individually. Everything else is spot checks on the corridors the
// motivating trip actually uses.
//
// NOTE: nothing runs this file yet — the repo has no test runner as of
// writing, and `tsconfig.app.json` excludes it from the build so the
// unresolvable `vitest` import doesn't break `tsc -b`. It is written
// against vitest and should go green the moment a runner is wired up;
// drop that exclusion at the same time.
// ============================================================

import { describe, expect, it } from "vitest";
import { HUBS, hubByIata, isHub, nearestHub, nearestHubs } from "./hubs";
import { continentOf, type Continent } from "./geo";
import { coords } from "../model/trip";

/** Generous [minLng, minLat, maxLng, maxLat] envelopes, not tight fits. */
const CONTINENT_BOX: Record<Continent, [number, number, number, number]> = {
  europe: [-32, 34, 45, 72],
  africa: [-20, -36, 52, 38],
  "north-america": [-170, 7, -52, 72],
  "south-america": [-82, -56, -34, 13],
  asia: [25, -11, 150, 56],
  oceania: [110, -48, 180, 0],
};

describe("hub table", () => {
  it("parses every row", () => {
    expect(HUBS.length).toBeGreaterThan(50);
  });

  it("has no duplicate IATA codes", () => {
    const codes = HUBS.map((hub) => hub.iata);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it("has well-formed codes and coordinates", () => {
    for (const hub of HUBS) {
      expect(hub.iata, hub.name).toMatch(/^[A-Z]{3}$/);
      expect(hub.country, hub.name).toMatch(/^[A-Z]{2}$/);
      expect(hub.city, hub.name).not.toBe("");
      expect(hub.name, hub.iata).not.toBe("");

      const [lng, lat] = hub.coords;
      expect(Number.isFinite(lng), hub.iata).toBe(true);
      expect(Number.isFinite(lat), hub.iata).toBe(true);
    }
  });

  // A swapped pair almost always lands outside its own continent.
  it("puts every hub inside its continent's bounding box", () => {
    for (const hub of HUBS) {
      const continent = continentOf(hub.country);
      expect(continent, `${hub.iata} has an unknown country`).toBeDefined();

      const [minLng, minLat, maxLng, maxLat] = CONTINENT_BOX[continent!];
      const [lng, lat] = hub.coords;

      expect(lng, `${hub.iata} longitude`).toBeGreaterThanOrEqual(minLng);
      expect(lng, `${hub.iata} longitude`).toBeLessThanOrEqual(maxLng);
      expect(lat, `${hub.iata} latitude`).toBeGreaterThanOrEqual(minLat);
      expect(lat, `${hub.iata} latitude`).toBeLessThanOrEqual(maxLat);
    }
  });

  it("covers the corridors the trip depends on", () => {
    for (const code of ["YYZ", "LIS", "OPO", "CMN", "RAK", "TNG", "MAD"]) {
      expect(isHub(code), code).toBe(true);
    }
  });
});

describe("lookups", () => {
  it("is case-insensitive", () => {
    expect(isHub("lis")).toBe(true);
    expect(hubByIata("lis")?.city).toBe("Lisbon");
  });

  it("returns undefined for a real airport that isn't a hub", () => {
    expect(isHub("YXU")).toBe(false);
    expect(hubByIata("YXU")).toBeUndefined();
  });
});

describe("nearestHub", () => {
  // City-centre coordinates, not airport ones — the point is that a
  // destination resolves to the hub a traveller would really use.
  const cases: [string, [number, number], string][] = [
    ["Lisbon", [-9.1393, 38.7223], "LIS"],
    ["Porto", [-8.6291, 41.1579], "OPO"],
    ["Toronto", [-79.3832, 43.6532], "YYZ"],
    ["Marrakesh", [-7.9811, 31.6295], "RAK"],
    ["Johannesburg", [28.0473, -26.2041], "JNB"],
    ["Sydney", [151.2093, -33.8688], "SYD"],
    ["Tokyo", [139.6917, 35.6895], "HND"],
    ["Sao Paulo", [-46.6333, -23.5505], "GRU"],
  ];

  for (const [city, [lng, lat], expected] of cases) {
    it(`resolves ${city} to ${expected}`, () => {
      expect(nearestHub(coords(lng, lat))?.iata).toBe(expected);
    });
  }

  it("respects a radius", () => {
    // London, Ontario is nowhere near any curated hub but Toronto.
    const londonOn = coords(-81.2497, 42.9849);
    expect(nearestHub(londonOn)?.iata).toBe("YYZ");
    expect(nearestHub(londonOn, 50)).toBeUndefined();
  });

  it("agrees with nearestHubs", () => {
    const lisbon = coords(-9.1393, 38.7223);
    expect(nearestHubs(lisbon, 3)[0]).toEqual(nearestHub(lisbon));
    expect(nearestHubs(lisbon, 3)).toHaveLength(3);
  });
});
