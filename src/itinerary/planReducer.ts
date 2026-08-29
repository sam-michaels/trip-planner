// ============================================================
// Every edit a destination-first trip can receive.
//
// TODO(unit-7): this is a bridge, and it is meant to be absorbed.
// `tripReducer.ts` still speaks the old leg vocabulary — add-leg,
// move-leg, an undo slot holding a `Leg[]` — which a panel built on
// destinations has nothing to say to, and it belongs to another unit
// this wave. So the destination vocabulary lives here, in the shape
// the panel actually dispatches, and Unit 7 can lift it wholesale
// into `tripReducer` (or rename this file to it) without the UI
// changing a line.
//
// WHY THE STATE IS JUST THE TRIP: the old state parked a derived
// `Leg[]` beside it, which meant every leg edit wrote to a copy that
// nothing re-derived — booking a train survived exactly until
// something recomputed. Legs are derived at the top of the render
// from `trip.destinations` now, so there is only one place a fact can
// live, and `hopOverrides` is where anything the user says about a
// hop goes.
//
// WHY UNDO HOLDS A WHOLE TRIP: it holds the one thing that is cheap
// to snapshot and impossible to reconstruct. A removed destination
// takes its nights, its notes and its status with it, and a trip is
// a handful of objects — copying it is cheaper than the bookkeeping
// needed to reverse each action individually.
// ============================================================

import type {
  Destination,
  HopId,
  HopOverride,
  Place,
  PlanStatus,
  Trip,
} from "../model/trip";

export interface PlanState {
  trip: Trip;
  /**
   * One slot, offered only for edits that can lose work you didn't
   * explicitly type. Reordering doesn't fill it — you can see what
   * moved, and it moved because you dragged it.
   */
  undo?: { trip: Trip; note: string };
}

/**
 * What can change about a destination once it exists.
 *
 * `place` and `id` are absent on purpose: changing where a
 * destination *is* makes it a different destination (and orphans the
 * hop overrides either side of it), so that's a remove and an add.
 *
 * Every field is optional AND nullable-by-omission in the same
 * breath, which is the subtlety worth naming: the patch is applied by
 * spread, so `{ nights: undefined }` genuinely clears the night count
 * while `{}` leaves it alone. "I no longer know how long" has to be
 * expressible — it's the state most destinations start in.
 */
export interface DestinationPatch {
  nights?: number;
  arrival?: string;
  status?: PlanStatus;
  notes?: string;
}

export type PlanAction =
  | { type: "set-origin"; place: Place }
  | { type: "add-destination"; destination: Destination; atIndex?: number }
  | { type: "remove-destination"; destinationId: string }
  /** `toIndex` is the FINAL index — where the card ends up. */
  | { type: "move-destination"; destinationId: string; toIndex: number }
  | {
      type: "update-destination";
      destinationId: string;
      patch: DestinationPatch;
    }
  | { type: "set-hop-override"; hop: HopId; override?: HopOverride }
  | { type: "undo" }
  | { type: "dismiss-undo" };

export function planReducer(state: PlanState, action: PlanAction): PlanState {
  const { trip } = state;

  switch (action.type) {
    case "set-origin":
      return { trip: { ...trip, origin: action.place } };

    case "add-destination": {
      const destinations = [...trip.destinations];
      const at = action.atIndex ?? destinations.length;
      destinations.splice(clamp(at, 0, destinations.length), 0, action.destination);
      return { trip: { ...trip, destinations } };
    }

    case "remove-destination": {
      const removed = trip.destinations.find(
        (d) => d.id === action.destinationId,
      );
      if (!removed) return state;

      // Overrides for the hops either side of it are deliberately left
      // alone. They're keyed by place pair, so they cost nothing while
      // unused and come back correct if the destination does — see the
      // HOP IDENTITY banner in model/trip.ts.
      return {
        trip: {
          ...trip,
          destinations: trip.destinations.filter(
            (d) => d.id !== action.destinationId,
          ),
        },
        undo: { trip, note: `Removed ${removed.place.city}.` },
      };
    }

    case "move-destination": {
      const from = trip.destinations.findIndex(
        (d) => d.id === action.destinationId,
      );
      if (from === -1) return state;

      const to = clamp(action.toIndex, 0, trip.destinations.length - 1);
      if (to === from) return state;

      // The whole reorder: lift it out, put it back in. No date is
      // read and none is written — that was the old model's tax for
      // deriving order from `departure`, and the point of making order
      // explicit was to stop paying it.
      const destinations = [...trip.destinations];
      const [moved] = destinations.splice(from, 1);
      destinations.splice(to, 0, moved);

      return { trip: { ...trip, destinations } };
    }

    case "update-destination":
      return {
        trip: {
          ...trip,
          destinations: trip.destinations.map((d) =>
            d.id === action.destinationId ? { ...d, ...action.patch } : d,
          ),
        },
      };

    case "set-hop-override": {
      const hopOverrides = { ...trip.hopOverrides };
      if (action.override === undefined) {
        delete hopOverrides[action.hop];
      } else {
        hopOverrides[action.hop] = action.override;
      }
      return { trip: { ...trip, hopOverrides } };
    }

    case "undo":
      return state.undo ? { trip: state.undo.trip } : state;

    case "dismiss-undo":
      return state.undo ? { trip: state.trip } : state;
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, max));
}
