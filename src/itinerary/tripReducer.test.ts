// ============================================================
// The reducer is the only place a trip changes, and it is pure, so
// this is where the cheapest and most valuable tests in the app live.
//
// Three of these guard bugs that were REAL, not hypothetical:
//
//   * "a move rewrites no dates" — the previous drag implementation
//     had to edit the dragged item's departure to make a date-sort
//     agree with the drop, and could silently clear a time you'd typed.
//   * "an override survives a reorder" — the entire argument for
//     keying overrides by place pair instead of by index. The assertion
//     that matters is that the hop lands at a DIFFERENT index and
//     still carries its booking, because an index-keyed store passes
//     any test where the index happens not to move.
//   * "a `#2` leg id resolves to the un-suffixed hop" — an override
//     written under `lisbon->porto#2` is a key `deriveLegs` never
//     reads, so the edit looks saved and isn't.
//
// Assertions go through `deriveLegs` wherever the question is "did
// this survive?", because surviving a re-derivation is the whole point
// and asserting on `hopOverrides` directly would not prove it.
// ============================================================

import { describe, expect, it } from "vitest";

import type {
  Destination,
  ModeGuess,
  Place,
  RouteMap,
  Trip,
} from "../model/trip";
import { coords, deriveLegs, hopId } from "../model/trip";
import { hopIdOfLeg, tripReducer, type TripState } from "./tripReducer";

// ---------- Fixtures ----------

const place = (id: string, city: string, lng: number, lat: number): Place => ({
  id,
  name: city,
  city,
  country: "PT",
  coords: coords(lng, lat),
});

const HOME = place("home", "London", -81.2497, 42.9849);
const LISBON = place("lisbon", "Lisbon", -9.1393, 38.7223);
const PORTO = place("porto", "Porto", -8.6291, 41.1579);
const SEVILLE = place("seville", "Seville", -5.9845, 37.3891);

const destination = (id: string, at: Place, extra: Partial<Destination> = {}) =>
  ({ id, place: at, status: "idea", ...extra }) satisfies Destination;

function trip(destinations: Destination[], overrides: Trip["hopOverrides"] = {}): Trip {
  return {
    id: "test-trip",
    title: "Test",
    travellers: 2,
    homeCurrency: "CAD",
    origin: HOME,
    destinations,
    hopOverrides: overrides,
    stays: [],
    activities: [],
  };
}

const stateOf = (t: Trip): TripState => ({ trip: t });

/** No route engine in this worktree; `deriveLegs` degrades to one hop per pair. */
const NO_ROUTES: RouteMap = new Map();
const guess: ModeGuess = () => "train";

const legIds = (t: Trip, routes: RouteMap = NO_ROUTES) =>
  deriveLegs(t, routes, guess).map((leg) => leg.id);

const cityOrder = (t: Trip) => t.destinations.map((d) => d.place.city);

// ---------- Destinations ----------

describe("add-destination", () => {
  it("appends with no index", () => {
    const next = tripReducer(stateOf(trip([destination("a", LISBON)])), {
      type: "add-destination",
      destination: destination("b", PORTO),
    });

    expect(cityOrder(next.trip)).toEqual(["Lisbon", "Porto"]);
  });

  it("inserts at an index", () => {
    const next = tripReducer(
      stateOf(trip([destination("a", LISBON), destination("b", PORTO)])),
      {
        type: "add-destination",
        destination: destination("c", SEVILLE),
        atIndex: 1,
      },
    );

    expect(cityOrder(next.trip)).toEqual(["Lisbon", "Seville", "Porto"]);
  });

  it("clamps an out-of-range index rather than leaving a hole", () => {
    const next = tripReducer(stateOf(trip([destination("a", LISBON)])), {
      type: "add-destination",
      destination: destination("b", PORTO),
      atIndex: 99,
    });

    expect(next.trip.destinations).toHaveLength(2);
    expect(cityOrder(next.trip)).toEqual(["Lisbon", "Porto"]);
  });
});

