import { describe, expect, it } from "vitest";

import { coords } from "../model/trip";
import { bearingDegrees, distanceKm, isLandConnected } from "./geo";

describe("distanceKm", () => {
  it("measures the great-circle distance between Toronto and Lisbon", () => {
    const toronto = coords(-79.3832, 43.6532);
    const lisbon = coords(-9.1393, 38.7223);

    // Great-circle distance, not driving distance — should land close
    // to the ~5,700km figure usually quoted for this city pair.
    expect(distanceKm(toronto, lisbon)).toBeCloseTo(5726, -1);
  });
});

describe("bearingDegrees", () => {
  it("reads due north as 0 and due east as 90", () => {
    expect(bearingDegrees(coords(0, 0), coords(0, 10))).toBeCloseTo(0, 6);
    expect(bearingDegrees(coords(0, 0), coords(10, 0))).toBeCloseTo(90, 6);
    expect(bearingDegrees(coords(0, 0), coords(0, -10))).toBeCloseTo(180, 6);
    expect(bearingDegrees(coords(0, 0), coords(-10, 0))).toBeCloseTo(270, 6);
  });

  it("stays on the compass rather than going negative", () => {
    // atan2 returns -PI..PI; a westward bearing must come back as 315,
    // not -45, or the icon rotation reads as a mirror image.
    expect(bearingDegrees(coords(0, 0), coords(-10, 10))).toBeGreaterThan(180);
    expect(bearingDegrees(coords(0, 0), coords(-10, 10))).toBeLessThan(360);
  });

  it("is unaffected by longitudes unwrapped past 180", () => {
    // path.ts hands over coordinates that may sit outside the usual
    // range, because a route across the antimeridian is stored as a
    // continuous run rather than a wrapped one.
    expect(bearingDegrees(coords(179, 0), coords(181, 0))).toBeCloseTo(90, 6);
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
