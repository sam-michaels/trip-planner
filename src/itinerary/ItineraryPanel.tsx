// ============================================================
// The itinerary: where you're starting from, where you want to go,
// in what order, and — underneath each one — how you'd get there.
//
// THE SHAPE OF THE LIST, which is the whole argument of this panel:
//
//     Trip starts from London, Ontario
//        ↓  [ the journey to Lisbon — derived, editable ]
//     1. Lisbon      4 nights   Idea
//        ↓  [ the journey to Porto ]
//     2. Porto       4 nights   Idea
//        + Add a destination
//
// Destinations are the things you drag; the journeys between them are
// consequences that follow along. That inverts what this panel used to
// be — a list of legs you hand-assembled — and it matches how people
// actually plan: you decide you want to see Porto, and only later
// argue about whether that's a train or a bus.
//
// WHY DRAGGING NEVER TOUCHES A DATE: order is array position now (see
// the banner on `Trip.destinations`), so a drop is a splice and
// nothing else. The old list derived order from `departure`, so
// dragging a card had to REWRITE a time to hold its new position —
// which meant rearranging an undated sketch either did nothing or
// invented a date you never typed. Both are gone.
//
// A drop point is an *insertion* index (0..n, "between these two
// cards"), while `move-destination` takes a *final* index ("this card
// ends up here"). They differ by one when dragging downward — the
// classic off-by-one in every reorderable list. Converted once, in
// `handleDrop`, and nowhere else.
// ============================================================

import { MapPin, Plus, Route, Undo2, X } from "lucide-react";
import { Fragment, useState } from "react";
import type { Dispatch, DragEvent } from "react";

import type {
  CurrencyCode,
  HopId,
  HopOverride,
  ItineraryGap,
  Leg,
  Money,
  Place,
  Trip,
} from "../model/trip";
import { hopId } from "../model/trip";
import { DestinationCard } from "./DestinationCard";
import { LegCard } from "./LegCard";
import { LegEditor } from "./LegEditor";
import { legsByDestination } from "./legGroups";
import { OriginCard } from "./OriginCard";
import { PlacePicker } from "./PlacePicker";
import type { PlanAction, PlanState } from "./planReducer";
import { newId } from "./tripReducer";

interface ItineraryPanelProps {
  state: PlanState;
  dispatch: Dispatch<PlanAction>;
  /** Derived by the shell from `state.trip` — never stored. */
  legs: Leg[];
  /** Destination pairs the route engine couldn't connect. */
  gaps: ItineraryGap[];
  selectedLegId?: string;
  onSelectLeg: (legId: string | undefined) => void;
}

