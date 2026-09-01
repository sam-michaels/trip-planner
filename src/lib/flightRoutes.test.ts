// ============================================================
// These assertions are pinned against the real dataset, not made up
// to match whatever the code happens to do — YXU (London, Ontario)
// really does only serve those five airports, and it really has no
// direct flight to Lisbon. If a regeneration of flightRoutes.data.ts
// changes any of these, the data changed, not just the code.
// ============================================================

import { describe, expect, it } from "vitest";
import {
  airportsFlyingTo,
  destinationsFrom,
  flightExists,
  isKnownAirport,
} from "./flightRoutes";

describe("flightExists", () => {
  it("is false for a route that doesn't exist", () => {
    expect(flightExists("YXU", "LIS")).toBe(false);
  });

  it("is true for a route that does exist", () => {
    expect(flightExists("YYZ", "LIS")).toBe(true);
  });

  it("is true for the small-airport access hop", () => {
    expect(flightExists("YXU", "YYZ")).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(flightExists("yyz", "lis")).toBe(true);
    expect(flightExists("Yxu", "Lis")).toBe(false);
  });

  it("is false rather than throwing for an unknown code", () => {
    expect(flightExists("ZZZ", "YYZ")).toBe(false);
    expect(flightExists("YYZ", "ZZZ")).toBe(false);
    expect(flightExists("ZZZ", "ZZZ")).toBe(false);
  });
});

describe("airportsFlyingTo", () => {
  it("inverts the forward table", () => {
    expect(airportsFlyingTo("LIS").has("YYZ")).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(airportsFlyingTo("lis").has("YYZ")).toBe(true);
  });

  it("returns an empty set rather than throwing for an unknown code", () => {
    expect(airportsFlyingTo("ZZZ").size).toBe(0);
  });
});

describe("destinationsFrom", () => {
  it("is exactly the five airports YXU serves", () => {
    expect(destinationsFrom("YXU")).toEqual(
      new Set(["ORD", "YOW", "YWG", "YYC", "YYZ"]),
    );
  });

  it("is case-insensitive", () => {
    expect(destinationsFrom("yxu")).toEqual(destinationsFrom("YXU"));
  });

  it("returns an empty set rather than throwing for an unknown code", () => {
    expect(destinationsFrom("ZZZ").size).toBe(0);
  });
});

describe("isKnownAirport — telling missing data apart from a real answer", () => {
  it("knows an airport the snapshot covers", () => {
    // 275 routes in the snapshot, so its gaps are trustworthy.
    expect(isKnownAirport("LYS")).toBe(true);
    expect(isKnownAirport("YXU")).toBe(true);
  });

  it("does not know Berlin Brandenburg, which opened after the snapshot", () => {
    // BER appears in zero routes: it opened in 2020, this data is 2014.
    // Rejecting it for "having no flights" would be reading missing data
    // as an answer — the exact mistake this guard exists to prevent.
    expect(isKnownAirport("BER")).toBe(false);
    expect(flightExists("MAD", "BER")).toBe(false);

    // ...while the airports Berlin actually used in 2014 are known, which
    // is what makes the pair above diagnosable rather than just absent.
    expect(isKnownAirport("TXL")).toBe(true);
    expect(flightExists("MAD", "TXL")).toBe(true);
  });

  it("is case-insensitive and safe on nonsense", () => {
    expect(isKnownAirport("lys")).toBe(true);
    expect(isKnownAirport("ZZZ")).toBe(false);
    expect(isKnownAirport("")).toBe(false);
  });
});
