// ============================================================
// The shell: trip state, and the split between list and map.
//
// State lives here because the itinerary and the map are two views of
// one `Trip` and both need to read it — and because selection is
// shared: clicking a line highlights a card, clicking a card
// highlights a line. Neither owns it, so their common parent does.
//
// Still a plain `useReducer` over one object, per the README. A store
// library would buy nothing at this size.
// ============================================================

import { useEffect, useMemo, useReducer, useState } from "react";

import { CostSummary } from "./cost/CostSummary";
import { ItineraryPanel } from "./itinerary/ItineraryPanel";
import { tripReducer } from "./itinerary/tripReducer";
import { TripMap } from "./map/TripMap";
import { defaultMode } from "./itinerary/plausibleModes";
import type { HopId, RouteMap, Trip } from "./model/trip";
import { deriveLegs, emptyTrip, hopId, tripPlaces } from "./model/trip";
import { Welcome } from "./onboarding/Welcome";
import { newId } from "./itinerary/tripReducer";
import type { RouteOption, RouteOptionMap } from "./lib/routing";
import { accessPair, pickRoutes, proposeTripRoutes } from "./lib/routing";

/**
 * What the itinerary looks like before the engine has answered.
 *
 * `deriveLegs` degrades to one placeholder hop per destination pair, so
 * the first paint is London → Lisbon as a single line. That is the old
 * permanent behaviour, now reduced to a frame or two while the routes
 * resolve — worth keeping rather than showing an empty map, because a
 * straight line between the right two cities is a fair sketch of a
 * journey whose airports are still being worked out.
 */
const NO_ROUTES: RouteMap = new Map();

/** Same idea, one level up: no proposals yet, so nothing to choose between. */
const NO_OPTIONS: RouteOptionMap = new Map();

/**
 * Every route the engine can propose, for every pair in the trip.
 *
 * NOT `buildRouteMap`, WHICH IS THE SAME CALL WITH THE CHOICE MADE FOR
 * YOU. Its own doc says to reach for this pair instead "wherever the
 * alternatives matter — a UI offering the traveller the choice this
 * function makes silently on their behalf". That UI now exists, so the
 * shell holds the options and collapses them with `pickRoutes` once it
 * knows what the traveller picked.
 *
 * ASYNCHRONOUS BECAUSE THE ANSWER IS: resolving airports can mean
 * downloading and parsing the OurAirports table, so this cannot be a
 * `useMemo`. It starts empty, fills in, and `deriveLegs` handles both
 * states — which is also what makes it safe when the network is gone:
 * `proposeRoutes` never rejects, so a failure lands as a smaller answer
 * rather than an error boundary.
 *
 * The cancelled flag is the ordinary out-of-order guard: edit twice
 * quickly and the first response must not overwrite the second.
 */
function useRouteOptions(trip: Trip): RouteOptionMap {
  const [options, setOptions] = useState<RouteOptionMap>(NO_OPTIONS);

  useEffect(() => {
    let cancelled = false;

    proposeTripRoutes(trip).then((next) => {
      if (!cancelled) setOptions(next);
    });

    return () => {
      cancelled = true;
    };
    // Keyed on the places, not the whole trip: renaming the trip or
    // editing a hop's cost changes `trip` without changing a single
    // question the engine was asked.
  }, [routeKey(trip)]);

  return options;
}

/** The destinations, in order — everything `buildRouteMap` actually reads. */
function routeKey(trip: Trip): string {
  return tripPlaces(trip)
    .map((place) => place.id)
    .join(">");
}

/**
 * The origin → first destination pair, with the alternatives the
 * engine found for it and the mode its access hop currently carries.
 *
 * `undefined` until there is both an origin and a destination — which
 * is most of the popup's life, since it is asking for exactly those.
 */