describe("move-destination", () => {
  const dated = trip([
    destination("a", LISBON, { arrival: "2026-09-12T14:00", nights: 4 }),
    destination("b", PORTO, { arrival: "2026-09-16T09:30", nights: 3 }),
    destination("c", SEVILLE, { arrival: "2026-09-19T18:00" }),
  ]);

  it("is a pure splice", () => {
    const next = tripReducer(stateOf(dated), {
      type: "move-destination",
      destinationId: "c",
      toIndex: 0,
    });

    expect(cityOrder(next.trip)).toEqual(["Seville", "Lisbon", "Porto"]);
  });

  it("rewrites no dates — the destinations come through byte-identical", () => {
    const next = tripReducer(stateOf(dated), {
      type: "move-destination",
      destinationId: "c",
      toIndex: 0,
    });

    // Same objects, not merely equal ones: the old drag code produced
    // a *copy* with an edited departure, so identity is the sharper
    // assertion.
    for (const before of dated.destinations) {
      expect(next.trip.destinations).toContain(before);
    }
    expect(next.trip.destinations.map((d) => d.arrival)).toEqual([
      "2026-09-19T18:00",
      "2026-09-12T14:00",
      "2026-09-16T09:30",
    ]);
  });

  it("offers no undo — nothing was lost that wasn't visible", () => {
    const next = tripReducer(stateOf(dated), {
      type: "move-destination",
      destinationId: "c",
      toIndex: 0,
    });

    expect(next.undo).toBeUndefined();
  });

  it("does not mutate the previous state", () => {
    tripReducer(stateOf(dated), {
      type: "move-destination",
      destinationId: "c",
      toIndex: 0,
    });

    expect(cityOrder(dated)).toEqual(["Lisbon", "Porto", "Seville"]);
  });

  it("clamps an index past the end", () => {
    const next = tripReducer(stateOf(dated), {
      type: "move-destination",
      destinationId: "a",
      toIndex: 99,
    });

    expect(cityOrder(next.trip)).toEqual(["Porto", "Seville", "Lisbon"]);
  });

  it("is a no-op for an unknown id or a move to the same place", () => {
    const state = stateOf(dated);
    expect(
      tripReducer(state, { type: "move-destination", destinationId: "zz", toIndex: 0 }),
    ).toBe(state);
    expect(
      tripReducer(state, { type: "move-destination", destinationId: "a", toIndex: 0 }),
    ).toBe(state);
  });
});

describe("update-destination", () => {
  const state = stateOf(
    trip([destination("a", LISBON, { nights: 4, notes: "Alfama" })]),
  );

  it("patches only the fields supplied", () => {
    const next = tripReducer(state, {
      type: "update-destination",
      destinationId: "a",
      patch: { status: "booked" },
    });

    expect(next.trip.destinations[0]).toMatchObject({
      nights: 4,
      notes: "Alfama",
      status: "booked",
    });
  });

  it("clears a field set to undefined — 'I don't know any more' is a real edit", () => {
    const next = tripReducer(state, {
      type: "update-destination",
      destinationId: "a",
      patch: { nights: undefined },
    });

    expect("nights" in next.trip.destinations[0]).toBe(false);
  });

  it("never clears status, even when a form sends undefined", () => {
    const next = tripReducer(state, {
      type: "update-destination",
      destinationId: "a",
      patch: { status: undefined, notes: "Bairro Alto" },
    });

    expect(next.trip.destinations[0].status).toBe("idea");
    expect(next.trip.destinations[0].notes).toBe("Bairro Alto");
  });

  it("is a no-op for an unknown id", () => {
    expect(
      tripReducer(state, {
        type: "update-destination",
        destinationId: "zz",
        patch: { nights: 1 },
      }),
    ).toBe(state);
  });

  it("is a no-op when nothing actually changed", () => {
    expect(
      tripReducer(state, {
        type: "update-destination",
        destinationId: "a",
        patch: { nights: 4 },
      }),
    ).toBe(state);
    expect(
      tripReducer(state, {
        type: "update-destination",
        destinationId: "a",
        patch: {},
      }),
    ).toBe(state);
  });
});

