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

| Step | What                                                           | State       |
| ---- | --------------------------------------------------------------- | ----------- |
| 1    | Core data model (`trip.ts`) — destination-first                 | **Done**    |
| 2    | MapLibre renderer — mode-aware leg rendering                    | **Done**    |
| 3a   | Itinerary editor UI — being rebuilt around destinations          | In progress |
| 3b   | Itinerary editor UI — stays and activities                       | Not started |
| 4    | Cost rollup + multi-currency display                             | **Done**    |
| 5    | External data: flight/train/bus ticket pricing, attractions      | Not started |
| 6    | Persistence + deep links out to booking sites                    | Not started |

The model inverted from leg-first to destination-first: `Trip.destinations` is
now the spine, order is explicit array position instead of something derived
from `departure`, and legs are *derived* from consecutive destination pairs by
a route engine, with per-hop corrections kept in `Trip.hopOverrides`.
`Trip.legs` is gone, and so is the model's `orderedLegs()` — the function that
used to sort legs by `departure` no longer exists in `model/trip.ts`. A
same-named `orderedLegs()` still lives in `src/itinerary/reorder.ts`; that one
is part of the pre-inversion leg editor described under Step 3a below, not the
model, and goes away with it. See "The one idea to understand first" and
"Derive, don't store" below for why it was worth inverting, and the HOP
IDENTITY banner in `src/model/trip.ts` for exactly how overrides survive the
rebuild.

`src/lib/hubs.ts` (71 curated intercontinental hub airports), `popularDestinations.ts`
(40 destinations for the "I don't know where yet" browse), and `homeLocation.ts`
(geolocation → a starting `Place`) landed alongside the model. They exist to
feed the route engine, the inspiration browse, and the origin-editing UI —
none of which this step builds; the data is ready before its consumers are.

Step 3a is genuinely mid-flight, not finished and mis-marked: the itinerary
editor still renders and edits legs today, but through a temporary
derived-legs cache in `TripState` (see the `TODO` at the top of
`tripReducer.ts`) that keeps the existing card-based editor working off
`deriveLegs()` while it's rebuilt around a destination list with an editable
hop chain underneath each pair. Edits currently land in that cache, not in
`trip.hopOverrides`, so nothing survives a fresh derivation yet — that's the
first thing the rebuild has to fix.