function firstLegChoice(trip: Trip, options: RouteOptionMap) {
  const [from, to] = tripPlaces(trip);
  if (!from || !to) return undefined;

  const pair = hopId(from, to);
  const proposals = options.get(pair);
  if (!proposals || proposals.length === 0) return undefined;

  // The access hop's mode as it stands — the engine's guess unless the
  // traveller has already overridden it, which is what the row shows
  // as selected.
  const accessMode = currentAccessMode(trip, proposals);

  return { pair, options: proposals, accessMode };
}

/**
 * The mode currently in effect on the hop `AccessRow` writes to.
 *
 * VIA `accessPair`, NOT `proposals[0]`, AND THAT IS THE WHOLE POINT.
 * This used to read the first hop of the first proposal, while the row
 * picked its hop by shape — and `proposeRoutes` returns
 * `[...ground, ...air]` for a land-connected pair between 700km and
 * 1000km, so the first proposal there is the direct ground option
 * while the row is rendering the airport transfer further down the
 * list. The read and the write landed on different hops and the radio
 * could never show itself as checked. Same function on both sides now,
 * so they cannot drift apart again.
 */
function currentAccessMode(trip: Trip, proposals: readonly RouteOption[]) {
  const access = accessPair(proposals)?.overland.hops[0];
  if (!access) return undefined;
  return (
    trip.hopOverrides[hopId(access.from, access.to)]?.mode ?? access.mode
  );
}

/** The set of places a list of stays or activities is sitting on. */
function placeIds(rows: readonly { place: { id: string } }[]): ReadonlySet<string> {
  return new Set(rows.map((row) => row.place.id));
}

/**
 * Every row for one place, dispatched over.
 *
 * Plural because the reducer's add-guard is the only thing keeping a
 * place to one row, and an untick that removed the first match would
 * quietly leave a second behind if that guard ever slipped.
 */
function forEachMatch<T extends { place: { id: string } }>(
  rows: readonly T[],
  placeId: string,
  remove: (row: T) => void,
) {
  for (const row of rows) if (row.place.id === placeId) remove(row);
}

