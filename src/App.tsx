// ============================================================
// The shell: trip state, and the split between list and map.
//
// State lives here because the itinerary and the map are two views of
// one `Trip` and both need to read it — and because selection is
// shared: clicking a line highlights a card, clicking a card
// highlights a line. Neither owns it, so their common parent does.
//
// WHAT CHANGED WITH THE INVERSION: legs used to be parked in reducer
// state beside the trip, which meant an edit could write to a derived
// copy that nothing ever recomputed. Now the reducer holds ONLY the
// trip, and legs are derived here, once per change, from
// `trip.destinations` plus whatever routes are known. There is exactly
// one place a fact about the trip can live, so there is nothing to
// keep in sync.
//
// Still a plain `useReducer` over one object, per the README. A store
// library would buy nothing at this size.
// ============================================================

import { useMemo, useReducer, useState } from "react";

import { CostSummary } from "./cost/CostSummary";
import { ItineraryPanel } from "./itinerary/ItineraryPanel";
import { planReducer } from "./itinerary/planReducer";
import { TripMap } from "./map/TripMap";
import { defaultMode } from "./itinerary/plausibleModes";
import type { RouteMap, Trip } from "./model/trip";
import { deriveLegs, findGaps, sampleTrip } from "./model/trip";

// TODO(unit-6): an empty `RouteMap` because the route engine doesn't
// exist yet. This is a supported state, not a stub: `deriveLegs`
// degrades to one placeholder hop per destination pair — moded by
// geography, so the Atlantic crossing still comes out as a flight —
// and `findGaps` reports every pair as unrouted, which is exactly what
// is true. The app renders, the map draws, and the panel says the legs
// are guesses. Swapping this for real routes changes nothing else here.
const NO_ROUTES: RouteMap = new Map();

const initialState = (trip: Trip) => ({ trip });

function App() {
  const [state, dispatch] = useReducer(planReducer, sampleTrip, initialState);
  const [selectedLegId, setSelectedLegId] = useState<string>();

  const { trip } = state;

  // Derived, never stored — and memoised because the map diffs its
  // sources by identity, so a fresh array on every render would make
  // it redraw for a change it didn't have.
  const legs = useMemo(() => deriveLegs(trip, NO_ROUTES, defaultMode), [trip]);
  const gaps = useMemo(() => findGaps(trip, NO_ROUTES), [trip]);

  // A selected leg can stop existing under you: remove Porto, or drag
  // it above Lisbon, and `lisbon->porto` is no longer a journey this
  // trip contains. Left alone the app would go on believing something
  // was selected — nothing highlighted, but the highlight springing
  // back if the reorder were undone. Cleared during render rather than
  // from an effect so no frame is painted against a dead selection.
  if (
    selectedLegId !== undefined &&
    !legs.some((leg) => leg.id === selectedLegId)
  ) {
    setSelectedLegId(undefined);
  }

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
            dispatch={dispatch}
            legs={legs}
            gaps={gaps}
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