export function ItineraryPanel({
  state,
  dispatch,
  legs,
  gaps,
  selectedLegId,
  onSelectLeg,
}: ItineraryPanelProps) {
  const { trip, undo } = state;
  const destinations = trip.destinations;

  const [editingLegId, setEditingLegId] = useState<string>();
  const [dragId, setDragId] = useState<string>();
  const [dropAt, setDropAt] = useState<number>();
  const [adding, setAdding] = useState(false);

  const legGroups = legsByDestination(trip, legs);
  // Keyed by destination, per the note on `ItineraryGap.hop`: a leg id
  // can repeat within one trip, a destination id cannot.
  const gapByDestination = new Map(gaps.map((gap) => [gap.toDestinationId, gap]));
  const knownPlaces = collectPlaces(trip, legs);
  const tripCurrencies = collectCurrencies(legs);

  /**
   * Dispatch for edits that change WHICH HOPS EXIST.
   *
   * An open leg editor is a form over a journey. Remove the
   * destination under it — or drag it somewhere else — and that
   * journey is gone, but `editingLegId` would still name it, so the
   * form would spring back open the moment the journey returned (an
   * undo, a drag back) with the half-typed draft silently discarded.
   * Closing it up front is the only state that is honest either way.
   */
  function reshape(action: PlanAction) {
    setEditingLegId(undefined);
    dispatch(action);
  }

  function handleDrop(event: DragEvent) {
    // Firefox treats an un-defaulted drop of `text/plain` as a
    // navigation, and would leave the app for the dragged card's id.
    event.preventDefault();

    if (dragId === undefined || dropAt === undefined) return;

    const fromIndex = destinations.findIndex((d) => d.id === dragId);
    // Dragging downward, every card above the drop point shifts up by
    // one once the dragged card is lifted out — hence the -1.
    const toIndex = dropAt > fromIndex ? dropAt - 1 : dropAt;

    if (fromIndex !== -1 && toIndex !== fromIndex) {
      reshape({ type: "move-destination", destinationId: dragId, toIndex });
    }

    setDragId(undefined);
    setDropAt(undefined);
  }

  function addDestination(place: Place) {
    reshape({
      type: "add-destination",
      destination: {
        id: newId("dest"),
        place,
        // No nights, no arrival: the honest state of somewhere you've
        // just decided you want to see.
        status: "idea",
      },
    });
    setAdding(false);
  }

  return (
    <div className="flex h-full flex-col bg-bark-100">
      <div className="flex items-center justify-between border-b border-bark-200 bg-parchment px-3 py-2">
        <h2 className="text-xs font-semibold tracking-wide text-bark-500 uppercase">
          Itinerary
        </h2>
        <span className="text-xs text-bark-400">
          {destinations.length}{" "}
          {destinations.length === 1 ? "destination" : "destinations"}
        </span>
      </div>

      <div
        className="min-h-0 flex-1 space-y-1 overflow-y-auto p-3"
        onDragOver={(event) => event.preventDefault()}
        onDrop={handleDrop}
      >
        <OriginCard
          origin={trip.origin}
          knownPlaces={knownPlaces}
          onChange={(place) => dispatch({ type: "set-origin", place })}
        />

        {destinations.map((destination, index) => (
          <Fragment key={destination.id}>
            {/* Above the journey, not between it and the card: the two
                are one unit, and a line through the middle of them
                would preview a landing spot that doesn't exist. */}
            {dropAt === index && <DropIndicator />}

            {/* The journey INTO this destination sits directly above
                it, so a card and the way you reach it read as one
                unit — which is how they're planned. */}
            <LegGroup
              legs={legGroups.get(destination.id) ?? []}
              gap={gapByDestination.get(destination.id)}
              selectedLegId={selectedLegId}
              editingLegId={editingLegId}
              knownPlaces={knownPlaces}
              tripCurrencies={tripCurrencies}
              homeCurrency={trip.homeCurrency}
              onSelectLeg={onSelectLeg}
              onEditLeg={setEditingLegId}
              onSaveLeg={(hop, override) => {
                dispatch({ type: "set-hop-override", hop, override });
                setEditingLegId(undefined);
              }}
              hopOverrides={trip.hopOverrides}
            />

            <DestinationCard
              destination={destination}
              index={index}
              total={destinations.length}
              dragging={dragId === destination.id}
              onNights={(nights) =>
                dispatch({
                  type: "update-destination",
                  destinationId: destination.id,
                  patch: { nights },
                })
              }
              onStatus={(status) =>
                dispatch({
                  type: "update-destination",
                  destinationId: destination.id,
                  patch: { status },
                })
              }
              onRemove={() =>
                reshape({
                  type: "remove-destination",
                  destinationId: destination.id,
                })
              }
              onDragStart={() => setDragId(destination.id)}
              onDragEnd={() => {
                setDragId(undefined);
                setDropAt(undefined);
              }}
              onDragOverHalf={(after) => {
                // Only while a destination is in flight: leg cards are
                // still `draggable` from when legs were the spine, and
                // dragging one shouldn't paint a drop line for a move
                // that can't happen.
                if (dragId !== undefined) setDropAt(index + (after ? 1 : 0));
              }}
              onNudge={(delta) =>
                reshape({
                  type: "move-destination",
                  destinationId: destination.id,
                  toIndex: index + delta,
                })
              }
            />
          </Fragment>
        ))}

        {dropAt === destinations.length && <DropIndicator />}

        {destinations.length === 0 && <EmptyState />}

        {/* ============================================================
            MOUNT POINT — TODO(unit-9): the destination search box and
            the inspiration grid replace everything between here and the
            end of this block. Until they land, the trip's existing
            place picker stands in so a destination can actually be
            added; it searches the same Nominatim index the real one
            will, it just doesn't suggest anywhere.
            ============================================================ */}
        {adding ? (
          <div className="rounded-xl border border-bark-200 bg-parchment p-2">
            <PlacePicker
              label="Where do you want to go?"
              knownPlaces={knownPlaces}
              onChange={addDestination}
            />
            <button
              type="button"
              onClick={() => setAdding(false)}
              className="mt-2 w-full rounded-lg px-3 py-1.5 text-xs font-medium text-bark-500 transition hover:bg-bark-50 hover:text-bark-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-moss-500"
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-bark-300 px-3 py-2.5 text-sm font-medium text-bark-500 transition hover:border-bark-400 hover:bg-parchment hover:text-bark-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-moss-500"
          >
            <Plus className="size-4" aria-hidden />
            Add a destination
          </button>
        )}
      </div>

      {undo && (
        <div
          role="status"
          className="flex items-start gap-2 border-t border-bark-200 bg-moss-800 px-3 py-2 text-parchment"
        >
          <p className="min-w-0 flex-1 text-xs leading-relaxed">{undo.note}</p>
          <button
            type="button"
            onClick={() => reshape({ type: "undo" })}
            className="flex shrink-0 items-center gap-1 rounded-md bg-white/10 px-2 py-1 text-xs font-medium transition hover:bg-white/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
          >
            <Undo2 className="size-3.5" aria-hidden />
            Undo
          </button>
          <button
            type="button"
            onClick={() => dispatch({ type: "dismiss-undo" })}
            aria-label="Dismiss"
            className="shrink-0 rounded-md p-1 text-white/60 transition hover:bg-white/10 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
          >
            <X className="size-3.5" aria-hidden />
          </button>
        </div>
      )}
    </div>
  );
}