describe("a no-op edit does not eat a pending undo", () => {
  // The scenario: the "Removed Lisbon — undo?" toast is up, and a hop
  // editor field re-dispatches its unchanged value on blur.
  const removed = tripReducer(
    { trip: trip([destination("a", LISBON, { nights: 4 }), destination("b", PORTO)]) },
    { type: "remove-destination", destinationId: "b" },
  );

  it("survives an unchanged destination edit", () => {
    const after = tripReducer(removed, {
      type: "update-destination",
      destinationId: "a",
      patch: { nights: 4 },
    });

    expect(after).toBe(removed);
    expect(after.undo).toBeDefined();
  });

  it("survives an unchanged hop-override write", () => {
    const after = tripReducer(removed, {
      type: "set-hop-override",
      hop: hopId(HOME, LISBON),
      patch: { mode: undefined },
    });

    expect(after).toBe(removed);
    expect(after.undo).toBeDefined();
  });
});

describe("set-origin", () => {
  it("re-derives the first leg from the new origin", () => {
    const next = tripReducer(stateOf(trip([destination("a", LISBON)])), {
      type: "set-origin",
      place: SEVILLE,
    });

    expect(legIds(next.trip)).toEqual([hopId(SEVILLE, LISBON)]);
  });

  it("is a no-op when the origin is unchanged", () => {
    const state = stateOf(trip([destination("a", LISBON)]));
    expect(tripReducer(state, { type: "set-origin", place: HOME })).toBe(state);
  });
});

// ---------- Hop overrides ----------

describe("set-hop-override", () => {
  const state = stateOf(trip([destination("a", LISBON), destination("b", PORTO)]));
  const lisbonPorto = hopId(LISBON, PORTO);

  it("reaches the derived leg — the thing the old shim could not do", () => {
    const next = tripReducer(state, {
      type: "set-hop-override",
      hop: lisbonPorto,
      patch: { mode: "bus", cost: { amount: 32, currency: "EUR" } },
    });

    const leg = deriveLegs(next.trip, NO_ROUTES, guess).find(
      (candidate) => candidate.id === lisbonPorto,
    );

    expect(leg?.mode).toBe("bus");
    expect(leg?.cost).toEqual({ amount: 32, currency: "EUR" });
  });

  it("merges onto an existing override instead of replacing it", () => {
    const first = tripReducer(state, {
      type: "set-hop-override",
      hop: lisbonPorto,
      patch: { mode: "bus", operator: "FlixBus" },
    });
    const second = tripReducer(first, {
      type: "set-hop-override",
      hop: lisbonPorto,
      patch: { bookingRef: "QX12" },
    });

    expect(second.trip.hopOverrides[lisbonPorto]).toEqual({
      mode: "bus",
      operator: "FlixBus",
      bookingRef: "QX12",
    });
  });

  it("drops a key patched to undefined rather than storing an empty opinion", () => {
    const set = tripReducer(state, {
      type: "set-hop-override",
      hop: lisbonPorto,
      patch: { mode: "bus", operator: "FlixBus" },
    });
    const cleared = tripReducer(set, {
      type: "set-hop-override",
      hop: lisbonPorto,
      patch: { operator: undefined },
    });

    expect(cleared.trip.hopOverrides[lisbonPorto]).toEqual({ mode: "bus" });
  });

  it("removes the entry entirely once it says nothing", () => {
    const set = tripReducer(state, {
      type: "set-hop-override",
      hop: lisbonPorto,
      patch: { mode: "bus" },
    });
    const emptied = tripReducer(set, {
      type: "set-hop-override",
      hop: lisbonPorto,
      patch: { mode: undefined },
    });

    expect(lisbonPorto in emptied.trip.hopOverrides).toBe(false);
  });

  it("is a no-op when the patch says nothing new", () => {
    const set = tripReducer(state, {
      type: "set-hop-override",
      hop: lisbonPorto,
      patch: { mode: "bus" },
    });

    expect(
      tripReducer(set, {
        type: "set-hop-override",
        hop: lisbonPorto,
        patch: { mode: "bus" },
      }),
    ).toBe(set);
    // Clearing a field that was never set is likewise nothing.
    expect(
      tripReducer(state, {
        type: "set-hop-override",
        hop: lisbonPorto,
        patch: { operator: undefined },
      }),
    ).toBe(state);
  });

  it("does not disturb the neighbouring hop", () => {
    const next = tripReducer(state, {
      type: "set-hop-override",
      hop: lisbonPorto,
      patch: { mode: "bus" },
    });

    expect(Object.keys(next.trip.hopOverrides)).toEqual([lisbonPorto]);
    const legs = deriveLegs(next.trip, NO_ROUTES, guess);
    expect(legs[0].mode).toBe("train"); // home → Lisbon, still the guess
  });
});

