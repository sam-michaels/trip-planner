// ============================================================
// All trip edits funnel through here.
//
// WHAT CHANGED, AND WHY IT MATTERED: this reducer used to keep a
// `legs: Leg[]` alongside the trip, derived once at mount, and every
// leg action wrote only to that array. Nothing reached
// `trip.hopOverrides`, so the moment anything re-derived — a real
// `RouteMap` arriving, a destination being added — every price,
// booking reference and time the user had typed vanished. Wave 1
// shipped it knowingly, with a TODO saying wave 2 must fix it first.
// This is that fix.
//
// THE RULE NOW: `legs` are not state. They are `deriveLegs(trip,
// routes, guess)`, recomputed by whoever renders them, and the reducer
// stores only the two things a derivation cannot invent —
// `trip.destinations` (where you want to be, in what order) and
// `trip.hopOverrides` (what you said about a hop that the engine
// didn't know). Every action below is therefore one of exactly two
// kinds: a destination edit, or a `HopOverride` write. If an action
// can't be expressed as one of those, it is asking to store a derived
// value and the answer is no.
//
// Still plain `useReducer` on a single `Trip`, per the README: no
// store library until there's a demonstrated need for one.
//
// TODO(unit-8): THE TREE DOES NOT COMPILE OR BOOT UNTIL YOUR REWRITE
// LANDS, and that is deliberate rather than an oversight — the two
// callers are yours, they are being replaced wholesale, and patching
// them across the unit boundary would only have to be undone. What
// changed under them:
//
//   * `src/App.tsx` reads `state.legs` and seeds the reducer with
//     `legs: deriveLegs(...)` in its lazy initialiser. `TripState` has
//     no `legs` any more. Derive them in the component body —
//     `deriveLegs(state.trip, routes, defaultMode)`, memoised on
//     `state.trip` — and pass them down to `CostSummary` and
//     `TripMap` as it already does. Deriving once at mount is exactly
//     the bug this unit removed; do not reintroduce it in the shell.
//   * `src/itinerary/ItineraryPanel.tsx` reads `state.legs` and
//     `state.undo.legs`, dispatches the four deleted leg actions, and
//     imports `orderedLegs` from the deleted `./reorder`. See the
//     banner at the top of that file.
// ============================================================

import type {
  Destination,
  HopId,
  HopOverride,
  Place,
  PlanStatus,
  Trip,
} from "../model/trip";

// ============================================================
// LEG IDS ARE NOT ALWAYS HOP IDS
//
// `deriveLegs()` emits `"lisbon->porto"` for the first occurrence of a
// hop and `"lisbon->porto#2"` for the second, because React keys and
// MapLibre feature ids have to be unique within a render. Overrides
// are NOT suffixed: `deriveLegs` looks both occurrences up under the
// same un-suffixed key, because they are the same physical journey and
// what you know about it — the operator, the fare — is true of both.
//
// That means anything turning "the leg the user clicked" into "the
// override to write" must strip the suffix first, and forgetting to is
// a silent bug: the write lands under a key `deriveLegs` never reads,
// so the edit appears to save and then isn't there. One helper, used
// by the reducer and by the hop editor (unit 11), so the stripping
// rule exists in exactly one place.
//
// KNOWN LIMITATION, so it isn't discovered as a mystery: sharing is
// right for the fields that describe the *journey* and wrong for the
// ones that describe a *ticket*. Two Lisbon → Porto trains a week
// apart have one operator but two departure times and two booking
// references, and this key space cannot tell them apart — typing a
// departure on the return card overwrites the outbound's. Fixing that
// means splitting per-occurrence fields out in the model, where the
// key space is defined (`hopOverrides` in model/trip.ts), not here;
// `hopIdOfLeg` is the single place that would need to change, and the
// suffix it discards is exactly the information a fix would need.
// ============================================================

/**
 * Trailing `#` + digits, and only that. Place ids are slugs, so a `#`
 * followed by digits at the very end of a leg id is always an
 * occurrence counter and never part of the underlying hop id.
 */
const OCCURRENCE_SUFFIX = /#\d+$/;

/**
 * The `HopId` a leg's override lives under.
 *
 * Safe to call on something that is already a `HopId` — an id with no
 * occurrence suffix comes back unchanged — so callers never have to
 * know which of the two they're holding.
 */
export function hopIdOfLeg(legId: string): HopId {
  return legId.replace(OCCURRENCE_SUFFIX, "");
}

// ---------- State ----------