function App() {
  // `TripState` holds only `trip` and an optional `undo` snapshot —
  // legs are never state (see the banner on `tripReducer.ts`), so
  // there is nothing left to compute for an initial value.
  const [state, dispatch] = useReducer(tripReducer, { trip: emptyTrip });
  const [selectedLegId, setSelectedLegId] = useState<string>();

  // The popup opens on load and closes for good once it's answered.
  // Deliberately not persisted: there is nothing to remember yet (no
  // storage anywhere in the app), so a reload is a fresh trip and the
  // question is worth asking again.
  const [welcoming, setWelcoming] = useState(true);

  const { trip } = state;

  // Memoised on the trip, not recomputed on every render: deriving
  // once per edit is the whole point of the derive-don't-store rule,
  // not once per render of an unrelated bit of state (like the
  // selected leg).
  const routeOptions = useRouteOptions(trip);

  // Which alternative the traveller picked, per destination pair, by
  // `RouteOption.id`. Named rather than stored as hops on purpose (see
  // `pickRoutes`): the choice survives the engine being re-run with
  // better data, where a snapshot of its output would not.
  const [chosenRoutes, setChosenRoutes] = useState<Record<HopId, string>>({});

  const routes = useMemo(
    () => (routeOptions.size === 0 ? NO_ROUTES : pickRoutes(routeOptions, chosenRoutes)),
    [routeOptions, chosenRoutes],
  );

  const legs = useMemo(
    () => deriveLegs(trip, routes, defaultMode),
    [trip, routes],
  );

  // Everything the onboarding popup's third question needs, and
  // nothing else: the leg OUT OF the origin is the only one it asks
  // about, because it is the only one whose starting point the
  // traveller has just told us.
  const firstLeg = useMemo(() => firstLegChoice(trip, routeOptions), [
    trip,
    routeOptions,
  ]);

  // What the popup's last two steps show as ticked. Derived from the
  // trip rather than tracked alongside it — the trip is the answer to
  // "is this on my list", and a second copy would be a second answer.
  const stayPlaceIds = useMemo(() => placeIds(trip.stays), [trip.stays]);
  const activityPlaceIds = useMemo(
    () => placeIds(trip.activities),
    [trip.activities],
  );

  return (
    <div className="flex h-screen flex-col bg-bark-100 text-bark-800">
      {/*
        Rendered inside the shell rather than beside it: a modal
        <dialog> lives in the browser's top layer regardless of where
        it sits in the tree (see DESIGN.md's Stacking Order Rule), so
        the position here is about who owns the state, not paint order.
        Each answer dispatches immediately, so the map and the list
        fill in behind the scrim as the questions are answered.
      */}
      <Welcome
        open={welcoming}
        onOrigin={(place) => dispatch({ type: "set-origin", place })}
        onDestination={(place) =>
          dispatch({
            type: "add-destination",
            destination: { id: newId("dest"), place, status: "idea" },
          })
        }
        onDone={() => setWelcoming(false)}
        firstLegOptions={firstLeg?.options}
        chosenRouteId={firstLeg && chosenRoutes[firstLeg.pair]}
        accessMode={firstLeg?.accessMode}
        onPickAccessMode={(hop, mode) =>
          dispatch({ type: "set-hop-override", hop, patch: { mode } })
        }
        onPickRoute={(optionId) =>
          firstLeg &&
          setChosenRoutes((chosen) => ({ ...chosen, [firstLeg.pair]: optionId }))
        }
        chosenStayIds={stayPlaceIds}
        chosenActivityIds={activityPlaceIds}
        // The popup knows a place; the trip knows a `Stay`. Untick has
        // to cross that gap, which is why removal looks up the row
        // rather than being handed an id the popup never had.
        onToggleStay={(item, add) =>
          add
            ? dispatch({
                type: "add-stay",
                place: item.place,
                stayType: item.type,
              })
            : forEachMatch(trip.stays, item.place.id, (stay) =>
                dispatch({ type: "remove-stay", stayId: stay.id }),
              )
        }
        onToggleActivity={(item, add) =>
          add
            ? dispatch({
                type: "add-activity",
                place: item.place,
                category: item.category,
              })
            : forEachMatch(trip.activities, item.place.id, (activity) =>
                dispatch({ type: "remove-activity", activityId: activity.id }),
              )
        }
      />

      <header className="flex shrink-0 items-center gap-4 border-b border-bark-200 bg-parchment px-4 py-2.5">
        {/*
          The one place the display face appears in the running app.
          The trip's name is the only thing on screen that belongs to
          this trip rather than to the tool, so it's the only thing
          set in something other than the interface's own voice.
        */}
        <div className="min-w-0">
          <h1 className="truncate font-display text-display text-bark-900">
            {trip.title}
          </h1>
          <p className="text-caption text-bark-600">
            {trip.travellers}{" "}
            {trip.travellers === 1 ? "traveller" : "travellers"}
          </p>
        </div>

        <div className="flex-1" />

        <CostSummary trip={trip} legs={legs} />
      </header>

      {/*
        `flex-col-reverse` on narrow screens puts the map on top while
        keeping the itinerary first in the DOM — so keyboard and screen
        reader users reach the thing they came to edit before the
        decorative-by-comparison map.
      */}
      <div className="flex min-h-0 flex-1 flex-col-reverse lg:flex-row">
        <aside className="flex min-h-0 flex-1 flex-col border-t border-bark-200 lg:w-108 lg:flex-none lg:border-t-0 lg:border-r">
          <ItineraryPanel
            state={state}
            legs={legs}
            routes={routes}
            dispatch={dispatch}
            selectedLegId={selectedLegId}
            onSelectLeg={setSelectedLegId}
          />
        </aside>

        <main className="h-[45vh] shrink-0 lg:h-auto lg:min-h-0 lg:flex-1">
          <TripMap
            legs={legs}
            selectedLegId={selectedLegId}
            onSelectLeg={setSelectedLegId}
            // Loaded and painted, but held still: motion behind a scrim
            // is movement you can see and can't attend to.
            forcePaused={welcoming}
          />
        </main>
      </div>
    </div>
  );
}

export default App;
