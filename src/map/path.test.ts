import { describe, expect, it } from "vitest";

import { MODE_COLORS } from "../itinerary/labels";
import { coords } from "../model/trip";
import type { LegFeature, LegProperties } from "./geometry";
import { legPath, pointAt } from "./path";

const PROPERTIES: LegProperties = {
  legId: "leg_test",
  mode: "flight",
  status: "planned",
  color: MODE_COLORS.flight,
};

function lineFeature(...vertices: [number, number][]): LegFeature {
  return {
    type: "Feature",
    properties: PROPERTIES,
    geometry: { type: "LineString", coordinates: vertices },
  };
}

describe("legPath", () => {
  it("measures cumulative distance along the vertices", () => {
    const path = legPath(lineFeature([0, 0], [1, 0], [2, 0]));

    expect(path.cumulative[0]).toBe(0);
    expect(path.cumulative[2]).toBe(path.lengthKm);
    // A degree of longitude at the equator is ~111km, so two of them
    // is ~222km with the midpoint halfway.
    expect(path.lengthKm).toBeCloseTo(222, -1);
    expect(path.cumulative[1]).toBeCloseTo(path.lengthKm / 2, 5);
  });

  it("joins a MultiLineString into one continuous path", () => {
    // What `greatCircle()` produces for a route crossing the
    // antimeridian: two rings that meet at 180.
    const feature: LegFeature = {
      type: "Feature",
      properties: PROPERTIES,
      geometry: {
        type: "MultiLineString",
        coordinates: [
          [
            [179, 0],
            [180, 0],
          ],
          [
            [-180, 0],
            [-179, 0],
          ],
        ],
      },
    };

    expect(legPath(feature).coords).toHaveLength(4);
  });

  it("unwraps longitude so a route across the antimeridian never doubles back", () => {
    const path = legPath(lineFeature([179, 0], [-179, 0]));

    // -179 is 2 degrees east of 179, not 358 degrees west of it.
    expect(path.coords[1][0]).toBe(181);
    expect(path.lengthKm).toBeCloseTo(222, -1);
  });
});

describe("pointAt", () => {
  it("lands on the endpoints at t=0 and t=1", () => {
    const path = legPath(lineFeature([0, 0], [10, 0], [20, 0]));

    expect(pointAt(path, 0).coords[0]).toBeCloseTo(0, 6);
    expect(pointAt(path, 1).coords[0]).toBeCloseTo(20, 6);
  });

  it("finds the halfway point of a straight line", () => {
    const path = legPath(lineFeature([0, 0], [10, 0]));

    expect(pointAt(path, 0.5).coords[0]).toBeCloseTo(5, 4);
  });

  it("stays past the antimeridian at the midpoint rather than jumping to zero", () => {
    // The bug this guards: without unwrapping, the midpoint of
    // 179 -> -179 interpolates to 0 and the vehicle teleports to the
    // Gulf of Guinea for one frame.
    const path = legPath(lineFeature([179, 0], [-179, 0]));

    expect(pointAt(path, 0.5).coords[0]).toBeCloseTo(180, 4);
  });

  it("resolves a zero-length leg to its own coordinate rather than NaN", () => {
    // A leg whose endpoints are the same place is a normal state
    // while an itinerary is half-entered. NaN coordinates are dropped
    // silently by MapLibre, so this would be an invisible vehicle
    // with nothing in the console to explain it.
    const lisbon = coords(-9.1393, 38.7223);
    const path = legPath(lineFeature(lisbon, lisbon));
    const point = pointAt(path, 0.4);

    expect(point.coords[0]).toBeCloseTo(-9.1393, 6);
    expect(point.coords[1]).toBeCloseTo(38.7223, 6);
    expect(Number.isNaN(point.heading)).toBe(false);
  });

  it("survives a single-vertex path", () => {
    const point = pointAt(legPath(lineFeature([5, 5])), 0.7);

    expect(point.coords).toEqual([5, 5]);
  });

  it("reports the heading of the segment being crossed", () => {
    // Due east along the equator, then due north.
    const path = legPath(lineFeature([0, 0], [10, 0], [10, 10]));

    expect(pointAt(path, 0.1).heading).toBeCloseTo(90, 0);
    expect(pointAt(path, 0.9).heading).toBeCloseTo(0, 0);
  });
});