export interface TripState {
  trip: Trip;
  /**
   * One-slot undo, snapshotting the whole `Trip`.
   *
   * WHY THE WHOLE TRIP AND NOT A PATCH: the snapshot is taken at the
   * instant of the destructive action and restored wholesale, so it
   * cannot drift out of step with the shape of the thing it restores.
   * A trip is a handful of objects; copying a reference to it costs
   * nothing.
   *
   * WHY IT IS CLEARED BY THE NEXT EDIT (see `edit`): a snapshot
   * taken before a delete stops being "undo the delete" the moment
   * anything else is edited — restoring it would silently throw away
   * the edits that came after. An undo that can only ever take back
   * the thing that just happened is the only kind that's safe to
   * offer without a full history.
   *
   * Offered only for the actions that lose work you didn't just type:
   * removing a destination (which takes its nights, notes and status
   * with it) and clearing a hop override (which takes a fare and a
   * booking reference with it). Ordinary field edits don't fill this —
   * you can see what you changed, and an undo prompt after every
   * keystroke is noise.
   */
  undo?: { trip: Trip; note: string };
}

/**
 * The fields of a destination that are editable in place.
 *
 * `id` and `place` are absent on purpose: changing the place makes it
 * a different destination (remove and add), and changing the id makes
 * it a different row. A key present with the value `undefined` CLEARS
 * that field, which is how "I don't know how many nights any more"
 * gets recorded — see `mergePatch`.
 */
export interface DestinationPatch {
  nights?: number;
  arrival?: string;
  notes?: string;
  /** Never cleared: a destination always has a status. */
  status?: PlanStatus;
}

export type TripAction =
  /**
   * `atIndex` is an INSERTION index, 0..length: "put it between these
   * two". `move-destination` below takes a FINAL index instead, so a
   * drop handler that converted one for the other must not feed the
   * converted value to both — that's the classic off-by-one, and the
   * two actions genuinely want different things.
   */
  | { type: "add-destination"; destination: Destination; atIndex?: number }
  | { type: "remove-destination"; destinationId: string }
  /**
   * A plain array splice. `toIndex` is a FINAL index, 0..length-1 —
   * the position the card ends up occupying.
   */
  | { type: "move-destination"; destinationId: string; toIndex: number }
  | { type: "update-destination"; destinationId: string; patch: DestinationPatch }
  | { type: "set-origin"; place: Place }
  /**
   * Merge `patch` onto whatever override this hop already has.
   * `hop` may be a leg id — the `#2` suffix is stripped for you.
   */
  | { type: "set-hop-override"; hop: string; patch: HopOverride }
  /**
   * Throw the user's opinion away and fall back to the engine's guess.
   * With `fields`, only those; without, the whole override.
   */
  | { type: "clear-hop-override"; hop: string; fields?: (keyof HopOverride)[] }
  | { type: "undo" }
  | { type: "dismiss-undo" };

export function tripReducer(state: TripState, action: TripAction): TripState {
  switch (action.type) {
    case "add-destination": {
      const destinations = [...state.trip.destinations];
      const at =
        action.atIndex === undefined
          ? destinations.length
          : clamp(action.atIndex, 0, destinations.length);

      destinations.splice(at, 0, action.destination);
      return edit(state, { ...state.trip, destinations });
    }

    case "remove-destination": {
      const removed = state.trip.destinations.find(
        (destination) => destination.id === action.destinationId,
      );
      if (!removed) return state;

      // The hop overrides around it are deliberately left alone, and
      // that has a consequence worth stating plainly rather than
      // discovering: they are keyed by place pair, so an override
      // whose hop no longer exists is not deleted, just unreachable —
      // and re-adding the destination RESURRECTS it. Mostly that is
      // the feature (remove Porto by mistake, put it back, your train
      // fare is still there, exactly as it survives a reorder), and it
      // is what lets undo be a clean restore. But a destination you
      // removed because the plan changed comes back carrying a booking
      // reference for a train you cancelled.
      //
      // Pruning here is not the fix — it would empty the snapshot undo
      // restores. TODO: a later unit should either prune orphans at the
      // moment the undo slot is dropped, or have the UI say "restored
      // from your earlier plan" when a re-added hop arrives with an
      // override already on it. Until then `hopOverrides` also grows
      // across a long session of adds and removes, which is harmless at
      // trip scale but is not nothing.
      return edit(
        state,
        {
          ...state.trip,
          destinations: state.trip.destinations.filter(
            (destination) => destination.id !== action.destinationId,
          ),
        },
        `Removed ${removed.place.city}.`,
      );
    }

    case "move-destination": {
      // A SPLICE, AND NOTHING ELSE. Order is array position now (see
      // the banner on `Trip.destinations`), so a drop is fully
      // expressed by moving one element. The old `moveLeg` had to
      // rewrite the dragged leg's departure to make a date-sort agree
      // with the drop — and could destroy a time you'd typed doing it.
      // Explicit order removes the whole problem: no dates are read
      // here, and none are written.
      const from = state.trip.destinations.findIndex(
        (destination) => destination.id === action.destinationId,
      );
      if (from === -1) return state;

      const to = clamp(action.toIndex, 0, state.trip.destinations.length - 1);
      if (to === from) return state;

      const destinations = [...state.trip.destinations];
      const [moved] = destinations.splice(from, 1);
      destinations.splice(to, 0, moved);

      return edit(state, { ...state.trip, destinations });
    }

    case "update-destination": {
      const index = state.trip.destinations.findIndex(
        (destination) => destination.id === action.destinationId,
      );
      if (index === -1) return state;

      const current = state.trip.destinations[index];
      const { status, ...optional } = action.patch;
      const patched = mergePatch(current, optional);
      // Assigned rather than merged so that `status: undefined` — which
      // a form will happily send — can't delete a required field.
      const next = status === undefined ? patched : { ...patched, status };

      if (sameFields(current, next)) return state;

      const destinations = [...state.trip.destinations];
      destinations[index] = next;
      return edit(state, { ...state.trip, destinations });
    }

    case "set-origin":
      if (action.place.id === state.trip.origin?.id) return state;
      return edit(state, { ...state.trip, origin: action.place });

    case "set-hop-override": {
      const hop = hopIdOfLeg(action.hop);
      const existing = state.trip.hopOverrides[hop];
      const merged = mergePatch(existing ?? {}, action.patch);

      if (existing ? sameFields(existing, merged) : isEmpty(merged)) return state;

      return edit(state, {
        ...state.trip,
        hopOverrides: writeOverride(state.trip.hopOverrides, hop, merged),
      });
    }

    case "clear-hop-override": {
      const hop = hopIdOfLeg(action.hop);
      const existing = state.trip.hopOverrides[hop];
      if (!existing) return state;

      // Per-field so the hop editor can offer "reset just the mode" —
      // a user who corrected the fare shouldn't lose it to change their
      // mind about the train.
      const next: HopOverride = action.fields ? { ...existing } : {};
      for (const field of action.fields ?? []) delete next[field];

      if (sameFields(existing, next)) return state;

      return edit(
        state,
        {
          ...state.trip,
          hopOverrides: writeOverride(state.trip.hopOverrides, hop, next),
        },
        "Reset that hop to the route engine's suggestion.",
      );
    }

    case "undo":
      // No redo slot: undoing is itself an edit, and offering to undo
      // the undo is how a one-slot history starts pretending to be a
      // stack it isn't.
      return state.undo ? { trip: state.undo.trip } : state;

    case "dismiss-undo":
      return state.undo ? { trip: state.trip } : state;
  }
}

