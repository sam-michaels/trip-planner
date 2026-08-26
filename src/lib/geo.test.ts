import { describe, expect, it } from "vitest";

import { coords } from "../model/trip";
import { distanceKm, isLandConnected } from "./geo";

describe("distanceKm", () => {
  it("measures the great-circle distance between Toronto and Lisbon", () => {
    const toronto = coords(-79.3832, 43.6532);
    const lisbon = coords(-9.1393, 38.7223);

    // Great-circle distance, not driving distance — should land close
    // to the ~5,700km figure usually quoted for this city pair.
    expect(distanceKm(toronto, lisbon)).toBeCloseTo(5726, -1);
  });
});

describe("isLandConnected", () => {
  it("treats Europe and Africa as not land-bridged", () => {
    // Portugal and Morocco face each other across the Strait of
    // Gibraltar — 14km of water, no bridge, hence the ferry.
    expect(isLandConnected("PT", "MA")).toBe(false);
  });

  it("treats two countries on the same continent as connected", () => {
    expect(isLandConnected("FR", "DE")).toBe(true);
  });
});
