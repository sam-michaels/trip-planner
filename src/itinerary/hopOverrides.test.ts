// ============================================================
// The one rule these tests exist for: a leg id is not always a hop id.
//
// Every other bug in the editor announces itself. This one doesn't —
// write an override under "lisbon->porto#2" and the form accepts the
// edit, the reducer stores it, and the leg goes on showing the route
// engine's guess forever, because `deriveLegs` only ever reads the
// un-suffixed key. So the round-trip through `deriveLegs` is asserted
// here rather than the regex alone.
// ============================================================

import { describe, expect, it } from "vitest";

import type { HopOverride, Place, RouteMap, Trip } from "../model/trip";
import { coords, deriveLegs, hopId } from "../model/trip";
import {
  OVERRIDE_FIELDS,
  baseHopId,
  describeOverrides,
  hasOverrides,
  isRepeatOccurrence,
  occurrenceCount,
  overriddenFields,
  overrideForLeg,
} from "./hopOverrides";

const HOME: Place = {
  id: "yxu-city",
  name: "London, Ontario",
  city: "London",
  country: "CA",
  coords: coords(-81.2497, 42.9849),
};

const LISBON: Place = {
  id: "lisbon",
  name: "Lisbon",
  city: "Lisbon",
  country: "PT",
  coords: coords(-9.1393, 38.7223),
};

const PORTO: Place = {
  id: "porto",
  name: "Porto",
  city: "Porto",
  country: "PT",
  coords: coords(-8.6291, 41.1579),
};

/** Lisbon → Porto and back and out again, so the same hop occurs twice. */
function tripThroughPortoTwice(): Trip {
  return {
    id: "test",
    title: "There and back and there again",
    travellers: 1,
    homeCurrency: "CAD",
    origin: HOME,
    destinations: [
      { id: "d1", place: LISBON, status: "idea" },
      { id: "d2", place: PORTO, status: "idea" },
      { id: "d3", place: LISBON, status: "idea" },
      { id: "d4", place: PORTO, status: "idea" },
    ],
    hopOverrides: {},
    stays: [],
    activities: [],
  };
}

const NO_ROUTES: RouteMap = new Map();

describe("baseHopId", () => {
  it("leaves a first-occurrence leg id alone", () => {
    expect(baseHopId("lisbon->porto")).toBe("lisbon->porto");
  });

  it("strips the occurrence suffix", () => {
    expect(baseHopId("lisbon->porto#2")).toBe("lisbon->porto");
    expect(baseHopId("lisbon->porto#12")).toBe("lisbon->porto");
  });

  it("only strips a suffix that is genuinely at the end", () => {
    // A place id with a "#" in it is unlikely but not impossible, and
    // eating part of one would silently address the wrong journey.
    expect(baseHopId("lis#2->porto")).toBe("lis#2->porto");
    expect(baseHopId("lisbon->porto#2a")).toBe("lisbon->porto#2a");
  });

  it("recognises repeat occurrences", () => {
    expect(isRepeatOccurrence("lisbon->porto")).toBe(false);
    expect(isRepeatOccurrence("lisbon->porto#2")).toBe(true);
  });
});

describe("a repeated hop", () => {
  it("gets a suffixed leg id that is not its hop id", () => {
    const legs = deriveLegs(tripThroughPortoTwice(), NO_ROUTES);
    const lisbonToPorto = legs.filter(
      (leg) => leg.from.id === LISBON.id && leg.to.id === PORTO.id,
    );

    expect(lisbonToPorto).toHaveLength(2);
    expect(lisbonToPorto[0].id).toBe("lisbon->porto");
    expect(lisbonToPorto[1].id).toBe("lisbon->porto#2");
    // The whole point: the second one's id is NOT a key into hopOverrides.
    expect(lisbonToPorto[1].id).not.toBe(hopId(LISBON, PORTO));
    expect(baseHopId(lisbonToPorto[1].id)).toBe(hopId(LISBON, PORTO));
  });

  it("shares one override between both occurrences", () => {
    const trip = tripThroughPortoTwice();
    const legs = deriveLegs(trip, NO_ROUTES);
    const second = legs.find((leg) => leg.id === "lisbon->porto#2");
    expect(second).toBeDefined();

    // Exactly what the editor does when you pick a mode on the second
    // occurrence: write to `baseHopId(leg.id)`, never to `leg.id`.
    trip.hopOverrides[baseHopId(second!.id)] = {
      mode: "train",
      bookingRef: "ABC123",
    };

    const rederived = deriveLegs(trip, NO_ROUTES).filter(
      (leg) => leg.from.id === LISBON.id && leg.to.id === PORTO.id,
    );

    expect(rederived.map((leg) => leg.mode)).toEqual(["train", "train"]);
    expect(rederived.map((leg) => leg.bookingRef)).toEqual([
      "ABC123",
      "ABC123",
    ]);
  });

  it("is inert if the override is written under the suffixed id", () => {
    // The bug this module exists to prevent, pinned so nobody
    // "simplifies" the lookup back into it.
    const trip = tripThroughPortoTwice();
    trip.hopOverrides["lisbon->porto#2"] = { mode: "train" };

    const rederived = deriveLegs(trip, NO_ROUTES).filter(
      (leg) => leg.from.id === LISBON.id && leg.to.id === PORTO.id,
    );

    expect(rederived.every((leg) => leg.mode !== "train")).toBe(true);
  });
});

