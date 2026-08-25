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
| ---- | -------------------------------------------------------------- | ----------- |
| 1    | Core data model (`trip-model.ts`)                              | **Done**    |
| 2    | MapLibre renderer — mode-aware leg rendering                   | **Done**    |
| 3    | Itinerary editor UI (add/edit/reorder legs, stays, activities) | Not started |
| 4    | Cost rollup + multi-currency display                           | Not started |
| 5    | External data: flight pricing, attractions                     | Not started |
| 6    | Persistence + deep links out to booking sites                  | Not started |

The project is now scaffolded with Vite + React + TS + Tailwind; `trip-model.ts`
lives at `src/model/trip.ts` per the structure below, and the map renderer lives
under `src/map/`.

---

## The one idea to understand first

**A trip is an ordered list of legs.** A leg is one continuous movement from A to
B by one mode. Stays and activities attach to the places between legs.

The map, the cost rollup, and the day-by-day view are not three features — they
are three renderings of that single array. Before adding anything, ask whether it
can be expressed as a leg, a stay, an activity, or a function derived from them.
If it can't, that's a signal the model needs discussion, not a workaround.

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
converted figure, so totals never require a network call to be correct.

### 3. Derive, don't store

There is no `totalCost` field and no `order` field, by design. Both are computed
(`totalByCurrency()`, `orderedLegs()`). A stored derived value goes stale the
moment something upstream is edited. Do not add cached totals or explicit
ordering indices without a measured performance reason.

Leg order comes from `departure` time, so inserting a leg mid-trip requires no
reshuffling. Undated legs sort to the end rather than throwing — the app must stay
usable while an itinerary is still half-sketched.

### 4. `status` drives the visual language

Every leg, stay, and activity carries `'idea' | 'planned' | 'booked'`. This is
what makes it a planning tool rather than a receipt folder — you sketch "train to
Seville, roughly €40, around the 12th" months before buying anything.

The map must reflect this: tentative items rendered dashed/faded, booked items
solid. A user should be able to glance at the map and see what's still open.

### 5. Every field that could be unknown is optional

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

### Scope guardrail

**v1 does not book anything.** It plans, visualizes, estimates, and then deep-links
out to Trainline / Omio / Booking.com / the airline. Building a booking flow means
payment handling, PCI scope, cancellation logic, and support obligations — all of
which would swallow the project before the useful part exists.

If a request seems to imply in-app booking, confirm intent with the owner before
building it.

---

## Suggested structure

```
src/
  model/
    trip.ts              # the types + derived functions (currently trip-model.ts)
    fixtures.ts          # sample trips for development
  map/
    TripMap.tsx          # MapLibre container
    geometry.ts          # leg -> GeoJSON, great-circle arcs, routing calls
    style.ts             # mode/status -> paint expressions
  itinerary/
    LegList.tsx
    LegEditor.tsx
    GapWarnings.tsx      # surfaces findGaps() output
  cost/
    CostSummary.tsx
  lib/
    currency.ts          # FX conversion, display-time only
```

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
5. Mobile use while travelling, or desktop planning only? Changes layout priority
   and whether offline support matters.
