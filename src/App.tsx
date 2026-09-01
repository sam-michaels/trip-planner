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

import { useMemo, useReducer, useState } from "react";

import { CostSummary } from "./cost/CostSummary";
import { ItineraryPanel } from "./itinerary/ItineraryPanel";
import { tripReducer } from "./itinerary/tripReducer";
import { TripMap } from "./map/TripMap";
import { defaultMode } from "./itinerary/plausibleModes";
import type { RouteMap } from "./model/trip";
import { deriveLegs, sampleTrip } from "./model/trip";

// TODO(wave-2): an empty `RouteMap` because Unit 6's route engine
// (src/lib/routing.ts) isn't wired in here yet. `deriveLegs` degrades
// to one placeholder hop per destination pair — moded by geography, so
// the Atlantic crossing still comes out as a flight — which is enough
// to seed the itinerary and the map until the engine is connected.
const NO_ROUTES: RouteMap = new Map();

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
  const legs = useMemo(
    () => deriveLegs(trip, NO_ROUTES, defaultMode),
    [trip],
  );

  return (
    <div className="flex h-screen flex-col bg-bark-100 text-bark-800">
      <header className="flex shrink-0 items-center gap-4 border-b border-bark-200 bg-parchment px-4 py-2.5">
        <div className="min-w-0">
          <h1 className="truncate text-base font-semibold">{trip.title}</h1>
          <p className="text-xs text-bark-500">
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
