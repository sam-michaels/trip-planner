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

import { useReducer, useState } from "react";

import { CostSummary } from "./cost/CostSummary";
import { ItineraryPanel } from "./itinerary/ItineraryPanel";
import { tripReducer } from "./itinerary/tripReducer";
import { TripMap } from "./map/TripMap";
import { sampleTrip } from "./model/trip";

function App() {
  const [state, dispatch] = useReducer(tripReducer, { trip: sampleTrip });
  const [selectedLegId, setSelectedLegId] = useState<string>();

  const { trip } = state;

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

        <CostSummary trip={trip} />
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
            selectedLegId={selectedLegId}
            onSelectLeg={setSelectedLegId}
          />
        </aside>

        <main className="h-[45vh] shrink-0 lg:h-auto lg:min-h-0 lg:flex-1">
          <TripMap
            trip={trip}
            selectedLegId={selectedLegId}
            onSelectLeg={setSelectedLegId}
          />
        </main>
      </div>
    </div>
  );
}

export default App;
