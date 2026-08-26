// ============================================================
// Dragging a leg to a new position.
//
// TODO(wave-2): this whole file is on borrowed time. It exists because
// legs used to BE the trip and had no `order` field, so a drop had to
// be expressed as an edit to `departure`. Destinations are the spine
// now and they carry explicit order, so reordering is a splice and
// none of the date-rewriting below is needed. It survives here,
// operating on a plain `Leg[]` the shell keeps in reducer state, only
// so the existing leg editor keeps compiling until the panel is
// rebuilt around destinations.
//
// THE TENSION THIS FILE RESOLVED: legs had no `order` field — order
// was derived from `departure` ("derive, don't store"). But while a
// trip is still being sketched almost nothing has a date, and being
// unable to rearrange it is miserable.
//
// So a drop is interpreted as a statement about order, and this file
// works out the smallest edit that makes `orderedLegs()` agree with
// it. Two rules keep that from becoming unpredictable:
//
//   1. ONLY THE DRAGGED LEG IS EVER EDITED. A drop never reaches
//      sideways and shifts a leg you didn't touch. If a position
//      can't be reached by editing the dragged leg alone, nothing
//      changes at all.
//   2. EVERY EDIT IS REPORTED. `MoveResult.note` says exactly what was
//      written, so the UI can show it with an undo instead of quietly
//      altering a date the user typed.
//
// The common case costs nothing: while every leg is undated, order is
// simply array order, and dragging rewrites no dates at all.
// ============================================================

import type { Leg } from "../model/trip";
import { formatDateTime, midpoint, shiftHours, toMillis } from "./datetime";
import { legLabel } from "./labels";

export interface MoveResult {
  legs: Leg[];
  /**
   * Present only when the move rewrote the dragged leg's times.
   * `undefined` means the move was pure reordering — nothing to undo,
   * nothing to warn about.
   */
  note?: string;
}

/**
 * How far to step off a neighbour's time when there's only a bound on
 * one side. Two hours is short enough to stay the same day for an
 * evening arrival, and long enough to read as a deliberate placeholder
 * rather than a real departure time someone chose.
 */
const NUDGE_HOURS = 2;

/**
 * Move `legId` to `toIndex` within the trip's displayed order.
 *
 * `toIndex` is an index into the *final* list, i.e. where the card
 * ends up, which is what a drop target naturally describes.
 */
export function moveLeg(legs: Leg[], legId: string, toIndex: number): MoveResult {
  const ordered = orderedLegs(legs);
  const fromIndex = ordered.findIndex((leg) => leg.id === legId);
  if (fromIndex === -1) return { legs };

  const target = Math.max(0, Math.min(toIndex, ordered.length - 1));
  if (target === fromIndex) return { legs };

  const dragged = ordered[fromIndex];
  const desired = ordered.filter((leg) => leg.id !== legId);
  desired.splice(target, 0, dragged);

  const rewritten = timesForPosition(dragged, desired, target);

  // Writing `desired` back as the array order is not cosmetic: legs
  // with equal (or absent) departures fall back to array order, since
  // Array.sort is stable. Persisting the order the user dropped into
  // is what makes ties resolve their way instead of arbitrarily.
  const moved = desired.map((leg) =>
    leg.id === legId && rewritten ? rewritten.leg : leg,
  );

  return { legs: moved, note: rewritten?.note };
}

/**
 * TODO(wave-2): delete with the rest of this file.
 *
 * The model used to export this. It doesn't any more — order comes
 * from `Trip.destinations`' array position now, not from dates — but
 * the drag logic below is written entirely in terms of the ordering it
 * produces, so it lives here until that logic goes.
 *
 * Undated legs sort to the end rather than throwing: while a trip is
 * still being sketched, most legs have no date.
 */
export function orderedLegs(legs: Leg[]): Leg[] {
  return [...legs].sort((a, b) => {
    if (!a.departure && !b.departure) return 0;
    if (!a.departure) return 1;
    if (!b.departure) return -1;
    return a.departure.localeCompare(b.departure);
  });
}

