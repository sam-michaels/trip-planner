// ============================================================
// The itinerary list: destinations, with the derived hops that get
// you to each one shown above it.
//
// WHY DESTINATIONS ARE THE ROWS AND LEGS ARE NOT: the trip's spine is
// `trip.destinations` (see model/trip.ts) — legs are recomputed on
// every render from that list plus whatever route data and overrides
// exist. Editing a leg by hand stopped being a thing units 6/7 could
// leave in place: there is no stored leg to point an editor at any
// more, only a destination (`*-destination` actions) and a hop's
// disagreement with the route engine (`HopEditor`, writing a
// `HopOverride`). So each destination gets a card, and the hop or hops
// the engine proposes between it and the previous one render above it,
// read-only apart from that disagreement.
//
// ORDER IS ARRAY POSITION (see the banner on `Trip.destinations`), so
// `trip.destinations` is rendered exactly as it comes — no sorting,
// which is precisely the bug the leg → destination inversion removed.
// `legsByDestination` below groups the flat, already-ordered `legs`
// prop by which destination each hop is heading for; it does not
// re-derive anything.
//
// A drop point is an INSERTION index (0..n, "between these two
// cards"), while `move-destination` takes a FINAL index ("this card
// ends up here"). They differ by one when dragging downward — the
// classic reorderable-list off-by-one. Converted once, in `handleDrop`,
// and nowhere else.
//
// THE CONNECTOR SPINE: `LegConnector` renders in the gap between every
// two consecutive legs, not just between destinations — a multi-hop
// route (a connecting flight, say) has a real stop at the airport in
// between, and that stop gets the same strip a destination does. A
// `previousLeg` cursor tracks this across the whole render (mutated as
// each leg renders, never reset per destination), so the connector
// before a destination's first leg is the same code path as the one
// between two hops inside one destination's chain — the render doesn't
// need to know which case it's in.
//
// GAPS COME FROM THE ENGINE, NOT FROM GUESSING. `findGaps(trip, routes)`
// is the one source of "this pair doesn't connect" — see its banner in
// model/trip.ts for why that's now a genuinely rare, meaningful signal
// rather than the noise it would have been against an empty `RouteMap`.
// A gap can only ever land on the connector immediately before a
// destination's FIRST leg: an unrouted pair always derives to exactly
// one placeholder hop (`deriveLegs`), so there is no second leg in that
// chain for a gap to attach to instead.
//
// THE FIRST LEG HAS NO CONNECTOR, and so a gap on the opening hop is
// silent: a connector marks a stop between two legs, and there is no
// leg before the first one. The placeholder `LegCard` still renders
// and is editable like any other hop.
// ============================================================

import { GripVertical, Plus, StickyNote, Trash2, Undo2, X } from "lucide-react";
import { Fragment, useState } from "react";
import type { Dispatch, DragEvent, KeyboardEvent } from "react";

import type {
  Activity,
  CurrencyCode,
  Destination,
  Leg,
  Place,
  RouteMap,
  Stay,
} from "../model/trip";
import { findGaps, shortlistFor, tripPlaces } from "../model/trip";
import { DestinationPicker } from "./DestinationPicker";
import { HopEditor } from "./HopEditor";
import { occurrenceCount, overrideForLeg } from "./hopOverrides";
import { LegCard } from "./LegCard";
import { LegConnector } from "./LegConnector";
import { formatDateTime, fromInputValue, toInputValue } from "./datetime";
import {
  ACTIVITY_LABELS,
  STAY_LABELS,
  STATUS_LABELS,
  STATUS_PILL_CLASSES,
  placeSubtitle,
} from "./labels";
import { Field, FieldGroup, StatusPicker, inputClasses, labelled } from "./fields";
import type { DestinationPatch, TripAction, TripState } from "./tripReducer";
import { newId } from "./tripReducer";

type EditorState =
  | { kind: "hop"; legId: string }
  | { kind: "destination"; destinationId: string }
  | { kind: "add" }
  | undefined;