describe("occurrenceCount", () => {
  it("counts both occurrences from either one's leg id", () => {
    const legs = deriveLegs(tripThroughPortoTwice(), NO_ROUTES);

    // The first occurrence has no suffix to give it away, which is
    // exactly why the count has to come from the legs.
    expect(occurrenceCount(legs, "lisbon->porto")).toBe(2);
    expect(occurrenceCount(legs, "lisbon->porto#2")).toBe(2);
    // Directional: the return journey is its own hop.
    expect(occurrenceCount(legs, "porto->lisbon")).toBe(1);
    expect(occurrenceCount(legs, "lisbon->madrid")).toBe(0);
  });
});

describe("OVERRIDE_FIELDS", () => {
  it("covers every field a HopOverride can carry", () => {
    // A HopOverride with everything set: if a new field is added to the
    // model and not named in OVERRIDE_FIELD_LABELS, this stops
    // compiling; if the derived list drifts, this fails.
    const everything: Required<HopOverride> = {
      mode: "train",
      status: "booked",
      departure: "2026-09-12T08:15",
      arrival: "2026-09-12T11:30",
      cost: { amount: 32, currency: "EUR" },
      operator: "CP",
      bookingRef: "ABC123",
      bookingUrl: "https://cp.pt",
      notes: "window seat",
    };

    expect([...OVERRIDE_FIELDS].sort()).toEqual(
      Object.keys(everything).sort(),
    );
    expect(overriddenFields(everything)).toEqual(OVERRIDE_FIELDS);
  });
});

describe("overrideForLeg", () => {
  it("finds the override for either occurrence", () => {
    const overrides = { "lisbon->porto": { operator: "CP" } };

    expect(overrideForLeg(overrides, "lisbon->porto")?.operator).toBe("CP");
    expect(overrideForLeg(overrides, "lisbon->porto#2")?.operator).toBe("CP");
    expect(overrideForLeg(overrides, "porto->lisbon")).toBeUndefined();
  });
});

describe("overriddenFields", () => {
  it("is empty for a hop nobody has touched", () => {
    expect(overriddenFields(undefined)).toEqual([]);
    expect(overriddenFields({})).toEqual([]);
    expect(hasOverrides({})).toBe(false);
  });

  it("ignores a field explicitly set to undefined", () => {
    // The model is explicit that an absent field means "no opinion",
    // so a lingering `undefined` must not read as an override.
    expect(overriddenFields({ mode: undefined })).toEqual([]);
    expect(hasOverrides({ mode: undefined })).toBe(false);
  });

  it("lists fields in editor order", () => {
    expect(
      overriddenFields({ notes: "check bags", mode: "train", cost: undefined }),
    ).toEqual(["mode", "notes"]);
  });
});

describe("describeOverrides", () => {
  it("says nothing about an untouched hop", () => {
    expect(describeOverrides(undefined)).toBeUndefined();
    expect(describeOverrides({})).toBeUndefined();
  });

  it("names one field", () => {
    expect(describeOverrides({ mode: "train" })).toBe(
      "You set the mode on this hop",
    );
  });

  it("joins several with a final 'and'", () => {
    expect(
      describeOverrides({ mode: "train", cost: { amount: 32, currency: "EUR" }, bookingRef: "ABC123" }),
    ).toBe("You set the mode, cost and booking reference on this hop");
  });
});
