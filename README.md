# trip-planner

A multi-leg trip planning tool that visualizes an entire journey on a map — every
leg drawn in the style of its transport mode — alongside a running cost estimate
and suggestions for things to do.

The problem it solves: booking sites each own one slice of a trip (a flight, a
train, a hotel) and none of them show you the whole thing. This tool is the
missing plan layer that sits above all of them.

**Motivating real trip:** London ON → Toronto (bus/train) → Lisbon (flight) →
Porto (train) → onward through Spain and Morocco. Build against this itinerary,
not invented data.

---

## Status

| Area                                                              | State       |
| ------------------------------------------------------------------ | ----------- |
| Core data model — destinations-first, legs derived (`src/model/trip.ts`) | **Done** |
| MapLibre renderer — mode-aware leg rendering (`src/map/`)          | **Done**    |
| Route engine — proposes hop chains between destinations (`src/lib/routing.ts`) | **Done** |
| Itinerary editor — destinations, hop overrides, drag/keyboard reorder | **Done** |
| Cost rollup + multi-currency display                               | **Done**    |
| First-run onboarding — origin, destinations, access mode, stay/activity shortlist | **Done** |
| Nearby stay/activity suggestions (Overpass)                        | **Done**    |
| Flight pricing / real fares                                        | Not started |
| Persistence + deep links out to booking sites                      | Not started |

Vite + React + TS + Tailwind, no backend. State is a single `Trip` object held
in `useReducer` in `src/App.tsx`; nothing is written to disk yet, so a reload
restores `emptyTrip` and the app asks the onboarding questions again. That's
the next piece of unstarted work, alongside real flight pricing.

The model went through one big inversion since the project started: it used to
store `legs` directly, then moved to storing an ordered list of `destinations`
with legs *derived* from them by the route engine — see "The one idea to
understand first" below. Everything past that point describes the current
shape, not the history.

---

## The one idea to understand first

**A trip is an ordered list of destinations.** A destination is a city you want to
be in, for some number of nights. Everything else follows from that list: the
**legs** — one continuous movement from A to B by one mode — are *derived*, by
asking a route engine how to get between each consecutive pair and then applying
whatever the user said about individual hops. Stays and activities attach to the
places you stop at.

The map, the cost rollup, and the day-by-day view are not three features — they
are three renderings of that single list. Before adding anything, ask whether it
can be expressed as a destination, a hop override, a stay, an activity, or a
function derived from them. If it can't, that's a signal the model needs
discussion, not a workaround.

**Why destinations and not legs**, since this inverts the original design: nobody
plans a trip by naming a bus. Planning starts at "Lisbon and Porto, maybe four
nights each" — the transport, the dates and the intermediate airports are
consequences, worked out later and often revised. A leg-first model makes you
invent a departure time before you can record where you want to go.

### How a screen actually gets built, end to end