interface ItineraryPanelProps {
  state: TripState;
  /** Derived by the caller (`deriveLegs`) — see the banner on `tripReducer.ts`. */
  legs: Leg[];
  /**
   * Owned by `App` (`useRoutes`), not re-derived here. The panel's only
   * use for it is `findGaps(trip, routes)` — running the engine a
   * second time to answer that would mean two async fetches racing to
   * describe the same trip.
   */
  routes: RouteMap;
  dispatch: Dispatch<TripAction>;
  selectedLegId?: string;
  onSelectLeg: (legId: string | undefined) => void;
}

export function ItineraryPanel({
  state,
  legs,
  routes,
  dispatch,
  selectedLegId,
  onSelectLeg,
}: ItineraryPanelProps) {
  const { trip, undo } = state;

  const [editor, setEditor] = useState<EditorState>();
  const [dragId, setDragId] = useState<string>();
  const [dropAt, setDropAt] = useState<number>();

  const segments = legsByDestination(trip.origin, trip.destinations, legs);
  const tripCurrencies = collectCurrencies(legs);
  const knownPlaces = tripPlaces(trip);

  // Keyed by `toDestinationId` (unique by construction, see
  // `ItineraryGap`) rather than by hop id: a gap is rendered on the
  // connector leading INTO a destination, and that's the key the render
  // loop below actually has in hand at that point.
  const gapsByDestination = new Map(
    findGaps(trip, routes).map((gap) => [gap.toDestinationId, gap]),
  );

  // Mutated once per rendered leg, in render order — the same "walk
  // forward, remember where you were" shape `legsByDestination` already
  // uses for `cursor`/`place`. This is what lets a connector appear
  // between the last leg of one destination's chain and the first leg
  // of the next without the two segments knowing about each other.
  let previousLeg: Leg | undefined;

  function handleDrop() {
    if (dragId === undefined || dropAt === undefined) return;

    const fromIndex = trip.destinations.findIndex((d) => d.id === dragId);
    // Dragging downward, every card above the drop point shifts up by
    // one once the dragged card is lifted out — hence the -1.
    const toIndex = dropAt > fromIndex ? dropAt - 1 : dropAt;

    if (fromIndex !== -1 && toIndex !== fromIndex) {
      dispatch({ type: "move-destination", destinationId: dragId, toIndex });
    }

    setDragId(undefined);
    setDropAt(undefined);
  }

  return (
    <div className="flex h-full flex-col bg-bark-100">
      <div className="flex items-center justify-between border-b border-bark-200 bg-parchment px-3 py-2">
        <h2 className="text-micro text-bark-600 uppercase">Itinerary</h2>
        <span className="text-caption text-bark-600">
          {trip.destinations.length}{" "}
          {trip.destinations.length === 1 ? "destination" : "destinations"}
        </span>
      </div>

      <div
        className="min-h-0 flex-1 space-y-1 overflow-y-auto p-3"
        onDragOver={(event) => event.preventDefault()}
        onDrop={handleDrop}
      >
        {trip.destinations.length === 0 && !editor && (
          <div className="rounded-xl border border-dashed border-bark-300 px-4 py-8 text-center">
            {/* One of the Two Voices Rule's three sanctioned uses of
                Fraunces: the itinerary has nothing to show but its own
                voice, same as the trip title and the map's setup state. */}
            <p className="text-display font-display text-bark-800">
              No destinations yet
            </p>
            <p className="mt-1 text-caption text-bark-600">
              Add the first place you want to go — it can be a rough idea
              with no dates or nights.
            </p>
          </div>
        )}

        {trip.destinations.map((destination, index) => (
          <Fragment key={destination.id}>
            {dropAt === index && <DropIndicator />}

            {segments[index].map((leg, legIndex) => {
              // Only a segment's first leg can carry a gap: an unrouted
              // pair derives to exactly one placeholder hop (see the
              // header banner), so there is never a second leg in the
              // chain for the gap to land on instead.
              const gap =
                legIndex === 0
                  ? gapsByDestination.get(destination.id)
                  : undefined;
              const arriving = previousLeg;
              previousLeg = leg;

              return (
                <Fragment key={leg.id}>
                  {arriving && (
                    <LegConnector
                      arriving={arriving}
                      departing={leg}
                      gap={gap}
                      onAddLeg={
                        gap
                          ? () => setEditor({ kind: "hop", legId: leg.id })
                          : undefined
                      }
                    />
                  )}

                  {editor?.kind === "hop" && editor.legId === leg.id ? (
                    <HopEditor
                      leg={leg}
                      override={overrideForLeg(trip.hopOverrides, leg.id)}
                      occurrences={occurrenceCount(legs, leg.id)}
                      tripCurrencies={tripCurrencies}
                      homeCurrency={trip.homeCurrency}
                      dispatch={dispatch}
                      onClose={() => setEditor(undefined)}
                    />
                  ) : (
                    <LegCard
                      leg={leg}
                      override={overrideForLeg(trip.hopOverrides, leg.id)}
                      derived
                      selected={selectedLegId === leg.id}
                      onSelect={() =>
                        onSelectLeg(selectedLegId === leg.id ? undefined : leg.id)
                      }
                      onEdit={() => setEditor({ kind: "hop", legId: leg.id })}
                    />
                  )}
                </Fragment>
              );
            })}

            <DestinationCard
              destination={destination}
              editing={
                editor?.kind === "destination" &&
                editor.destinationId === destination.id
              }
              shortlist={shortlistFor(trip, destination)}
              onRemoveStay={(stayId) =>
                dispatch({ type: "remove-stay", stayId })
              }
              onRemoveActivity={(activityId) =>
                dispatch({ type: "remove-activity", activityId })
              }
              onToggleEdit={() =>
                setEditor((current) =>
                  current?.kind === "destination" &&
                  current.destinationId === destination.id
                    ? undefined
                    : { kind: "destination", destinationId: destination.id },
                )
              }
              onPatch={(patch) =>
                dispatch({
                  type: "update-destination",
                  destinationId: destination.id,
                  patch,
                })
              }
              onRemove={() =>
                dispatch({
                  type: "remove-destination",
                  destinationId: destination.id,
                })
              }
              dragging={dragId === destination.id}
              onDragStart={() => setDragId(destination.id)}
              onDragEnd={() => {
                setDragId(undefined);
                setDropAt(undefined);
              }}
              onDragOverHalf={(after) => setDropAt(index + (after ? 1 : 0))}
              onNudge={(delta) =>
                dispatch({
                  type: "move-destination",
                  destinationId: destination.id,
                  toIndex: index + delta,
                })
              }
            />
          </Fragment>
        ))}

        {dropAt === trip.destinations.length && <DropIndicator />}

        {editor?.kind === "add" ? (
          <div className="rounded-xl border border-moss-200 bg-moss-50/40 p-3">
            <DestinationPicker
              autoFocus
              knownPlaces={knownPlaces}
              onSelect={(place: Place) => {
                dispatch({
                  type: "add-destination",
                  destination: { id: newId("dest"), place, status: "idea" },
                });
                setEditor(undefined);
              }}
            />
            <button
              type="button"
              onClick={() => setEditor(undefined)}
              className="mt-2 text-label font-medium text-bark-600 underline decoration-dotted underline-offset-2 transition hover:text-bark-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-moss-500"
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setEditor({ kind: "add" })}
            className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-bark-300 px-3 py-2.5 text-body font-medium text-bark-600 transition hover:border-bark-400 hover:bg-parchment hover:text-bark-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-moss-500"
          >
            <Plus className="size-4" aria-hidden />
            {/*
              A question, not a command, because the popup that just
              closed asked one — "Where do you want to go?" — and this
              is the same question asked again for the next city. The
              button is otherwise untouched: it already opens
              `DestinationPicker` and already dispatches
              `add-destination` (a2233fd), so the plan's "open the
              picker rather than the leg editor" was done before this.
            */}
            Anywhere else?
          </button>
        )}
      </div>

      {undo && (
        <div
          role="status"
          className="flex items-start gap-2 border-t border-bark-200 bg-moss-800 px-3 py-2 text-parchment"
        >
          <p className="min-w-0 flex-1 text-caption">{undo.note}</p>
          <button
            type="button"
            onClick={() => dispatch({ type: "undo" })}
            className="flex shrink-0 items-center gap-1 rounded-md bg-white/10 px-2 py-1 text-caption font-medium transition hover:bg-white/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
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

function DropIndicator() {
  return <div className="h-0.5 rounded-full bg-ochre-400" aria-hidden />;
}

/**
 * Which derived legs lead into each destination, in trip order.
 *
 * `legs` is the whole trip's hops flattened into one array, in the
 * order `deriveLegs` walked `tripPlaces(trip)`. Rather than re-deriving
 * a chain per destination pair — which would restart the
 * occurrence-suffix numbering (`#2`, `#3`, …) that has to stay global
 * across the trip — this just consumes legs off the front until one
 * arrives at the destination's place, mirroring the same "same place
 * twice produces no leg" skip `deriveLegs` makes.
 *
 * `origin` can be absent (nobody's said where they are yet). That's
 * just a shorter walk, the same way `tripPlaces` treats it: the first
 * destination has no inbound leg to consume, so it gets an empty
 * segment rather than a null check standing in for one.
 */
function legsByDestination(
  origin: Place | undefined,
  destinations: Destination[],
  legs: Leg[],
): Leg[][] {
  const segments: Leg[][] = [];
  let cursor = 0;
  let place = origin;

  for (const destination of destinations) {
    const segment: Leg[] = [];

    if (place && place.id !== destination.place.id) {
      while (cursor < legs.length) {
        const leg = legs[cursor++];
        segment.push(leg);
        if (leg.to.id === destination.place.id) break;
      }
    }

    segments.push(segment);
    place = destination.place;
  }

  return segments;
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

interface DestinationCardProps {
  destination: Destination;
  editing: boolean;
  /**
   * What's been shortlisted for this city — see `shortlistFor`, which
   * owns the question of what "for this city" means.
   */
  shortlist: { stays: Stay[]; activities: Activity[] };
  onRemoveStay: (stayId: string) => void;
  onRemoveActivity: (activityId: string) => void;
  onToggleEdit: () => void;
  onPatch: (patch: DestinationPatch) => void;
  onRemove: () => void;
  dragging: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
  /** Pointer moved over this card: `after` says which half it's in. */
  onDragOverHalf: (after: boolean) => void;
  /** Keyboard reordering, in list positions (-1 = up, +1 = down). */
  onNudge: (delta: number) => void;
}

/**
 * One destination, collapsed to a row or expanded to its editor.
 *
 * There is no separate "select" affordance the way `LegCard` has one:
 * a leg's selection highlights the matching line on the map, but a
 * destination has no map geometry of its own to highlight, so the
 * whole row does exactly one thing — open its editor.
 */
function DestinationCard({
  destination,
  editing,
  shortlist,
  onRemoveStay,
  onRemoveActivity,
  onToggleEdit,
  onPatch,
  onRemove,
  dragging,
  onDragStart,
  onDragEnd,
  onDragOverHalf,
  onNudge,
}: DestinationCardProps) {
  function handleDragOver(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    onDragOverHalf(event.clientY > rect.top + rect.height / 2);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    // Alt+arrows, because drag-and-drop is unreachable by keyboard and
    // an itinerary you can't rearrange without a mouse is only half
    // usable. Alt keeps plain arrows free for scrolling the list.
    if (!event.altKey) return;

    if (event.key === "ArrowUp") {
      event.preventDefault();
      onNudge(-1);
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      onNudge(1);
    }
  }

  function handleNightsChange(value: string) {
    if (value.trim() === "") {
      onPatch({ nights: undefined });
      return;
    }
    const parsed = Number.parseInt(value, 10);
    // Garbage or negative writes nothing rather than clearing a good
    // value — same rule `HopEditor` uses for cost, for the same reason:
    // a stray keystroke shouldn't be able to erase what's already there.
    if (Number.isFinite(parsed) && parsed >= 0) onPatch({ nights: parsed });
  }

  if (editing) {
    return (
      <div className="space-y-4 rounded-xl border border-moss-200 bg-moss-50/40 p-3">
        <div className="rounded-lg border border-bark-200 bg-parchment px-3 py-2">
          <p className="text-body font-medium text-bark-900">
            {destination.place.name}
          </p>
          <p className="text-caption text-bark-600">
            {placeSubtitle(destination.place)}
          </p>
        </div>

        <FieldGroup label="Status">
          <StatusPicker
            value={destination.status}
            onChange={(status) => onPatch({ status })}
          />
        </FieldGroup>

        <div className="grid grid-cols-2 gap-2">
          <Field label="Nights">
            <input
              type="number"
              min={0}
              inputMode="numeric"
              value={destination.nights?.toString() ?? ""}
              onChange={(e) => handleNightsChange(e.target.value)}
              placeholder="?"
              className={`${inputClasses} w-full`}
            />
          </Field>
          <Field label="Arrival">
            <input
              type="datetime-local"
              value={toInputValue(destination.arrival)}
              onChange={(e) =>
                onPatch({ arrival: fromInputValue(e.target.value) })
              }
              className={`${inputClasses} w-full`}
            />
          </Field>
        </div>

        <Field label="Notes">
          <textarea
            value={destination.notes ?? ""}
            onChange={(e) =>
              onPatch({ notes: e.target.value || undefined })
            }
            rows={2}
            placeholder="What you want to do here, things to check…"
            className={`${inputClasses} w-full resize-y`}
          />
        </Field>

        <Shortlist
          shortlist={shortlist}
          onRemoveStay={onRemoveStay}
          onRemoveActivity={onRemoveActivity}
        />

        <div className="sticky bottom-0 -mx-3 -mb-3 flex items-center gap-2 rounded-b-xl border-t border-moss-200/70 bg-moss-50 px-3 py-2.5">
          <button
            type="button"
            onClick={onRemove}
            {...labelled(`Remove ${destination.place.city}`)}
            className="rounded-lg p-2 text-bark-400 transition hover:bg-rust-50 hover:text-rust-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-rust-500"
          >
            <Trash2 className="size-4" aria-hidden />
          </button>
          <div className="flex-1" />
          <p className="hidden text-micro text-bark-600 sm:block">
            Saved as you type
          </p>
          <button
            type="button"
            onClick={onToggleEdit}
            className="rounded-lg bg-moss-700 px-3 py-1.5 text-body font-medium text-white transition hover:bg-moss-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-moss-500"
          >
            Done
          </button>
        </div>
      </div>
    );
  }

  // The collapsed row is one big <button>, so the shortlist can only
  // appear here as text — anything with a remove control of its own
  // would be an interactive element nested inside an interactive
  // element. The count says it's there; expanding the card lists it.
  const ideas = shortlist.stays.length + shortlist.activities.length;

  const meta =
    [
      destination.nights !== undefined
        ? `${destination.nights} ${destination.nights === 1 ? "night" : "nights"}`
        : undefined,
      destination.arrival ? formatDateTime(destination.arrival) : undefined,
      ideas > 0 ? `${ideas} ${ideas === 1 ? "idea" : "ideas"}` : undefined,
    ]
      .filter(Boolean)
      .join(" · ") || "No nights or date yet";

  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragOver={handleDragOver}
      className={`group flex rounded-xl border border-bark-200 bg-parchment transition ${
        dragging ? "opacity-40" : "hover:border-bark-300"
      }`}
    >
      <button
        type="button"
        onClick={onToggleEdit}
        onKeyDown={handleKeyDown}
        aria-expanded={editing}
        className="min-w-0 flex-1 cursor-grab rounded-xl py-2 pr-1.5 pl-1.5 text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-moss-500 active:cursor-grabbing"
      >
        <div className="flex items-center gap-1.5">
          <GripVertical
            className="size-3.5 shrink-0 text-bark-300 group-hover:text-bark-400"
            aria-hidden
          />
          <span className="min-w-0 flex-1 truncate text-body font-medium text-bark-900">
            {destination.place.city}
          </span>
          <span
            className={`shrink-0 rounded-full px-1.5 py-0.5 text-micro ${STATUS_PILL_CLASSES[destination.status]}`}
          >
            {STATUS_LABELS[destination.status]}
          </span>
        </div>

        <p className="mt-1 ml-5 truncate text-caption text-bark-600">
          {placeSubtitle(destination.place)}
        </p>

        <div className="mt-0.5 ml-5 flex items-baseline gap-2">
          <span className="min-w-0 flex-1 truncate text-caption text-bark-600">
            {meta}
          </span>
          {destination.notes && (
            <StickyNote
              className="size-3 shrink-0 text-bark-300"
              aria-label="Has notes"
            />
          )}
        </div>
      </button>
    </div>
  );
}

/**
 * The stays and activities shortlisted for one destination, with a way
 * to take each one off again.
 *
 * ONLY IN THE EXPANDED CARD, because the collapsed row is a single
 * <button> and a remove control inside it would be an interactive
 * element nested in an interactive element — invalid, and unreachable
 * by keyboard in the way that matters. The collapsed row carries the
 * count instead; this is where you act on it.
 *
 * REMOVE IS THE ONLY VERB HERE. A shortlisted stay has no dates yet
 * (see `Stay.checkIn`), and a field for one would be inventing the
 * stays editor in the margin of the destination card. Ticking more
 * happens back in the popup that found them.
 */
function Shortlist({
  shortlist,
  onRemoveStay,
  onRemoveActivity,
}: {
  shortlist: { stays: Stay[]; activities: Activity[] };
  onRemoveStay: (stayId: string) => void;
  onRemoveActivity: (activityId: string) => void;
}) {
  const rows = [
    ...shortlist.stays.map((stay) => ({
      id: stay.id,
      name: stay.place.name,
      note: STAY_LABELS[stay.type],
      remove: () => onRemoveStay(stay.id),
    })),
    ...shortlist.activities.map((activity) => ({
      id: activity.id,
      name: activity.name,
      note: ACTIVITY_LABELS[activity.category],
      remove: () => onRemoveActivity(activity.id),
    })),
  ];

  // Nothing shortlisted is the ordinary state for a city added from the
  // panel rather than the popup, so it renders nothing at all — an
  // empty "Ideas" heading would be a section announcing its own absence.
  if (rows.length === 0) return null;

  return (
    <FieldGroup label="Ideas">
      <ul className="space-y-1">
        {rows.map((row) => (
          <li
            key={row.id}
            className="flex items-center gap-2 rounded-lg border border-bark-200 bg-parchment px-2.5 py-1.5"
          >
            <span className="min-w-0 flex-1 truncate text-label text-bark-800">
              {row.name}
            </span>
            <span className="shrink-0 text-caption text-bark-600">
              {row.note}
            </span>
            <button
              type="button"
              onClick={row.remove}
              {...labelled(`Remove ${row.name}`)}
              className="shrink-0 rounded p-1 text-bark-400 transition hover:bg-rust-50 hover:text-rust-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-rust-500"
            >
              <X className="size-3.5" aria-hidden />
            </button>
          </li>
        ))}
      </ul>
    </FieldGroup>
  );
}
