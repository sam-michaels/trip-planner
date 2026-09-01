import { describe, expect, it } from "vitest";

import type { Leg, PlanStatus, TransportMode } from "../model/trip";
import { coords } from "../model/trip";
import { legToFeature } from "./geometry";
import { legPath } from "./path";
import { STATUS_OPACITY } from "./style";
import type { LegWithPath } from "./vehicles";
import { phaseFor, progress, runDurationMs, vehicleCollection } from "./vehicles";

const LISBON = coords(-9.1393, 38.7223);
const PORTO = coords(-8.6291, 41.1579);

function makeLeg(
  id: string,
  mode: TransportMode = "train",
  status: PlanStatus = "planned",
): Leg {
  const place = (name: string, at: [number, number]) => ({
    id: `place_${name}`,
    name,
    city: name,
    country: "PT",
    coords: at,
  });

  return {
    id,
    mode,
    status,
    from: place("Lisbon", LISBON),
    to: place("Porto", PORTO),
  } as Leg;
}

function withPath(leg: Leg): LegWithPath {
  return { leg, path: legPath(legToFeature(leg)) };
}

describe("runDurationMs", () => {
  it("clamps a four-kilometre transfer up to the floor", () => {
    // Otherwise the vehicle is gone before the eye finds it.
    expect(runDurationMs(4)).toBe(4_000);
  });

  it("clamps a transatlantic flight down to the ceiling", () => {
    expect(runDurationMs(5_700)).toBe(14_000);
  });

  it("paces the range in between by distance", () => {
    // The floor bites below ~680km, so both of these have to clear it
    // for the comparison to be about pacing rather than clamping.
    const short = runDurationMs(1_000);
    const long = runDurationMs(2_000);

    expect(short).toBeGreaterThan(4_000);
    expect(long).toBeLessThan(14_000);
    expect(long).toBeGreaterThan(short);
  });
});

describe("phaseFor", () => {
  it("is stable for the same id", () => {
    expect(phaseFor("leg_abc")).toBe(phaseFor("leg_abc"));
  });

  it("stays inside [0, 1)", () => {
    for (const id of ["", "a", "leg_1", "leg_999", "🛫"]) {
      const phase = phaseFor(id);
      expect(phase).toBeGreaterThanOrEqual(0);
      expect(phase).toBeLessThan(1);
    }
  });

  it("separates different legs, so they do not march in lockstep", () => {
    const phases = new Set(
      ["leg_1", "leg_2", "leg_3", "leg_4"].map((id) => phaseFor(id)),
    );
    expect(phases.size).toBe(4);
  });
});

describe("progress", () => {
  // phaseFor("") is deterministic, so a run can be positioned exactly
  // by working backwards from it.
  const atCycle = (p: number, lengthKm: number) =>
    progress((p - phaseFor("") + 1) * runDurationMs(lengthKm), lengthKm, "");

  it("departs at nothing and reaches full presence once under way", () => {
    expect(atCycle(0, 500).presence).toBeCloseTo(0, 6);
    expect(atCycle(0.4, 500).presence).toBe(1);
  });

  it("arrives before the cycle ends and holds there", () => {
    // t hits 1 at 85% of the cycle; the rest is the vehicle sitting
    // at B, which is what makes a run read as arriving rather than
    // wrapping straight back to the start.
    expect(atCycle(0.85, 500).t).toBeCloseTo(1, 6);
    expect(atCycle(0.95, 500).t).toBe(1);
    expect(atCycle(0.95, 500).presence).toBeLessThan(1);
  });

  it("moves forward through the travelling portion", () => {
    expect(atCycle(0.6, 500).t).toBeGreaterThan(atCycle(0.3, 500).t);
  });
});

describe("vehicleCollection", () => {
  it("emits one point feature per leg", () => {
    const collection = vehicleCollection(
      [withPath(makeLeg("leg_1")), withPath(makeLeg("leg_2"))],
      1_000,
      undefined,
      false,
    );

    expect(collection.features).toHaveLength(2);
    expect(collection.features[0].geometry.type).toBe("Point");
    expect(collection.features.map((f) => f.properties.legId)).toEqual([
      "leg_1",
      "leg_2",
    ]);
  });

  it("parks every vehicle mid-line at full presence when still", () => {
    const [feature] = vehicleCollection(
      [withPath(makeLeg("leg_1"))],
      0,
      undefined,
      true,
    ).features;

    expect(feature.properties.opacity).toBe(STATUS_OPACITY.planned);

    // Halfway between Lisbon and Porto, not at either end.
    const [lng, lat] = feature.geometry.coordinates;
    expect(lat).toBeGreaterThan(LISBON[1]);
    expect(lat).toBeLessThan(PORTO[1]);
    expect(lng).toBeGreaterThan(LISBON[0]);
    expect(lng).toBeLessThan(PORTO[0]);
  });

  it("never fades an unbooked leg below the 0.72 floor while it is under way", () => {
    // DESIGN.md forbids taking an unbooked item below 0.72, which is
    // why selection is carried by size rather than by dimming
    // everything else. The fade at the ends of a run is a departure
    // and arrival beat, not a status claim, so it is exempt.
    const idea = withPath(makeLeg("leg_idea", "train", "idea"));
    const duration = runDurationMs(idea.path.lengthKm);
    const offset = (0.4 - phaseFor("leg_idea") + 1) * duration;

    const [feature] = vehicleCollection([idea], offset, undefined, false)
      .features;

    expect(feature.properties.opacity).toBeCloseTo(0.72, 6);
  });

  it("carries selection as size and full opacity", () => {
    const legs = [withPath(makeLeg("leg_1")), withPath(makeLeg("leg_2"))];
    const { features } = vehicleCollection(legs, 0, "leg_1", true);

    expect(features[0].properties.size).toBe(1.2);
    expect(features[0].properties.opacity).toBe(1);
    expect(features[1].properties.size).toBe(1);
    expect(features[1].properties.opacity).toBe(STATUS_OPACITY.planned);
  });

  it("turns glyphs drawn from above and leaves elevation glyphs upright", () => {
    const rotatesFor = (mode: TransportMode) =>
      vehicleCollection([withPath(makeLeg("leg_1", mode))], 0, undefined, true)
        .features[0].properties;

    // Plan views may face their heading; a side-view car turned to a
    // westward bearing would drive along upside down.
    expect(rotatesFor("flight").rotates).toBe(true);
    expect(rotatesFor("walk").rotates).toBe(true);
    for (const mode of ["train", "bus", "car", "ferry"] as TransportMode[]) {
      expect(rotatesFor(mode).rotates).toBe(false);
      expect(rotatesFor(mode).heading).toBe(0);
    }
  });

  it("takes the plane's own 45-degree nose off its heading", () => {
    // Porto sits north and slightly east of Lisbon, so the true
    // heading is about 9 degrees. lucide's plane is already drawn
    // flying toward the top-right corner of its box, so the rotation
    // handed to MapLibre is that heading minus 45.
    const flight = withPath(makeLeg("leg_1", "flight"));
    const { heading } = vehicleCollection([flight], 0, undefined, true)
      .features[0].properties;

    expect(heading).toBeCloseTo(9 - 45, 0);
  });
});