interface Rewrite {
  leg: Leg;
  note: string;
}

/**
 * What, if anything, must change about `dragged`'s times for
 * `orderedLegs()` to reproduce `desired`.
 *
 * Recall the shape `orderedLegs()` always produces: dated legs sorted
 * by departure, then undated legs in array order. So the legs around
 * the drop point are already partitioned — everything dated comes
 * before everything undated — and only three questions matter: is
 * there a dated leg after the drop point, is there one before it, and
 * is the dragged leg itself dated.
 */
function timesForPosition(
  dragged: Leg,
  desired: Leg[],
  target: number,
): Rewrite | undefined {
  const before = desired.slice(0, target);
  const after = desired.slice(target + 1);

  const lower = lastDated(before)?.departure;
  const upper = firstDated(after)?.departure;
  const landingAmongUndated = before.some((leg) => !leg.departure);

  if (upper) {
    // A dated leg follows, so the dragged leg must be dated too and
    // must fall at or before that leg's departure.
    if (
      dragged.departure &&
      toMillis(dragged.departure) <= toMillis(upper) &&
      (!lower || toMillis(dragged.departure) >= toMillis(lower))
    ) {
      return undefined; // Already in range; array order settles any tie.
    }

    const departure = lower ? midpoint(lower, upper) : shiftHours(upper, -NUDGE_HOURS);
    return withDeparture(dragged, departure);
  }

  // Nothing dated after the drop point: the tail of the list.
  if (!dragged.departure) return undefined; // Undated leg in the undated tail — array order is enough.

  if (landingAmongUndated) {
    // A dated leg can never sort after an undated one, so holding this
    // position means giving up the date. Destructive, hence reported
    // loudly — this is the one move that loses information.
    const { departure: _departure, arrival: _arrival, ...rest } = dragged;
    return {
      leg: rest,
      note: `Cleared the departure and arrival on ${legLabel(dragged)} — undated legs sort to the end, so it couldn't keep a time and that position.`,
    };
  }

  if (lower && toMillis(dragged.departure) < toMillis(lower)) {
    return withDeparture(dragged, shiftHours(lower, NUDGE_HOURS));
  }

  return undefined;
}

/**
 * Apply a new departure, carrying the arrival with it.
 *
 * WHY THE ARRIVAL MOVES TOO: a leg whose arrival predates its
 * departure is nonsense, and silently leaving one behind produces
 * exactly that. Shifting by the same delta preserves the journey
 * length the user actually entered.
 */
function withDeparture(leg: Leg, departure: string): Rewrite {
  const previous = leg.departure;
  const arrival = shiftedArrival(leg, previous, departure);

  return {
    leg: { ...leg, departure, arrival },
    note: previous
      ? `Moved the departure on ${legLabel(leg)} to ${formatDateTime(departure)} to hold that position.`
      : `Set a departure of ${formatDateTime(departure)} on ${legLabel(leg)} — it needed one to sit between two dated legs.`,
  };
}

function shiftedArrival(
  leg: Leg,
  previousDeparture: string | undefined,
  nextDeparture: string,
): string | undefined {
  if (!leg.arrival) return undefined;

  if (previousDeparture) {
    const delta = toMillis(nextDeparture) - toMillis(previousDeparture);
    return shiftHours(leg.arrival, delta / 3_600_000);
  }

  // An arrival with no departure is unusual (half-filled form). Keep it
  // if it still makes sense after the move, drop it if it doesn't.
  return toMillis(leg.arrival) >= toMillis(nextDeparture) ? leg.arrival : undefined;
}

function lastDated(legs: Leg[]): Leg | undefined {
  for (let i = legs.length - 1; i >= 0; i--) {
    if (legs[i].departure) return legs[i];
  }
  return undefined;
}

function firstDated(legs: Leg[]): Leg | undefined {
  return legs.find((leg) => leg.departure);
}