describe("clear-hop-override", () => {
  const lisbonPorto = hopId(LISBON, PORTO);
  const state = stateOf(
    trip([destination("a", LISBON), destination("b", PORTO)], {
      [lisbonPorto]: {
        mode: "bus",
        operator: "FlixBus",
        cost: { amount: 32, currency: "EUR" },
      },
    }),
  );

  it("drops the whole override and offers an undo", () => {
    const next = tripReducer(state, {
      type: "clear-hop-override",
      hop: lisbonPorto,
    });

    expect(next.trip.hopOverrides).toEqual({});
    expect(next.undo?.note).toBeTruthy();
    expect(tripReducer(next, { type: "undo" }).trip).toBe(state.trip);
  });

  it("clears named fields only, so a corrected fare survives a mode reset", () => {
    const next = tripReducer(state, {
      type: "clear-hop-override",
      hop: lisbonPorto,
      fields: ["mode", "operator"],
    });

    expect(next.trip.hopOverrides[lisbonPorto]).toEqual({
      cost: { amount: 32, currency: "EUR" },
    });

    const leg = deriveLegs(next.trip, NO_ROUTES, guess).find(
      (candidate) => candidate.id === lisbonPorto,
    );
    expect(leg?.mode).toBe("train"); // back to the engine's guess
    expect(leg?.cost).toEqual({ amount: 32, currency: "EUR" });
  });

  it("is a no-op when there is nothing to clear", () => {
    expect(
      tripReducer(state, { type: "clear-hop-override", hop: hopId(HOME, LISBON) }),
    ).toBe(state);
    expect(
      tripReducer(state, {
        type: "clear-hop-override",
        hop: lisbonPorto,
        fields: ["bookingRef"],
      }),
    ).toBe(state);
  });
});

// ---------- The two things the whole design exists for ----------

