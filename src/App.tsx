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
import type { RouteMap, Trip } from "./model/trip";
import { deriveLegs, sampleTrip } from "./model/trip";
import { buildRouteMap } from "./lib/routing";

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

/**
 * The route engine, run whenever the destinations change.
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
function useRoutes(trip: Trip): RouteMap {
  const [routes, setRoutes] = useState<RouteMap>(NO_ROUTES);

  useEffect(() => {
    let cancelled = false;

    buildRouteMap(trip).then((next) => {
      if (!cancelled) setRoutes(next);
    });

    return () => {
      cancelled = true;
    };
    // Keyed on the places, not the whole trip: renaming the trip or
    // editing a hop's cost changes `trip` without changing a single
    // question the engine was asked.
  }, [routeKey(trip)]);

  return routes;
}

/** The destinations, in order — everything `buildRouteMap` actually reads. */
function routeKey(trip: Trip): string {
  return [trip.origin, ...trip.destinations.map((d) => d.place)]
    .map((place) => place.id)
    .join(">");
}

function App() {
  // `TripState` holds only `trip` and an optional `undo` snapshot —
  // legs are never state (see the banner on `tripReducer.ts`), so
  // there is nothing left to compute for an initial value.
  const [state, dispatch] = useReducer(tripReducer, { trip: sampleTrip });
  const [selectedLegId, setSelectedLegId] = useState<string>();

  const { trip } = state;

  // Memoised on the trip, not recomputed on every render: deriving
  // once per edit is the whole point of the derive-don't-store rule,
  // not once per render of an unrelated bit of state (like the
  // selected leg).
  const routes = useRoutes(trip);

  const legs = useMemo(
    () => deriveLegs(trip, routes, defaultMode),
    [trip, routes],
  );

  return (
    <div className="flex h-screen flex-col bg-bark-100 text-bark-800">
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
          />
        </main>
      </div>
    </div>
  );
}

export default App;
