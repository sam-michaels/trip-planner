// ============================================================
// The itinerary list: ordering, drag targets, gaps, and where the
// editor opens.
//
// Two things worth knowing before reading the drag code:
//
//   * TODO(unit-8): THIS FILE DOES NOT COMPILE, and that is expected —
//     it is the panel's rewrite, not a regression. Unit 7 removed the
//     shim it was written against: `state.legs` and `state.undo.legs`
//     are gone (legs are derived by the caller now, not stored), the
//     four leg actions are gone (a leg edit is a destination edit or a
//     `HopOverride` write — see `tripReducer.ts`), and `./reorder` is
//     deleted, which takes `orderedLegs` with it. Nothing here was
//     patched across the unit boundary, because this panel becomes a
//     list of DESTINATIONS with the derived hops shown between them,
//     and every one of the references below disappears in that
//     rewrite rather than being repointed.
//   * On the `orderedLegs` call specifically: there is nothing to
//     replace it with, by design. Order was derived from dates; it is
//     array position now, so `deriveLegs()` already returns the legs
//     in trip order and sorting them again is exactly the bug the
//     inversion removed. Render the array as it comes.
//   * A drop point is an *insertion* index (0..n, "between these two
//     cards"), while `moveLeg` takes a *final* index ("this card ends
//     up here"). They differ by one when dragging downward, which is
//     the classic off-by-one in every reorderable list. Converted once,
//     in `handleDrop`, and nowhere else.
//
// The editor opens inline, in the position the leg occupies, rather
// than in a modal — editing a leg is mostly about its relationship to
// its neighbours (does this connect? is it before that flight?), and a
// modal hides exactly that context.
// ============================================================

import { Plus, Undo2, X } from "lucide-react";
import { Fragment, useState } from "react";
import type { Dispatch } from "react";

import type { CurrencyCode, Leg, Place } from "../model/trip";
import { orderedLegs } from "./reorder";
import type { ConnectorGap } from "./LegConnector";
import { LegConnector } from "./LegConnector";
import { LegCard } from "./LegCard";
import { LegEditor } from "./LegEditor";
import { defaultMode } from "./plausibleModes";
import type { TripAction, TripState } from "./tripReducer";
import { newId } from "./tripReducer";

/** A leg being composed — same shape the editor accepts. */
type DraftLeg = Omit<Leg, "from" | "to"> & { from?: Place; to?: Place };

type EditorState =
  | { kind: "edit"; legId: string }
  | { kind: "new"; draft: DraftLeg; atIndex?: number }
  | undefined;

interface ItineraryPanelProps {
  state: TripState;
  dispatch: Dispatch<TripAction>;
  selectedLegId?: string;
  onSelectLeg: (legId: string | undefined) => void;
}

