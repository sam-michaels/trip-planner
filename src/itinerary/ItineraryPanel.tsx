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
// WHAT'S DELIBERATELY NOT HERE YET: `LegConnector` (the "3 nights in
// Lisbon" strip) and gap detection (`findGaps`) both need a `RouteMap`
// with real routes in it to be worth showing — with `NO_ROUTES`, every
// hop is a single placeholder guess and every consecutive pair would
// report as an unrouted "hard gap", which is noise, not signal. A
// destination card already states its own night count directly, which
// covers the "time here isn't empty" idea for now. Both return once
// the route engine (src/lib/routing.ts) is actually wired into `App`.
// ============================================================

import { GripVertical, Plus, StickyNote, Trash2, Undo2, X } from "lucide-react";
import { Fragment, useState } from "react";
import type { Dispatch, DragEvent, KeyboardEvent } from "react";

import type { CurrencyCode, Destination, Leg, Place } from "../model/trip";
import { DestinationPicker } from "./DestinationPicker";
import { HopEditor } from "./HopEditor";
import type { HopOverrideAction } from "./hopOverrides";
import { occurrenceCount, overrideForLeg } from "./hopOverrides";
import { LegCard } from "./LegCard";
import { formatDateTime, fromInputValue, toInputValue } from "./datetime";
import { STATUS_LABELS, STATUS_PILL_CLASSES, placeSubtitle } from "./labels";
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
  dispatch: Dispatch<TripAction>;
  selectedLegId?: string;
  onSelectLeg: (legId: string | undefined) => void;
}

export function ItineraryPanel({
  state,
  legs,
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
  const knownPlaces = [trip.origin, ...trip.destinations.map((d) => d.place)];

  // `HopEditor` (unit 11) predates the reducer's action shapes and was
  // written against a slightly different one — `override`/`field`
  // where the reducer settled on `patch`/`fields`. Its own comment
  // assumed the two would type-check interchangeably; they don't
  // (different property names on the same-tagged union members), so
  // this is the small adapter that bridges them rather than a change
  // to either file. Reconciling the two shapes for good belongs to
  // whoever next touches `HopOverrideAction`.
  function hopDispatch(action: HopOverrideAction) {
    dispatch(
      action.type === "set-hop-override"
        ? { type: "set-hop-override", hop: action.hop, patch: action.override }
        : {
            type: "clear-hop-override",
            hop: action.hop,
            fields: action.field ? [action.field] : undefined,
          },
    );
  }

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
        <h2 className="text-xs font-semibold tracking-wide text-bark-500 uppercase">
          Itinerary
        </h2>
        <span className="text-xs text-bark-400">
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
            <p className="text-sm font-medium text-bark-700">
              No destinations yet
            </p>
            <p className="mt-1 text-xs text-bark-500">
              Add the first place you want to go — it can be a rough idea
              with no dates or nights.
            </p>
          </div>
        )}

        {trip.destinations.map((destination, index) => (
          <Fragment key={destination.id}>
            {dropAt === index && <DropIndicator />}

            {segments[index].map((leg) =>
              editor?.kind === "hop" && editor.legId === leg.id ? (
                <HopEditor
                  key={leg.id}
                  leg={leg}
                  override={overrideForLeg(trip.hopOverrides, leg.id)}
                  occurrences={occurrenceCount(legs, leg.id)}
                  tripCurrencies={tripCurrencies}
                  homeCurrency={trip.homeCurrency}
                  dispatch={hopDispatch}
                  onClose={() => setEditor(undefined)}
                />
              ) : (
                <LegCard
                  key={leg.id}
                  leg={leg}
                  override={overrideForLeg(trip.hopOverrides, leg.id)}
                  derived
                  selected={selectedLegId === leg.id}
                  onSelect={() =>
                    onSelectLeg(selectedLegId === leg.id ? undefined : leg.id)
                  }
                  onEdit={() => setEditor({ kind: "hop", legId: leg.id })}
                />
              ),
            )}

            <DestinationCard
              destination={destination}
              editing={
                editor?.kind === "destination" &&
                editor.destinationId === destination.id
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
              className="mt-2 text-xs font-medium text-bark-500 underline decoration-dotted underline-offset-2 transition hover:text-bark-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-moss-500"
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setEditor({ kind: "add" })}
            className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-bark-300 px-3 py-2.5 text-sm font-medium text-bark-500 transition hover:border-bark-400 hover:bg-parchment hover:text-bark-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-moss-500"
          >
            <Plus className="size-4" aria-hidden />
            Add destination
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
            onClick={() => dispatch({ type: "undo" })}
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

function DropIndicator() {
  return <div className="h-0.5 rounded-full bg-ochre-400" aria-hidden />;
}

/**
 * Which derived legs lead into each destination, in trip order.
 *
 * `legs` is the whole trip's hops flattened into one array, in the
 * order `deriveLegs` walked `[origin, ...destinations]`. Rather than
 * re-deriving a chain per destination pair — which would restart the
 * occurrence-suffix numbering (`#2`, `#3`, …) that has to stay global
 * across the trip — this just consumes legs off the front until one
 * arrives at the destination's place, mirroring the same "same place
 * twice produces no leg" skip `deriveLegs` makes.
 */
function legsByDestination(
  origin: Place,
  destinations: Destination[],
  legs: Leg[],
): Leg[][] {
  const segments: Leg[][] = [];
  let cursor = 0;
  let place = origin;

  for (const destination of destinations) {
    const segment: Leg[] = [];

    if (place.id !== destination.place.id) {
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
          <p className="text-sm font-medium text-bark-900">
            {destination.place.name}
          </p>
          <p className="text-xs text-bark-500">
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
          <p className="hidden text-[11px] text-bark-400 sm:block">
            Saved as you type
          </p>
          <button
            type="button"
            onClick={onToggleEdit}
            className="rounded-lg bg-moss-700 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-moss-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-moss-500"
          >
            Done
          </button>
        </div>
      </div>
    );
  }

  const meta =
    [
      destination.nights !== undefined
        ? `${destination.nights} ${destination.nights === 1 ? "night" : "nights"}`
        : undefined,
      destination.arrival ? formatDateTime(destination.arrival) : undefined,
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
          <span className="min-w-0 flex-1 truncate text-sm font-medium text-bark-900">
            {destination.place.city}
          </span>
          <span
            className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${STATUS_PILL_CLASSES[destination.status]}`}
          >
            {STATUS_LABELS[destination.status]}
          </span>
        </div>

        <p className="mt-1 ml-5 truncate text-xs text-bark-500">
          {placeSubtitle(destination.place)}
        </p>

        <div className="mt-0.5 ml-5 flex items-baseline gap-2">
          <span className="min-w-0 flex-1 truncate text-xs text-bark-400">
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