interface LegGroupProps {
  legs: Leg[];
  gap?: ItineraryGap;
  selectedLegId?: string;
  editingLegId?: string;
  knownPlaces: Place[];
  tripCurrencies: CurrencyCode[];
  homeCurrency: CurrencyCode;
  onSelectLeg: (legId: string | undefined) => void;
  onEditLeg: (legId: string | undefined) => void;
  onSaveLeg: (hop: HopId, override: HopOverride) => void;
  /** Everything already overridden, so a save can edit rather than replace. */
  hopOverrides: Trip["hopOverrides"];
}

/**
 * The journey to one destination: one hop, or several, or none.
 *
 * Legs here are DERIVED, so they carry no position of their own — you
 * can't drag the flight above the airport bus, because which one comes
 * first is a fact about geography rather than a preference. LegCard
 * still takes drag and nudge handlers from when legs were the spine;
 * they're inert here.
 * TODO(unit-11): drop them from `LegCard`'s props when it's reworked.
 */
function LegGroup({
  legs,
  gap,
  selectedLegId,
  editingLegId,
  knownPlaces,
  tripCurrencies,
  homeCurrency,
  onSelectLeg,
  onEditLeg,
  onSaveLeg,
  hopOverrides,
}: LegGroupProps) {
  if (legs.length === 0 && !gap) return null;

  return (
    <div className="space-y-1 py-0.5 pl-3">
      {gap && <GapNote gap={gap} />}

      {legs.map((leg) => {
        return (
          <Fragment key={leg.id}>
            {editingLegId === leg.id ? (
              <LegEditor
                leg={leg}
                knownPlaces={knownPlaces}
                tripCurrencies={tripCurrencies}
                homeCurrency={homeCurrency}
                onCancel={() => onEditLeg(undefined)}
                // KEYED BY WHAT THE FORM SAYS, NOT BY WHAT WAS OPENED.
                // The editor still offers endpoint pickers from when
                // legs were hand-assembled, and changing them makes the
                // form describe a DIFFERENT journey — one whose mode it
                // re-guesses on the spot. Filing that under the hop the
                // user opened would put a train on the Atlantic. Filed
                // under its own hop id it is simply an opinion about a
                // journey this trip doesn't currently contain, which is
                // what `hopOverrides` is built to hold harmlessly.
                // TODO(unit-11): hide the endpoint pickers for a derived
                // hop, so editing them isn't offered at all.
                onSave={(saved) => {
                  const hop = hopId(saved.from, saved.to);
                  onSaveLeg(
                    hop,
                    overrideFromEdit(leg, saved, hopOverrides[hop]),
                  );
                }}
              />
            ) : (
              <LegCard
                leg={leg}
                selected={selectedLegId === leg.id}
                dragging={false}
                onSelect={() =>
                  onSelectLeg(selectedLegId === leg.id ? undefined : leg.id)
                }
                onEdit={() => onEditLeg(leg.id)}
                onDragStart={() => {}}
                onDragEnd={() => {}}
                onDragOverHalf={() => {}}
                onNudge={() => {}}
              />
            )}

            {/* TODO(unit-11): the layover strip between two hops of one
                journey belongs here — "3h 40m in Toronto", with the
                interlude under it. It is left out this wave rather than
                wired wrong: every action `LegConnector` offers ("Add
                leg", "Add transfer") builds a hand-assembled leg, which
                no longer exists, and the nearest thing it could do
                instead — inserting the waypoint as a destination —
                would put an airport in a list the model says holds
                cities. With no route engine yet every journey is a
                single hop, so nothing is visible missing today. */}
          </Fragment>
        );
      })}
    </div>
  );
}