This step did **not** build: real flight/train/bus fare and schedule lookup
against a booking API (Step 5 — `RouteHop.cost`/`operator` are, at most, the
route engine's guesses, never a live price), the fully nested "super-detailed"
expansion of one leg into its own boarding/layover sub-legs, or activities
attached to a specific destination rather than a bare place. All three were
explicitly deferred by the owner, not overlooked.

Step 4 came forward out of order because the two-currency header it replaced was
actively misleading — see "Cost is one number" below.

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

---

## Proposed stack

Nothing is locked in past the model. The owner's existing comfort zone, which
these choices follow:

- **React + Vite + TypeScript + Tailwind** — frontend
- **MapLibre GL JS** — mapping. Chosen over Mapbox GL because it's fully open
  source with no access token and no usage ceiling. Tiles from a free provider
  (MapTiler free tier, Protomaps, or self-hosted).
- **Turf.js** — geospatial math, specifically `greatCircle()` for flight arcs
- **FastAPI (Python)** — backend, only once external APIs are involved. Steps 2–4
  need no server at all; do not add one before it earns its place.
- **Docker** — deployment
- **Vitest**, `jsdom` environment — unit tests, run with `npm test`. Configured
  by merging into `vite.config.ts` (see `vitest.config.ts`) rather than a
  standalone config, so the maplibre-gl worker workaround documented there
  can't silently get dropped. `jsdom` rather than `node` because tests are
  expected to cover React components as well as plain logic like `geo.ts` and
  `hubs.ts`'s coordinate table — paying the small startup cost everywhere
  beats splitting environments per file at this size.

State management: start with `useState`/`useReducer` on a single `Trip` object.
Do not reach for Redux/Zustand until there's a demonstrated need.

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

**Two key spaces share that one key function, and conflating them breaks the
"survives a reorder" guarantee above.** `RouteMap` — the route engine's
proposals — is keyed by the hop id of the *destination pair*, e.g.
`hopId(londonOntario, lisbon)`, and its value is the whole chain of hops the
engine thinks that takes. `Trip.hopOverrides` is keyed by the hop id of an
*individual hop inside that chain*, e.g. `hopId(torontoPearson,
lisbonAirport)`. Same `hopId()`, different level — which is what lets you
correct just the airport bus without disturbing the transatlantic flight
booked next to it.

The same physical hop can occur more than once in one trip — Lisbon → Porto on
the way north, then Lisbon → Porto again after a detour south. The override is
shared between both occurrences, correctly, since it's the same journey with
the same booking preferences either time. The two occurrences still need
distinct **leg** ids, though, or React keys and MapLibre feature ids collide
and the second occurrence silently stops rendering — so `deriveLegs()`
suffixes repeats (`lisbon->porto#2`). A leg id is therefore not always a
`HopId`; only a hop's first occurrence in the trip is.

Picking which airport a hop actually flies out of is a heuristic, not a
lookup, because no free API says which airports have scheduled flights
between two cities. `nearestAirports()` in `lib/placesApi.ts` can only rank by
runway size, a proxy that's occasionally absurd — the nearest large airport to
a city can be a cargo field nobody has ever connected to anywhere useful.
`lib/hubs.ts` hand-corrects the corridors that matter most with 71 curated
intercontinental hubs. That table is not a stopgap to delete once something
better ships; nothing free lists actual routes, so the curated list is the
permanent second opinion, and simplifying it away reintroduces the absurd
case.

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

## Map rendering notes (Step 2)

Different modes need genuinely different geometry — this is not just styling:

- **Flights** — do not route. Use `turf.greatCircle(from, to)` to draw the curved
  path. Watch for the antimeridian: Turf handles the split, but the resulting
  MultiLineString must be fed to MapLibre correctly or the line wraps across the
  whole map. Not an issue for this trip's routes, but don't hardcode the
  assumption.
- **Train / bus / car** — a real routed polyline is ideal. OSRM's public demo
  server is free for driving profiles but is rate-limited and explicitly not for
  production. There is no free rail-routing service; a styled straight line
  between stations is acceptable and reads fine at country zoom levels. Do not
  block Step 2 on solving rail routing.
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

## Itinerary editor notes (Step 3a)

### Reordering rewrites dates, visibly

> **Being replaced.** This describes the leg editor as it stands while the model
> inversion lands. Legs had no `order` field, so a drop had to be expressed as a
> change to `departure`. Destinations carry explicit order, so once the panel is
> rebuilt around them a drop is a splice and none of this is needed.

`src/itinerary/reorder.ts` works out the smallest edit that makes `orderedLegs()`
agree with where you dropped the card, under two rules:

- **Only the dragged leg is ever edited.** A drop never reaches sideways and
  shifts a leg you didn't touch. If a position can't be reached by editing the
  dragged leg alone, nothing changes at all.
- **Every rewrite is reported**, with a one-click undo. Silently altering a date
  someone typed is the failure mode this design is most exposed to; the banner is
  what keeps it from being silent.

While everything is undated — most of the time, early on — order is just array
order and dragging rewrites nothing.

Drag-and-drop is HTML5 DnD, which touch devices don't fire. `Alt`+`↑`/`↓` on a
focused card does the same thing through the same reducer action, which also
covers keyboard users.

### Undo is one slot, deliberately

Filled only by the two actions that can lose work you didn't explicitly type: a
drag that rewrote a date, and a delete. Ordinary field edits don't fill it — you
can see what you changed, and an undo prompt after every keystroke is noise. If
this ever needs to become a real history stack, `TripState.undo` is the seam.

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

### Dependencies added in this step

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
- **Attractions** — OpenTripMap (free, OSM-derived) or Google Places. Start with
  OpenTripMap; no billing account required.
- **Geocoding** — Nominatim is free with a strict usage policy (attribution, 1
  req/sec, real User-Agent). Photon is a friendlier alternative for autocomplete.
  The `PlacePicker` debounces 400ms to stay inside that budget.
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

## Suggested structure

Actual, as of Step 3a — `*` marks what's still only planned. The `itinerary/`
list below is the pre-inversion leg editor, still present and working through
the transitional shim described in Status; it's mid-rewrite around
destinations, not final.

```
src/
  App.tsx                # trip state (useReducer) + the list/map split
  model/
    trip.ts              # destinations are the spine; legs/gaps/totals are derived from them
  map/
    TripMap.tsx          # MapLibre container, selection sync
    geometry.ts          # leg -> GeoJSON, great-circle arcs
    style.ts             # mode/status -> paint expressions, layer ids
  itinerary/
    ItineraryPanel.tsx   # the list: ordering, drop targets, where the editor opens
    LegCard.tsx          # one leg, collapsed
    LegEditor.tsx        # the leg form
    LegConnector.tsx     # the strip between two legs; also surfaces gaps
    PlacePicker.tsx      # trip places + IATA + Nominatim search
    tripReducer.ts       # every trip edit, plus the undo slot
    reorder.ts           # drop position -> smallest departure edit
    plausibleModes.ts    # which modes a leg could actually use
    datetime.ts          # the wall-clock time format and its helpers
    duration.ts          # durations, nights, and when NOT to show one
    labels.ts            # mode colours/icons, status vocabulary, money formatting
  cost/
    CostSummary.tsx      # one home-currency total + the breakdown behind it
    useRates.ts          # FX rates as React state
  lib/
    geo.ts                  # distance + country -> continent
    currency.ts             # FX fetch + conversion, display-time only
    currencyApi.ts          # country -> currency (vendored table)
    placesApi.ts            # Nominatim search + OurAirports IATA/nearestAirports lookup
    hubs.ts                 # 71 curated intercontinental hub airports, for the route engine
    popularDestinations.ts  # 40-destination browse for "I don't know where yet"
    homeLocation.ts         # geolocation -> a starting Place for trip.origin
```

Unit tests sit beside the module they test (`geo.test.ts`, `hubs.test.ts`, …)
rather than in a separate directory, and aren't listed individually above for
brevity — see "Vitest" under Proposed stack.

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