describe("overrides are keyed by journey, not by position", () => {
  const lisbonPorto = hopId(LISBON, PORTO);

  const booked = tripReducer(
    stateOf(
      trip([
        destination("a", LISBON),
        destination("b", PORTO),
        destination("c", SEVILLE),
      ]),
    ),
    {
      type: "set-hop-override",
      hop: lisbonPorto,
      patch: {
        mode: "train",
        bookingRef: "CP-8841",
        cost: { amount: 24, currency: "EUR" },
      },
    },
  );

  it("keeps the booking when the hop moves to a different index", () => {
    const before = legIds(booked.trip);
    expect(before.indexOf(lisbonPorto)).toBe(1);

    // Seville first: [Seville, Lisbon, Porto]. Lisbon → Porto is still
    // in the trip, but it is now the last hop rather than the middle one.
    const moved = tripReducer(booked, {
      type: "move-destination",
      destinationId: "c",
      toIndex: 0,
    });

    const after = legIds(moved.trip);
    expect(after.indexOf(lisbonPorto)).toBe(2);
    expect(after.indexOf(lisbonPorto)).not.toBe(before.indexOf(lisbonPorto));

    const leg = deriveLegs(moved.trip, NO_ROUTES, guess)[2];
    expect(leg.bookingRef).toBe("CP-8841");
    expect(leg.cost).toEqual({ amount: 24, currency: "EUR" });
  });

  it("leaves the override behind, harmlessly, when the hop stops existing", () => {
    // Porto to the front breaks Lisbon → Porto apart entirely.
    const moved = tripReducer(booked, {
      type: "move-destination",
      destinationId: "b",
      toIndex: 0,
    });

    expect(legIds(moved.trip)).not.toContain(lisbonPorto);
    // Still stored, so undoing the drag brings the booking back with it.
    expect(moved.trip.hopOverrides[lisbonPorto]?.bookingRef).toBe("CP-8841");
  });
});

describe("repeated hops share one override", () => {
  // Lisbon → Porto on the way up, and again after a detour to Seville.
  const there = trip([
    destination("a", LISBON),
    destination("b", PORTO),
    destination("c", SEVILLE),
    destination("d", LISBON),
    destination("e", PORTO),
  ]);
  const lisbonPorto = hopId(LISBON, PORTO);

  it("gives the second occurrence a suffixed leg id", () => {
    expect(legIds(there)).toContain(`${lisbonPorto}#2`);
  });

  it("maps a suffixed leg id back to the un-suffixed hop id", () => {
    expect(hopIdOfLeg(`${lisbonPorto}#2`)).toBe(lisbonPorto);
    expect(hopIdOfLeg(`${lisbonPorto}#17`)).toBe(lisbonPorto);
    // Already a HopId: unchanged, so callers needn't know which they hold.
    expect(hopIdOfLeg(lisbonPorto)).toBe(lisbonPorto);
  });

  it("writes an edit made on the #2 card under the shared key", () => {
    const next = tripReducer(stateOf(there), {
      type: "set-hop-override",
      hop: `${lisbonPorto}#2`,
      patch: { operator: "CP", cost: { amount: 24, currency: "EUR" } },
    });

    expect(Object.keys(next.trip.hopOverrides)).toEqual([lisbonPorto]);

    // And both occurrences pick it up — same journey, same booking.
    const legs = deriveLegs(next.trip, NO_ROUTES, guess).filter(
      (leg) => hopIdOfLeg(leg.id) === lisbonPorto,
    );
    expect(legs).toHaveLength(2);
    expect(legs.every((leg) => leg.operator === "CP")).toBe(true);
  });

  it("clears from the #2 card too", () => {
    const set = tripReducer(stateOf(there), {
      type: "set-hop-override",
      hop: lisbonPorto,
      patch: { operator: "CP" },
    });
    const cleared = tripReducer(set, {
      type: "clear-hop-override",
      hop: `${lisbonPorto}#2`,
    });

    expect(cleared.trip.hopOverrides).toEqual({});
  });
});

// ---------- Undo ----------