/**
 * What the user CHANGED in the editor, as an override — and nothing
 * else.
 *
 * WHY A DIFF RATHER THAN THE WHOLE FORM: an absent field in a
 * `HopOverride` means "I have no opinion, keep whatever the engine
 * proposed" (see its doc comment), so writing every field of the form
 * back turns every value the user merely LOOKED AT into a decision.
 * Open a leg to add a note and the placeholder mode — a geographic
 * guess, not a choice — gets pinned, and the route engine's real
 * proposal is overridden forever by something nobody picked.
 *
 * `derived` is what the form was seeded with, i.e. the engine's
 * proposal with any existing override already folded in. So a field
 * that comes back unchanged is left exactly as it was: still an
 * opinion if it already was one, still silent if it wasn't.
 *
 * THE ONE THING THIS CANNOT EXPRESS: "the engine says €120 and I say
 * there is no fare". Clearing a field deletes the override, and the
 * engine's value comes back. That's `HopOverride`'s shape, not a bug
 * here — an override has no way to say "explicitly nothing".
 */
function overrideFromEdit(
  derived: Leg,
  saved: Leg,
  existing: HopOverride | undefined,
): HopOverride {
  const next: HopOverride = { ...existing };

  // Always defined on a leg, so these are a plain comparison.
  if (saved.mode !== derived.mode) next.mode = saved.mode;
  if (saved.status !== derived.status) next.status = saved.status;

  for (const key of OPTIONAL_TEXT_FIELDS) {
    if (saved[key] === derived[key]) continue;
    if (saved[key] === undefined) delete next[key];
    else next[key] = saved[key];
  }

  if (!sameMoney(saved.cost, derived.cost)) {
    if (saved.cost === undefined) delete next.cost;
    else next.cost = saved.cost;
  }

  return next;
}

/** Every optional field a leg and an override describe identically. */
const OPTIONAL_TEXT_FIELDS = [
  "departure",
  "arrival",
  "operator",
  "bookingRef",
  "bookingUrl",
  "notes",
] as const;

/** Money is two fields, so `===` on the object would always differ. */
function sameMoney(a: Money | undefined, b: Money | undefined): boolean {
  if (!a || !b) return a === b;
  return a.amount === b.amount && a.currency === b.currency;
}

/**
 * A destination pair the route engine had nothing to say about.
 *
 * WHY THIS ISN'T PAINTED AS AN ALARM: until Unit 6's engine lands
 * every pair is unrouted, so an alarm here would be an alarm on every
 * single row — which is exactly how people learn to ignore the ones
 * that matter (the same argument the connector makes about soft gaps).
 * It's an open question, not a mistake: you've said where you want to
 * go and nothing has worked out how yet. The leg below it is a guess,
 * and saying so is more useful than a warning triangle.
 */
function GapNote({ gap }: { gap: ItineraryGap }) {
  const soft = gap.severity === "soft";

  return (
    <p
      className={`flex items-start gap-1.5 text-[11px] leading-snug ${
        soft ? "text-bark-500" : "text-ochre-700"
      }`}
    >
      {soft ? (
        <MapPin className="mt-px size-3 shrink-0" aria-hidden />
      ) : (
        <Route className="mt-px size-3 shrink-0" aria-hidden />
      )}
      <span className="min-w-0">
        {soft
          ? `A short hop across ${gap.from.city} — nothing worked out yet.`
          : `No route worked out yet for ${gap.from.city} → ${gap.to.city}. The leg below is a guess.`}
      </span>
    </p>
  );
}

function EmptyState() {
  return (
    <div className="rounded-xl border border-dashed border-bark-300 px-4 py-8 text-center">
      <p className="text-sm font-medium text-bark-700">Where do you want to go?</p>
      <p className="mx-auto mt-1 max-w-xs text-xs leading-relaxed text-bark-500">
        Add the places you want to see, in roughly the order you'd see them.
        Dates, nights and how you'd get between them can all wait — you can
        change the order by dragging later.
      </p>
    </div>
  );
}

function DropIndicator() {
  return <div className="h-0.5 rounded-full bg-ochre-400" aria-hidden />;
}

/**
 * Every distinct place the trip touches — the origin, the
 * destinations, and the endpoints of whatever the engine routed
 * through — for the pickers to offer before hitting the network.
 * Deduped by id, because the same place appearing twice is what makes
 * a suggestion list look untrustworthy.
 */
function collectPlaces(trip: Trip, legs: Leg[]): Place[] {
  const byId = new Map<string, Place>([[trip.origin.id, trip.origin]]);
  for (const destination of trip.destinations) {
    byId.set(destination.place.id, destination.place);
  }
  for (const leg of legs) {
    byId.set(leg.from.id, leg.from);
    byId.set(leg.to.id, leg.to);
  }
  return [...byId.values()];
}

function collectCurrencies(legs: Leg[]): CurrencyCode[] {
  return [
    ...new Set(
      legs
        .map((leg) => leg.cost?.currency)
        .filter((code): code is CurrencyCode => Boolean(code)),
    ),
  ];
}
