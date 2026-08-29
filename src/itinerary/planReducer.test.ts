import { describe, expect, it } from "vitest";

import type { Trip } from "../model/trip";
import { sampleTrip } from "../model/trip";
import { planReducer } from "./planReducer";

const start = { trip: sampleTrip };
const cities = (trip: Trip) => trip.destinations.map((d) => d.place.city);

describe("planReducer", () => {
  it("reorders by splice and writes no dates", () => {
    const next = planReducer(start, {
      type: "move-destination",
      destinationId: "dest-porto",
      toIndex: 0,
    });

    expect(cities(next.trip)).toEqual(["Porto", "Lisbon"]);
    // The whole point of explicit order: nothing had to be invented to
    // hold the new position.
    expect(next.trip.destinations.every((d) => d.arrival === undefined)).toBe(
      true,
    );
    expect(next.undo).toBeUndefined();
  });

  it("clamps a nudge off the end instead of dropping the destination", () => {
    const next = planReducer(start, {
      type: "move-destination",
      destinationId: "dest-porto",
      toIndex: 7,
    });

    expect(cities(next.trip)).toEqual(["Lisbon", "Porto"]);
  });

  it("clears a night count when the patch says undefined", () => {
    const next = planReducer(start, {
      type: "update-destination",
      destinationId: "dest-lisbon",
      patch: { nights: undefined },
    });

    expect(next.trip.destinations[0].nights).toBeUndefined();
    // "I don't know" is a value, so the destination is otherwise intact.
    expect(next.trip.destinations[0].status).toBe("idea");
  });

  it("leaves untouched fields alone", () => {
    const next = planReducer(start, {
      type: "update-destination",
      destinationId: "dest-porto",
      patch: { status: "booked" },
    });

    expect(next.trip.destinations[1].status).toBe("booked");
    expect(next.trip.destinations[1].nights).toBe(4);
    expect(next.trip.destinations[1].notes).toBe(
      sampleTrip.destinations[1].notes,
    );
  });

  it("offers an undo after a removal, and restores the whole destination", () => {
    const removed = planReducer(start, {
      type: "remove-destination",
      destinationId: "dest-porto",
    });

    expect(cities(removed.trip)).toEqual(["Lisbon"]);
    expect(removed.undo?.note).toContain("Porto");

    const restored = planReducer(removed, { type: "undo" });
    expect(restored.trip.destinations[1]).toEqual(
      sampleTrip.destinations[1],
    );
    expect(restored.undo).toBeUndefined();
  });

  it("adds and clears hop overrides by hop id", () => {
    const set = planReducer(start, {
      type: "set-hop-override",
      hop: "lisbon->porto",
      override: { mode: "train", cost: { amount: 32, currency: "EUR" } },
    });

    expect(set.trip.hopOverrides["lisbon->porto"].mode).toBe("train");
    // Not mutated in place — the map the map component diffs by
    // identity has to be a new object.
    expect(set.trip.hopOverrides).not.toBe(sampleTrip.hopOverrides);

    const cleared = planReducer(set, {
      type: "set-hop-override",
      hop: "lisbon->porto",
    });
    expect("lisbon->porto" in cleared.trip.hopOverrides).toBe(false);
  });

  it("inserts a destination at a position, or appends without one", () => {
    const madrid = {
      id: "dest-madrid",
      place: sampleTrip.destinations[0].place,
      status: "idea" as const,
    };

    expect(
      planReducer(start, {
        type: "add-destination",
        destination: madrid,
        atIndex: 0,
      }).trip.destinations[0].id,
    ).toBe("dest-madrid");

    expect(
      planReducer(start, { type: "add-destination", destination: madrid }).trip
        .destinations.at(-1)?.id,
    ).toBe("dest-madrid");
  });
});