describe("undo", () => {
  const original = trip([
    destination("a", LISBON, { nights: 4, notes: "Alfama" }),
    destination("b", PORTO, { nights: 3 }),
  ]);

  it("round-trips a removed destination, notes and all", () => {
    const removed = tripReducer(stateOf(original), {
      type: "remove-destination",
      destinationId: "a",
    });

    expect(cityOrder(removed.trip)).toEqual(["Porto"]);
    expect(removed.undo?.note).toContain("Lisbon");

    const restored = tripReducer(removed, { type: "undo" });
    expect(restored.trip).toBe(original);
    expect(restored.trip.destinations[0]).toEqual(original.destinations[0]);
    expect(restored.undo).toBeUndefined();
  });

  it("is not offered for edits you can see yourself making", () => {
    const state = stateOf(original);

    expect(
      tripReducer(state, {
        type: "update-destination",
        destinationId: "a",
        patch: { nights: 5 },
      }).undo,
    ).toBeUndefined();
    expect(
      tripReducer(state, {
        type: "add-destination",
        destination: destination("c", SEVILLE),
      }).undo,
    ).toBeUndefined();
  });

  it("is dropped by the next edit, so it can never revert unrelated work", () => {
    const removed = tripReducer(stateOf(original), {
      type: "remove-destination",
      destinationId: "a",
    });
    const thenEdited = tripReducer(removed, {
      type: "update-destination",
      destinationId: "b",
      patch: { nights: 6 },
    });

    expect(thenEdited.undo).toBeUndefined();
    // The later edit stands; undo is inert rather than destructive.
    expect(tripReducer(thenEdited, { type: "undo" })).toBe(thenEdited);
    expect(thenEdited.trip.destinations[0].nights).toBe(6);
  });

  it("dismisses without changing the trip", () => {
    const removed = tripReducer(stateOf(original), {
      type: "remove-destination",
      destinationId: "a",
    });
    const dismissed = tripReducer(removed, { type: "dismiss-undo" });

    expect(dismissed.undo).toBeUndefined();
    expect(dismissed.trip).toBe(removed.trip);
  });

  it("does nothing when there is nothing to undo", () => {
    const state = stateOf(original);
    expect(tripReducer(state, { type: "undo" })).toBe(state);
    expect(tripReducer(state, { type: "dismiss-undo" })).toBe(state);
  });

  it("is a no-op when removing an id that isn't there", () => {
    const state = stateOf(original);
    expect(
      tripReducer(state, { type: "remove-destination", destinationId: "zz" }),
    ).toBe(state);
  });
});

// ---------- Routes are an input, never state ----------

describe("a real RouteMap changes nothing about the reducer", () => {
  const LIS_AIRPORT = place("lis-airport", "Lisbon", -9.1359, 38.7756);
  const OPO_AIRPORT = place("opo-airport", "Porto", -8.6814, 41.2481);

  const routes: RouteMap = new Map([
    [
      hopId(LISBON, PORTO),
      [
        { from: LISBON, to: LIS_AIRPORT, mode: "bus" as const },
        { from: LIS_AIRPORT, to: OPO_AIRPORT, mode: "flight" as const },
        { from: OPO_AIRPORT, to: PORTO, mode: "bus" as const },
      ],
    ],
  ]);

  it("overrides one hop of a chain without disturbing the others", () => {
    const airportBus = hopId(LISBON, LIS_AIRPORT);

    const next = tripReducer(
      stateOf(trip([destination("a", LISBON), destination("b", PORTO)])),
      {
        type: "set-hop-override",
        hop: airportBus,
        patch: { mode: "train", cost: { amount: 2, currency: "EUR" } },
      },
    );

    const legs = deriveLegs(next.trip, routes, guess);
    expect(legs.find((leg) => leg.id === airportBus)?.mode).toBe("train");
    // The flight is untouched — the point of keying by individual hop.
    expect(legs.find((leg) => leg.id === hopId(LIS_AIRPORT, OPO_AIRPORT))?.mode).toBe(
      "flight",
    );
  });

  it("survives the route engine arriving after the edit was made", () => {
    // Edited against no routes at all, then re-derived with a chain.
    const airportBus = hopId(LISBON, LIS_AIRPORT);
    const edited = tripReducer(
      stateOf(trip([destination("a", LISBON), destination("b", PORTO)])),
      { type: "set-hop-override", hop: airportBus, patch: { bookingRef: "AB-1" } },
    );

    expect(legIds(edited.trip)).not.toContain(airportBus); // not derivable yet
    expect(
      deriveLegs(edited.trip, routes, guess).find((leg) => leg.id === airportBus)
        ?.bookingRef,
    ).toBe("AB-1");
  });
});
