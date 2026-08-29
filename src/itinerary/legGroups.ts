// ============================================================
// Which derived legs belong to which destination.
//
// `deriveLegs()` returns one flat array for the whole trip, because
// that is what the map and the cost rollup want. The list wants the
// opposite: a destination-first panel shows the journey to Lisbon
// directly above the Lisbon card, and the journey to Porto above the
// Porto card. So the flat run has to be cut back into the chains it
// was built from.
//
// WHY NOT RECOMPUTE THE CHAIN LENGTHS FROM THE `RouteMap`: that means
// restating `deriveLegs`'s rules here — the same-place skip, the
// empty-chain placeholder — in a second place that can drift from the
// first. Instead this walks the legs it was handed and cuts each chain
// where it ARRIVES at the destination, which is true by construction:
// a chain from A to B ends at B whatever the engine put in between.
//
// It is also deliberately defensive. If the legs don't line up with
// the destinations (a stale array mid-render, a malformed `RouteMap`
// whose chain starts somewhere else), the misaligned destination gets
// no legs rather than someone else's — a card with nothing above it
// is a blank, but a card with the wrong journey above it is a lie.
// ============================================================

import type { Leg, Trip } from "../model/trip";

/**
 * Legs keyed by the id of the destination they arrive at.
 *
 * Keyed by DESTINATION, not by index or leg id, for the same reason
 * `ItineraryGap` is: indices move when you drag a card, and a chain's
 * leg ids repeat when a trip visits the same pair twice.
 */
export function legsByDestination(trip: Trip, legs: Leg[]): Map<string, Leg[]> {
  const groups = new Map<string, Leg[]>();
  let cursor = 0;

  for (let i = 0; i < trip.destinations.length; i++) {
    const destination = trip.destinations[i];
    const previous = trip.destinations[i - 1];
    const from = previous ? previous.place : trip.origin;
    const to = destination.place;

    groups.set(destination.id, []);

    // "Lisbon, then Lisbon" produces no journey at all — `deriveLegs`
    // skips it, so there is nothing here to consume.
    if (from.id === to.id) continue;

    // The chain must start where the previous destination left off.
    // If it doesn't, the arrays disagree about the trip; stop
    // attributing rather than guess.
    if (legs[cursor]?.from.id !== from.id) continue;

    const start = cursor;
    const chain: Leg[] = [];
    while (cursor < legs.length) {
      const leg = legs[cursor++];
      chain.push(leg);
      if (leg.to.id === to.id) break;
    }

    // Ran off the end without ever arriving: the same disagreement as
    // above, caught at the other end. Rewind so the legs stay
    // available to whichever destination they really belong to.
    if (chain.at(-1)?.to.id !== to.id) {
      cursor = start;
      continue;
    }

    groups.set(destination.id, chain);
  }

  return groups;
}