export function ItineraryPanel({
  state,
  dispatch,
  selectedLegId,
  onSelectLeg,
}: ItineraryPanelProps) {
  const { trip, undo } = state;

  const [editor, setEditor] = useState<EditorState>();
  const [dragId, setDragId] = useState<string>();
  const [dropAt, setDropAt] = useState<number>();

  const legs = orderedLegs(state.legs);
  const gapsAfter = gapsBetweenLegs(legs);
  const knownPlaces = collectPlaces(legs);
  const tripCurrencies = collectCurrencies(state.legs);

  function handleDrop() {
    if (dragId === undefined || dropAt === undefined) return;

    const fromIndex = legs.findIndex((leg) => leg.id === dragId);
    // Dragging downward, every card above the drop point shifts up by
    // one once the dragged card is lifted out — hence the -1.
    const toIndex = dropAt > fromIndex ? dropAt - 1 : dropAt;

    if (fromIndex !== -1 && toIndex !== fromIndex) {
      dispatch({ type: "move-leg", legId: dragId, toIndex });
      onSelectLeg(dragId);
    }

    setDragId(undefined);
    setDropAt(undefined);
  }

  function startNewLeg(options: {
    from?: Place;
    to?: Place;
    departure?: string;
    atIndex?: number;
  }) {
    setEditor({
      kind: "new",
      atIndex: options.atIndex,
      draft: {
        id: newId("leg"),
        // Guessed from geography rather than fixed: a four-kilometre
        // airport transfer and a transatlantic hop should not open on
        // the same default.
        mode: defaultMode(options.from, options.to),
        // Everything starts as an idea. Anything firmer is a claim the
        // user should have to make deliberately.
        status: "idea",
        from: options.from,
        to: options.to,
        departure: options.departure,
      },
    });
  }

  /** Append: the new leg almost always continues from where the last one ended. */
  function startAppendedLeg() {
    startNewLeg({ from: legs.at(-1)?.to });
  }

  function renderEditor(draft: DraftLeg, existing: boolean) {
    return (
      <LegEditor
        leg={draft}
        knownPlaces={knownPlaces}
        tripCurrencies={tripCurrencies}
        homeCurrency={trip.homeCurrency}
        onCancel={() => setEditor(undefined)}
        onSave={(saved) => {
          if (existing) {
            dispatch({ type: "update-leg", leg: saved });
          } else {
            const atIndex =
              editor?.kind === "new" ? editor.atIndex : undefined;
            dispatch({ type: "add-leg", leg: saved, atIndex });
          }
          onSelectLeg(saved.id);
          setEditor(undefined);
        }}
        onDelete={
          existing
            ? () => {
                dispatch({ type: "remove-leg", legId: draft.id });
                if (selectedLegId === draft.id) onSelectLeg(undefined);
                setEditor(undefined);
              }
            : undefined
        }
      />
    );
  }

  const newEditorAt = (index: number) =>
    editor?.kind === "new" && editor.atIndex === index
      ? renderEditor(editor.draft, false)
      : null;

  return (
    <div className="flex h-full flex-col bg-bark-100">
      <div className="flex items-center justify-between border-b border-bark-200 bg-parchment px-3 py-2">
        <h2 className="text-xs font-semibold tracking-wide text-bark-500 uppercase">
          Itinerary
        </h2>
        <span className="text-xs text-bark-400">
          {legs.length} {legs.length === 1 ? "leg" : "legs"}
        </span>
      </div>

      <div
        className="min-h-0 flex-1 space-y-1 overflow-y-auto p-3"
        onDragOver={(event) => event.preventDefault()}
        onDrop={handleDrop}
      >
        {legs.length === 0 && !editor && (
          <div className="rounded-xl border border-dashed border-bark-300 px-4 py-8 text-center">
            <p className="text-sm font-medium text-bark-700">No legs yet</p>
            <p className="mt-1 text-xs text-bark-500">
              Add the first movement of the trip — it can be a rough idea with
              no date or price.
            </p>
          </div>
        )}

        {legs.map((leg, index) => {
          const next = legs[index + 1];

          return (
            <Fragment key={leg.id}>
              {newEditorAt(index)}
              {dropAt === index && <DropIndicator />}

              {editor?.kind === "edit" && editor.legId === leg.id ? (
                renderEditor(leg, true)
              ) : (
                <LegCard
                  leg={leg}
                  selected={selectedLegId === leg.id}
                  dragging={dragId === leg.id}
                  onSelect={() =>
                    onSelectLeg(selectedLegId === leg.id ? undefined : leg.id)
                  }
                  onEdit={() => setEditor({ kind: "edit", legId: leg.id })}
                  onDragStart={() => setDragId(leg.id)}
                  onDragEnd={() => {
                    setDragId(undefined);
                    setDropAt(undefined);
                  }}
                  onDragOverHalf={(after) => setDropAt(index + (after ? 1 : 0))}
                  onNudge={(delta) => {
                    dispatch({
                      type: "move-leg",
                      legId: leg.id,
                      toIndex: index + delta,
                    });
                    onSelectLeg(leg.id);
                  }}
                />
              )}

              {/* The strip between two legs is where the trip actually
                  happens — time in a city, or a missing connection. */}
              {next && (
                <LegConnector
                  arriving={leg}
                  departing={next}
                  gap={gapsAfter.get(leg.id)}
                  onAddLeg={({ from, to, departure }) =>
                    startNewLeg({ from, to, departure, atIndex: index + 1 })
                  }
                />
              )}
            </Fragment>
          );
        })}

        {dropAt === legs.length && <DropIndicator />}

        {editor?.kind === "new" && editor.atIndex === undefined
          ? renderEditor(editor.draft, false)
          : !editor && (
              <button
                type="button"
                onClick={startAppendedLeg}
                className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-bark-300 px-3 py-2.5 text-sm font-medium text-bark-500 transition hover:border-bark-400 hover:bg-parchment hover:text-bark-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-moss-500"
              >
                <Plus className="size-4" aria-hidden />
                Add leg
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
  return (
    <div className="h-0.5 rounded-full bg-ochre-400" aria-hidden />
  );
}

/**
 * TODO(wave-2): delete this and read `findGaps(trip, routes)` instead.
 *
 * The model's `findGaps()` has changed meaning: it now reports
 * consecutive DESTINATIONS the route engine could not connect, keyed
 * by destination, and it needs a `RouteMap` that doesn't exist yet.
 * Meanwhile this panel still lets you hand-assemble legs, so the old
 * check — "you fly into LIS and your next leg leaves from Oriente" —
 * is still the only thing standing between a user and a hole in their
 * itinerary. Rather than silently drop the warning for a wave, the
 * check lives here, against the legs actually on screen, until the
 * panel is rebuilt around destinations and the question stops being
 * askable.
 *
 * Endpoints are compared by city, not by place id: arriving at LIS and
 * departing from Lisboa Oriente is a real but *minor* gap (a metro
 * ride), while Porto → Seville with nothing in between is
 * trip-breaking. Same-city gaps are "soft".
 *
 * Keyed by the id of the leg the gap follows, which is what the
 * connector strip between two cards needs.
 */
function gapsBetweenLegs(legs: Leg[]): Map<string, ConnectorGap> {
  const gaps = new Map<string, ConnectorGap>();

  for (let i = 0; i < legs.length - 1; i++) {
    const current = legs[i];
    const next = legs[i + 1];
    if (current.to.id === next.from.id) continue;

    gaps.set(current.id, {
      from: current.to,
      to: next.from,
      severity:
        current.to.city === next.from.city &&
        current.to.country === next.from.country
          ? "soft"
          : "hard",
    });
  }

  return gaps;
}

/**
 * Every distinct place the trip touches, for the picker to offer
 * first. Deduped by id, because the same place arriving twice is what
 * makes a picker list look untrustworthy.
 */
function collectPlaces(legs: Leg[]): Place[] {
  const byId = new Map<string, Place>();
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
