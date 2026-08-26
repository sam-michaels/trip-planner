// ============================================================
// All trip edits funnel through here.
//
// A reducer rather than scattered `useState` calls because several of
// these actions are not simple field writes — moving a leg can rewrite
// a departure, and adding one into a gap is "append, then move". Those
// belong in one place with a name, not inlined in a click handler.
//
// Still plain `useReducer` on a single `Trip`, per the README: no
// store library until there's a demonstrated need for one.
// ============================================================

import type { Leg, Trip } from "../model/trip";
import { legLabel } from "./labels";
import { moveLeg } from "./reorder";

export interface TripState {
  trip: Trip;
  /**
   * One-slot undo, offered only for the two actions that can lose work
   * you didn't explicitly type: a drag that rewrote a date, and a
   * delete. Ordinary field edits don't fill this — you can see what you
   * changed, and an undo prompt after every keystroke is just noise.
   */
  undo?: { trip: Trip; note: string };
}

export type TripAction =
  | { type: "add-leg"; leg: Leg; atIndex?: number }
  | { type: "update-leg"; leg: Leg }
  | { type: "remove-leg"; legId: string }
  | { type: "move-leg"; legId: string; toIndex: number }
  | { type: "undo" }
  | { type: "dismiss-undo" };

export function tripReducer(state: TripState, action: TripAction): TripState {
  switch (action.type) {
    case "add-leg": {
      const withLeg: Trip = {
        ...state.trip,
        legs: [...state.trip.legs, action.leg],
      };

      // Adding into a gap means "put it here", which is the same
      // question a drag asks — so it gets the same answer, including
      // any date the position implies.
      if (action.atIndex === undefined) {
        return { trip: withLeg };
      }

      const moved = moveLeg(withLeg, action.leg.id, action.atIndex);
      return {
        trip: moved.trip,
        undo: moved.note ? { trip: withLeg, note: moved.note } : undefined,
      };
    }

    case "update-leg":
      return {
        trip: {
          ...state.trip,
          legs: state.trip.legs.map((leg) =>
            leg.id === action.leg.id ? action.leg : leg,
          ),
        },
      };

    case "remove-leg": {
      const removed = state.trip.legs.find((leg) => leg.id === action.legId);
      if (!removed) return state;

      return {
        trip: {
          ...state.trip,
          legs: state.trip.legs.filter((leg) => leg.id !== action.legId),
        },
        undo: { trip: state.trip, note: `Removed ${legLabel(removed)}.` },
      };
    }

    case "move-leg": {
      const moved = moveLeg(state.trip, action.legId, action.toIndex);
      return {
        trip: moved.trip,
        // No note means the move was pure reordering — nothing was
        // written that needs taking back.
        undo: moved.note ? { trip: state.trip, note: moved.note } : undefined,
      };
    }

    case "undo":
      return state.undo ? { trip: state.undo.trip } : state;

    case "dismiss-undo":
      return state.undo ? { trip: state.trip } : state;
  }
}

export function newId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}