1. **`src/App.tsx`** holds the only state: one `Trip` in a `useReducer`
   (`tripReducer.ts`). It starts as `emptyTrip` — no origin, no destinations —
   and `Welcome.tsx` (a native `<dialog>`) opens over it asking, in order:
   where you are, where you're going, how you'd reach the airport, and (once
   there's at least one destination) a shortlist of stays and activities for
   it. Answers dispatch straight into the same reducer the rest of the app
   uses.
2. Whenever the trip's places change, `useRouteOptions` (in `App.tsx`) calls
   `proposeTripRoutes()` in **`src/lib/routing.ts`** — the route engine. For
   each consecutive destination pair it works out plausible ways to get there
   (ground routes via `plausibleModes.ts` + `geo.ts`'s country/continent
   table, or an airport-to-airport chain via `hubs.ts` and the flight-route
   dataset), and returns several ranked options, never a single answer.
3. `pickRoutes()` collapses those options (using whatever the user picked in
   the onboarding popup, or the top-ranked one) into a `RouteMap`. That, plus
   the trip, goes into **`deriveLegs()`** (`src/model/trip.ts`), which
   produces the actual `Leg[]` for this render — folding in any
   `Trip.hopOverrides` the user has typed (a price, a booked status, a real
   departure time) on top of the engine's proposal.
4. That single `Leg[]` is handed to three independent renderers: **`TripMap`**
   draws it as GeoJSON on MapLibre, **`ItineraryPanel`** renders it as the
   editable card list, and **`CostSummary`** sums it into a per-currency
   total. None of them talk to each other directly — `App.tsx` also tracks
   which leg/destination is selected, so a click on the map highlights the
   matching card and vice versa.

Nothing above is persisted. A page reload starts back at `emptyTrip` and asks
the onboarding questions again.

---

## Stack

- **React 19 + Vite + TypeScript + Tailwind 4** — frontend, no backend. There
  is no server anywhere in this repo; every external call below is made
  directly from the browser.
- **MapLibre GL JS** — mapping. Chosen over Mapbox GL because it's fully open
  source with no access token and no usage ceiling. Tiles come from MapTiler's
  free tier (`VITE_MAPTILER_KEY` in `.env.local`, see `.env.example`).
- **`@turf/great-circle` + `@turf/helpers`** — just the great-circle arc math
  for flight paths, not the full Turf.js package.
- **lucide-react** — icons. Tree-shaken; the map's mode markers are vendored
  SVG paths copied out of it rather than the React components themselves (see
  `map/modeSprites.ts` for why).
- **Vitest + jsdom** — unit tests, 12 test files across the model, route
  engine, reducer, and a couple of components.
- **oxlint** — linting.

State management is a single `useReducer` over one `Trip` object in
`src/App.tsx`. No Redux/Zustand — there's been no demonstrated need for one.
A backend (FastAPI was the original plan) and Docker deployment remain
unbuilt; they were only ever meant to show up once real external APIs
(flight pricing, persistence) required a server, and that step hasn't
started yet.

---

## Non-negotiable conventions

These are the rules that prevent whole classes of bug. Follow them even when a
shortcut looks harmless.

### 1. Coordinates are `[longitude, latitude]`

GeoJSON order. MapLibre and Turf both expect it. Humans say "lat, lng", so the
temptation to flip is constant — and because both values are `number`, TypeScript
cannot catch a flip. It fails **silently**: the marker lands near (0,0) in the
Gulf of Guinea instead of throwing.

Always construct coordinates via the `coords(lng, lat)` helper. Never write a
raw tuple literal.

### 2. Money is never a bare number

The trip spans CAD, EUR, and MAD. `cost: 45` has permanently lost its meaning.
Store `Money { amount, currency }` in the currency actually paid. **Convert only
at display time** — exchange rates move, and stored records should stay true.

`totalByCurrency()` deliberately returns a per-currency breakdown rather than one
converted figure, so totals never require a network call to be correct. That
breakdown is the **truth**; converting it is a **view**. See "Cost is one number".

### 3. Derive, don't store

There is no `totalCost` field and no stored `legs` array, by design. Both are
computed (`totalByCurrency()`, `deriveLegs()`). A stored derived value goes stale
the moment something upstream is edited. Do not add cached totals without a
measured performance reason.

**The one deliberate exception is destination order**, which is array position in
`Trip.destinations` and nothing else. The model used to derive leg order from
`departure` on exactly the reasoning above — but that assumed there was always
something to sort by. Every date here is optional, because "Porto, no idea when"
is the normal early state, so a derived order has nothing to derive from.
Sequence is the first real decision a traveller makes, so it is first-class data.
Reordering is a splice; it never rewrites a date you typed.

Because legs are thrown away and rebuilt, anything the user says about one is
stored in `Trip.hopOverrides`, keyed by `hopId(from, to)` — the place pair, never
an index. Reorder the destinations and the override stays attached to the same
physical journey; change a hop's endpoints and it is a different journey, which
correctly starts fresh. See the HOP IDENTITY banner in `src/model/trip.ts`.

### 4. `status` drives the visual language

Every leg, stay, and activity carries `'idea' | 'planned' | 'booked'`. This is
what makes it a planning tool rather than a receipt folder — you sketch "train to
Seville, roughly €40, around the 12th" months before buying anything.

The map must reflect this: tentative items rendered dashed/faded, booked items
solid. A user should be able to glance at the map and see what's still open.

The editor follows the same language, so the list and the map read the same way.

**One channel per fact**, which is the rule that keeps this legible:

| Fact | Channel | Where |
| --- | --- | --- |
| What kind of journey | **Mode colour + icon** | `MODE_COLORS` / `MODE_ICONS` in `itinerary/labels.ts` |
| How firm the plan is | **Status colour**, and solid vs dashed | `STATUS_COLORS` / `STATUS_PILL_CLASSES` in `itinerary/labels.ts`; `STATUS_OPACITY` in `map/style.ts` |
| Which leg you're looking at | **A halo** in that leg's own mode colour | the `-highlight` layer |

Mode and status get **separate palettes and never share a swatch**. The status
pill used to be painted in the mode's colour, which meant "Idea" was terracotta
on the flight and pine on the train — so the pill that exists precisely to let
you sweep the list and count what's still unbooked was a different colour on
every row. Status is a property of the plan, not of the journey; it gets its own
three colours and uses them everywhere.

Colour and icon deliberately both encode mode. That's reinforcement, not
redundancy: the icon is what you read on a card at arm's length, the colour is
what picks one route out of four crossing the same corner at country zoom, where
a 22px glyph is too small to identify.

The palette is **soft forest** — earthy, desaturated, pastel. Five named scales in
`src/index.css` (`bark` for neutrals, plus `moss`, `ochre`, `rust`, `heather`)
and `parchment` for anything that floats above the page. The rule is that chrome
is pastel and content is not: surfaces, borders and pills live at 50-200 so they
read as paper and shade, while anything carrying meaning — a mode, a status, a
warning — sits at 400-600, dark enough to be told apart at a glance and to
survive being drawn 3px wide over a basemap.

An earlier pass drew everything in slate and near-black, which was legible and
completely joyless — a trip that is mostly `idea` legs, i.e. every trip worth
planning, looked like a failure state rather than one taking shape. Ideas are the
most exciting thing in the list and should not be the greyest, which is why
`idea` is heather rather than grey, and why the progression heather → ochre →
moss runs cool to warm to settled.

The map basemap is MapTiler's `landscape` rather than `streets-v2` for the same
reason: the map is half the screen, so whatever palette it brings *is* the app's
palette, and a saturated navigation style — blue water, bright parks, orange
motorways — left the six muted route colours nowhere to sit.

### 5. Times are local wall-clock, with no timezone offset

`departure` and `arrival` are stored as `"2026-09-12T14:00"` — ISO 8601 with no
`Z` and no offset. Enforced by the helpers in `src/itinerary/datetime.ts`; never
write a raw `toISOString()` into a leg.

Three reasons, in order of how badly each bites:

1. **Timestamps get compared as strings**, with `localeCompare`. That is only
   correct while every timestamp shares one format. Mixing `"2026-09-12T14:00"`
   with `"2026-09-12T14:00:00Z"` compares by punctuation, and whatever depended
   on the comparison is silently wrong — the same silent-failure shape as the
   `[lng, lat]` flip.
2. `<input type="datetime-local">` speaks exactly this string, so the form
   boundary needs no conversion, and conversion is where timezone bugs breed.
3. It's what the ticket says. A boarding pass reading 14:05 means 14:05 where
   you're standing.

**The cost, and how it's handled:** subtracting two of these across timezones is
not a real duration. Toronto 20:15 → Lisbon 08:30 is a 7-hour flight that this
arithmetic calls 12h15m.

`itinerary/duration.ts` therefore computes a duration **only when it can be
trusted** — when both endpoints are in the same country and within 15° of
longitude — and otherwise shows "crosses time zones" instead of a number. A wrong
duration gets believed and planned around; a missing one gets looked up.

The number the itinerary most wants is safe regardless: time spent *in* a place
has both endpoints in that same city, so the timezone cancels out.

To show real cross-timezone durations, resolve each endpoint's zone from
`Place.coords` first. Longitude/15 is not good enough — it puts Toronto→Lisbon
out by over an hour.

### 6. Every field that could be unknown is optional

An `idea` leg has no times, no operator, no booking reference. Components must
render gracefully with almost everything missing. Do not require fields to make
a component simpler.

---

## Map rendering notes

Different modes need genuinely different geometry — this is not just styling:

- **Flights** — do not route. Use `turf.greatCircle(from, to)` to draw the curved
  path. Watch for the antimeridian: Turf handles the split, but the resulting
  MultiLineString must be fed to MapLibre correctly or the line wraps across the
  whole map. Not an issue for this trip's routes, but don't hardcode the
  assumption.
- **Train / bus / car** — a real routed polyline is ideal. OSRM's public demo
  server is free for driving profiles but is rate-limited and explicitly not for
  production. There is no free rail-routing service; a styled straight line
  between stations is acceptable and reads fine at country zoom levels. Not
  worth solving rail routing for.
- **Ferry / walk** — straight line and short routed line respectively.

Render legs as a single GeoJSON source with a `mode` and `status` property, then
drive appearance through MapLibre data-driven styling expressions. One layer with
expressions beats six layers with duplicated logic.

Six layers now read that one source (`src/map/style.ts`), bottom to top: an
invisible 20px `-hit` line so thin routes are actually clickable, a white
`-casing` that lifts routes off the basemap, a `-highlight` glow filtered to the
selected leg, the `-dashed`/`-solid` pair split by status, and a `-markers`
symbol layer that repeats the mode's icon along the line every 130px.

Selection is a filter swap, never a source rebuild — the GeoJSON describes the
trip, not the UI's current state.

**Line colour comes off the feature** (`["get", "color"]`), not from a lookup in
the style file, so `style.ts` knows nothing about how many modes exist.

**The marker sprites are vendored lucide geometry**, not the React components.
`lucide-react` doesn't publicly export its path data, and the two ways to reach
it were both worse than copying it: `react-dom/server` renders the real component
but costs +61KB gzipped in the browser bundle (measured), and deep-importing
`__iconNode` relies on an internal path with no `exports` entry that a version
bump can move silently. See the header of `map/modeSprites.ts` for how to refresh
them after a lucide upgrade.

---

## Itinerary editor notes

### Reordering is a plain splice, not a date rewrite

Destinations carry **explicit order** — array position in `Trip.destinations`,
nothing else (see "Derive, don't store" above). So a drag or a keyboard move
dispatches a `MOVE_DESTINATION`-style action that does exactly one thing:
`destinations.splice(from, 1)` then `destinations.splice(to, 0, moved)` in
`tripReducer.ts`. There is no date to rewrite and no smallest-edit search to
run — the `reorder.ts` module that used to do that work under the old
legs-first model is gone.

Hop overrides survive a reorder for free: they're keyed by `hopId(from, to)`
(the place pair), not by position, so a booking typed against "Lisbon → Porto"
stays attached to that journey wherever it ends up in the list.

Drag-and-drop is HTML5 DnD, which touch devices don't fire. `Alt`+`↑`/`↓` on a
focused card does the same move through the same reducer action, which also
covers keyboard users.

### Undo is one slot, deliberately

Filled only by `remove-destination` — the one action that can lose work you
didn't explicitly type. Reordering used to fill it too, back when a drag could
silently rewrite a date; now that order is explicit array position (see
above), a drag is nothing but a splice and has nothing to undo. Ordinary field
edits don't fill the slot either — you can see what you changed, and an undo
prompt after every keystroke is noise. Removing a destination even leaves its
`hopOverrides` in place so re-adding it restores exactly what you had. If this
ever needs to become a real history stack, `TripState.undo` is the seam.

### Cost is one number

The header used to show `CA$1,850` and `€64` side by side. That is what the model
stores and it is not what anyone wants to know — it asks the reader to do
currency conversion in their head to answer the only question they had. You pay
one credit card bill, in one currency.

So `cost/CostSummary.tsx` shows a single total in `trip.homeCurrency`, with the
per-currency breakdown behind a disclosure. The breakdown stays reachable
because a converted total rests on a rate that moved this morning, and being able
to check the arithmetic is what makes an estimate trustworthy rather than magic.

**Multi-currency means conversion at the point of entry**, not multiple totals:
type a fare in EUR on a Portuguese rail site and the editor shows `≈ CA$52` under
it. The leg still stores EUR.

Rates come from `open.er-api.com` — free, no key, ~160 currencies including MAD.
ECB/Frankfurter was rejected: its ~30-currency reference set has no dirham, and
this trip ends in Morocco. If rates fail to load, the UI degrades to the raw
per-currency breakdown rather than to a wrong number or a blank.

### Only offering modes that are possible

`itinerary/plausibleModes.ts` narrows the mode picker using distance plus a
country→continent table (`lib/geo.ts`). Toronto → Lisbon offers flight and
nothing else, and says why. A four-kilometre airport transfer offers train, bus,
car and walk, but not flight.

Distance alone can't do this: Toronto→Lisbon and Cairo→Cape Town are both about
5,700km and only one has an ocean in the way. Hence the continent table, and
hence Europe and Africa are deliberately *not* land-connected in it — the Strait
of Gibraltar is why the Algeciras–Tanger ferry exists and matters here.

**Ruled-out modes stay reachable** behind "other modes". These are heuristics,
and heuristics are wrong sometimes — a Moroccan grand taxi, a repositioning
ferry. Narrow the default, never block the plan.

### The strip between two legs

`itinerary/LegConnector.tsx` owns the space between cards, and it always says
something, because that space is where the trip actually happens. Three nights in
Lisbon is the point of going to Lisbon; the flight is just how you got there. It
shows a hard gap, else a soft gap, else how long you're there — over a run of
translucent dots whose length scales with the stay.

**Soft gaps stopped looking like errors.** Arriving at an airport and leaving
from a downtown station is not a mistake, it's the normal shape of a trip, and
every itinerary has several. Painting them red meant the list was permanently
full of alarms about nothing, which is how people learn to ignore the hard gaps
that do matter. It's now an offer — "Getting across Lisbon", with a button that
opens a transfer already pointed at both stations and dated to when you land.

### Dependencies

- **lucide-react** — transport-mode and UI icons. Solves having six hand-drawn
  transport SVGs that look homemade next to real typography. Tree-shaken, so only
  the ~12 icons used ship. Removing it means writing those SVGs as local
  components and swapping the imports in `src/itinerary/labels.ts`; nothing else
  touches it.

---

## External API landscape — read before planning any integration

This is the part most likely to be wrong in a model's training data. Current as
of August 2026:

- **Amadeus Self-Service API is dead.** Registrations paused February 2026, portal
  decommissioned **July 17, 2026**. It was the obvious free option and is no
  longer available. Do not scaffold against it.
- **Duffel** is the practical replacement for flights. Transparent pricing:
  ~$3 per confirmed order, plus an excess-search fee past a 1,500:1
  search-to-book ratio. **Test mode is free** but sandboxed against a fake
  airline, so prices and schedules are not realistic — fine for wiring up the
  integration, useless for real estimates. Duffel also covers stays, so flights
  and hotels can come from one integration.
- **Kiwi.com Tequila** closed self-serve signups in 2026; invite-only partner
  program now. Not an option for a solo build.
- **European rail has no unified API.** Every operator has its own booking logic
  and ticketing rules with no shared standard. Renfe (Spain) and CP (Portugal)
  expose nothing public. Resellers like All Aboard exist but are B2B
  partnerships. **Plan for manual fare entry plus static estimates.**
- **Attractions and stays** — built against **Overpass** (`lib/poiApi.ts`), not
  OpenTripMap as originally planned: free, no key, and the same OSM data
  Nominatim already resolves places against. Trade-off is inconsistent tagging
  — an unnamed/oddly-tagged POI is dropped rather than guessed at. `ponytail:`
  comment in that file names OpenTripMap as the upgrade path if OSM's
  attraction tagging proves too thin.
- **Geocoding** — Nominatim is free with a strict usage policy (attribution, 1
  req/sec, real User-Agent). Photon is a friendlier alternative for autocomplete.
  The `PlacePicker` debounces 400ms to stay inside that budget.
- **Home location** — the browser's Geolocation API, reverse-geocoded through
  Nominatim (`lib/homeLocation.ts`). Never throws: permission denial, timeout,
  and "found coordinates but no nearby city" are distinct tagged outcomes the
  onboarding UI reacts to differently, not one generic failure.
- **Flight route plausibility (not pricing)** — `lib/hubs.ts` (a small curated
  table of intercontinental hubs) plus `lib/flightRoutes.ts`, generated from
  OpenFlights' `routes.dat` by `scripts/buildFlightRoutes.ts` into the
  committed `lib/flightRoutes.data.ts`. This answers "does a flight plausibly
  exist between these airports", not "what does it cost" — no free source
  answers that, which is why cost stays manual entry.
- **REST Countries is dead for browser use.** v3.1 was deprecated in 2026, and
  every endpoint — v3.1 and v5 alike — now 301s to a static file host that sends
  no `Access-Control-Allow-Origin` header, so the redirect fails CORS before the
  response is read. `curl` still works, which is how the vendored country→currency
  table in `lib/currencyApi.ts` was generated. **The original "why a network call
  and not a bundled table" reasoning in that file is now reversed**, and the file
  says so.
- **FX rates** — `open.er-api.com`, free and keyless, ~160 currencies. Verified
  to include MAD, which ECB-derived sources do not.

### Scope guardrail

**v1 does not book anything.** It plans, visualizes, estimates, and then deep-links
out to Trainline / Omio / Booking.com / the airline. Building a booking flow means
payment handling, PCI scope, cancellation logic, and support obligations — all of
which would swallow the project before the useful part exists.

If a request seems to imply in-app booking, confirm intent with the owner before
building it.

---

## Structure

The actual `src/` tree, grouped by what each piece owns:

```
src/
  App.tsx                 # the only state: one Trip in useReducer; wires the
                           # route engine's async results into deriveLegs(),
                           # holds cross-panel selection (map <-> list)
  main.tsx                 # Vite entry point

  model/
    trip.ts                # the types (Trip, Destination, Leg, Place, Money,
                           # HopOverride...) + derive-don't-store functions:
                           # deriveLegs(), totalByCurrency(), findGaps()

  onboarding/               # the first-run popup, five questions before the
    Welcome.tsx             # shell means anything (native <dialog>, WCAG-driven)
    AccessRow.tsx            # step 3: how you'd reach the airport
    SuggestionStep.tsx       # steps 4-5: nearby stay/activity shortlist

  itinerary/
    ItineraryPanel.tsx      # the destination list: editor, drop targets, undo
    DestinationPicker.tsx    # search + add a destination (Nominatim)
    PlacePicker.tsx          # generic place search used by a few pickers
    HopEditor.tsx             # the per-hop override form (mode/cost/times/booking)
    LegCard.tsx / LegConnector.tsx  # one leg, and the strip between two legs
                             # (nights, gaps, "getting across town" offers)
    hopOverrides.ts           # HopOverride helpers, keyed by hopId(), not index
    interludes.ts             # stays/activities squeezed between two legs
    InspirationGrid.tsx       # popular-destination suggestions
    tripReducer.ts            # every trip edit: destination + hop-override
                             # writes only — legs are never state (see its banner)
    plausibleModes.ts         # which modes a hop could actually use, by distance
                             # + continent adjacency
    datetime.ts / duration.ts # wall-clock time format; durations, and when NOT
                             # to show one (cross-timezone hops)
    labels.ts                 # mode colours/icons, status vocabulary, money formatting
    fields.tsx                 # small shared form field components

  lib/
    routing.ts                # THE ROUTE ENGINE — proposeTripRoutes(), the
                             # RouteMap deriveLegs() consumes. Ground vs. air
                             # chains, ranked, never a single forced answer.
    hubs.ts                   # curated intercontinental-hub airports
    flightRoutes.ts / flightRoutes.data.ts  # OpenFlights-derived route-exists
                             # lookup (generated by scripts/buildFlightRoutes.ts)
    geo.ts                    # distance + country -> continent adjacency
    homeLocation.ts            # Geolocation API -> reverse-geocoded Place
    placesApi.ts               # Nominatim search + OurAirports nearest-airport lookup
    poiApi.ts                  # Overpass: nearby stays/activities
    popularDestinations.ts     # static list backing InspirationGrid
    currency.ts / currencyApi.ts  # FX fetch + conversion (display-time only);
                             # vendored country -> currency table
    countries.ts               # country code/name data

  map/
    TripMap.tsx                # MapLibre container, selection sync, bounds-fitting
    geometry.ts                 # leg -> GeoJSON, great-circle arcs
    style.ts                    # mode/status -> paint expressions, layer ids
    path.ts                     # per-leg pixel path (antimeridian-safe)
    vehicles.ts                  # animated vehicle markers travelling each leg
    modeSprites.ts                # vendored lucide icon paths, rasterized for MapLibre
    MotionControl.ts              # the map's play/pause-motion control

  cost/
    CostSummary.tsx        # one home-currency total + the per-currency
                           # breakdown behind a disclosure
    useRates.ts             # FX rates as React state, wrapping lib/currency.ts

scripts/
  buildFlightRoutes.ts     # build-time generator: OpenFlights routes.dat ->
                           # lib/flightRoutes.data.ts. Run manually, output committed.
```

No `legs` field anywhere in state — every module above that touches a `Leg`
receives it as an argument, freshly computed from `deriveLegs()`.

---

## Working agreements

The owner is building this partly to learn the codebase deeply enough to maintain
it. That shapes how to work here:

- **Explain the why, not just the what.** Comments should capture reasoning and
  trade-offs, not restate the code. The existing model file is the reference for
  tone and density.
- **Prefer boring, legible solutions** over clever ones. If there's a choice
  between a compact idiom and an obvious one, take the obvious one.
- **Introduce dependencies one at a time**, with a sentence on what problem it
  solves and what it would take to remove it.
- **Build incrementally and stop between steps.** Do not scaffold five features
  ahead of what was asked.
- **Ask rather than assume** on product questions. Several are still open (below).

---

## Open questions for the owner

1. Should stays and activities stay as separate types, or merge into one
   "thing that happens at a place"? Currently separate — they have different
   shapes (stays span nights, activities span hours) and render differently.
2. Morocco travel is largely buses and grands taxis, not trains. Is `bus`
   sufficient, or is a `shared-taxi` mode needed?
3. Single-user local tool, or multi-user with accounts? Determines whether a
   backend and auth are needed at all.
4. Is collaborative editing wanted (trip is being planned with a partner), or is
   export/share-link enough?
5. ~~Mobile use while travelling, or desktop planning only?~~ **Decided:
   desktop-first, mobile-tolerant.** Split pane (itinerary beside a full-height
   map) above `lg`, stacking to map-on-top / list-below below it. Offline support
   is still out of scope. The one thing that genuinely degrades on touch is
   drag-to-reorder, since HTML5 DnD doesn't fire — if planning on a phone turns
   out to matter, that's the piece to replace with pointer events.