// ---------- Internals ----------

/**
 * Every mutating action returns through here, which is what guarantees
 * a stale undo can never survive a later edit.
 */
function edit(state: TripState, trip: Trip, undoNote?: string): TripState {
  return undoNote ? { trip, undo: { trip: state.trip, note: undoNote } } : { trip };
}

/**
 * Apply only the keys the caller actually supplied; a key present with
 * the value `undefined` deletes it.
 *
 * WHY DELETE RATHER THAN STORE `undefined`: `HopOverride` means
 * "absent = I have no opinion, keep the engine's" (see the model), and
 * `deriveLegs` reads that with `??`. Storing the key with an undefined
 * value would behave identically there but leave the object claiming
 * to have an opinion it doesn't — which matters to `isEmpty` below,
 * and to anyone who ever serialises a trip.
 */
function mergePatch<T extends object>(base: T, patch: Partial<T>): T {
  const next = { ...base };

  for (const key of Object.keys(patch) as (keyof T)[]) {
    const value = patch[key];
    // The cast is only to satisfy `delete`, which TypeScript allows
    // solely on properties it can see are optional; every key that
    // reaches here comes from a `Partial<T>` and so is.
    if (value === undefined) delete (next as Partial<T>)[key];
    else next[key] = value;
  }

  return next;
}

/**
 * Store an override, or drop the key entirely once it says nothing.
 *
 * An empty `{}` and an absent entry mean exactly the same thing to
 * `deriveLegs`, so keeping the empty one would be a difference the app
 * can't see — the kind that turns into a confusing diff later.
 */
function writeOverride(
  overrides: Record<HopId, HopOverride>,
  hop: HopId,
  override: HopOverride,
): Record<HopId, HopOverride> {
  const next = { ...overrides };
  if (isEmpty(override)) delete next[hop];
  else next[hop] = override;

  return next;
}

function isEmpty(override: HopOverride): boolean {
  return Object.keys(override).length === 0;
}

/**
 * Did this action actually change anything?
 *
 * WHY EVERY MUTATING CASE ASKS: a no-op that returns a new object still
 * goes through `edit()`, which DROPS THE PENDING UNDO. An editor field
 * re-dispatching its unchanged value on blur would then silently eat
 * the "Removed Lisbon — undo?" toast the user was reaching for. It also
 * allocates a fresh `Trip`, which re-renders the map for nothing.
 *
 * Shallow and reference-based: a `cost` rebuilt as a new `Money` object
 * with the same numbers reads as a change. That direction is the safe
 * one — a spurious re-render, never a dropped edit.
 */
function sameFields<T extends object>(a: T, b: T): boolean {
  const before = a as Record<string, unknown>;
  const after = b as Record<string, unknown>;
  const keys = Object.keys(before);

  return (
    keys.length === Object.keys(after).length &&
    keys.every((key) => Object.is(before[key], after[key]))
  );
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, max));
}

export function newId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}
