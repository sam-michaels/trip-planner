# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Independent travellers planning a multi-leg, multi-country trip themselves —
the kind of journey that crosses several transport modes, currencies and
operators, and that no single booking site can hold. They are in the
*planning* phase, not the booking phase: months out, most of the trip is still
a guess. Their working state today is a spreadsheet plus a dozen open tabs.

The build is aimed at other travellers, not only the owner. The owner's real
itinerary — London ON → Toronto → Lisbon → Porto → onward through Spain and
Morocco — is the test case the product is built against, not the customer.

## Product Purpose

Show a whole multi-leg trip at once: every leg drawn on a map in the style of
its transport mode, a running cost estimate in one currency, and the shape of
the time spent in each place.

The gap it fills: booking sites each own one slice of a trip (a flight, a
train, a hotel) and none of them show the whole thing. This is the missing
plan layer that sits above all of them.

Success has two halves, both required:

1. The owner plans and takes the real Lisbon → Porto → Spain → Morocco trip
   out of this tool rather than a spreadsheet.
2. It is deployed somewhere public, where someone other than the owner can
   plan their own trip in it.

## Positioning

A trip is an ordered list of **destinations** — cities you want to be in, for
some number of nights. Everything else is derived from that list: legs are
computed from consecutive pairs, cost is computed from the parts, the map is a
rendering of it. Nobody plans a trip by naming a bus; planning starts at
"Lisbon and Porto, maybe four nights each," and the transport, dates and
intermediate airports are consequences worked out later.

Two commitments follow, and a neighbouring product could not truthfully copy
either:

- **The vaguest version of a plan is fully representable.** Every date, time,
  operator and price is optional. "Porto, no idea when" is a first-class state,
  not an incomplete form.
- **Firmness is visible.** Every leg, stay and activity is `idea`, `planned` or
  `booked`, and the map and list both render that difference, so a glance
  answers "what is still open?" This is what makes it a planning tool rather
  than a receipt folder.

## Operating Context

- Planning happens over weeks or months, in many short sessions, revising
  constantly. Order changes; dates arrive late and get rewritten.
- The trip spans several currencies (CAD at home, EUR in Iberia, MAD in
  Morocco) and several operators with no common booking system.
- The user leaves for the actual booking sites — Trainline, Omio,
  Booking.com, the airline — and comes back with a fare to type in.
- European rail in particular has no unified API, so **manual fare entry is a
  normal, expected workflow**, not a fallback.
- The map and the itinerary list are used together, side by side; selection is
  shared between them.

## Capabilities and Constraints

Working today: the destination-first data model, the MapLibre renderer with
mode-aware leg geometry and status-aware styling, the leg editor with
reordering and undo, and a single-number cost rollup with per-currency
breakdown and entry-time conversion.

Not yet built: stays and activities in the editor, external data (flight
pricing, attractions), persistence, and deep links out to booking sites.

Confirmed constraints:

- **v1 does not book anything.** It plans, visualizes, estimates, and
  deep-links out. A booking flow means payment handling, PCI scope,
  cancellation and support obligations, which would swallow the project.
- **Persistence is local first.** Trips live in the user's own browser; no
  accounts and no server for v1. Sync and accounts are a later step that the
  model must not block. *Whether v1 ever gains sync is explicitly undecided.*
- **No backend until external APIs earn it.** The map, editor and cost rollup
  need no server.
- Derived values are never stored (no `totalCost`, no stored `legs`); the one
  deliberate exception is destination order, which is array position.
- Money is always `{ amount, currency }` in the currency actually paid, and is
  converted only at display time.
- Times are local wall-clock strings with no timezone offset, because that is
  what the ticket says and what the date input speaks. Cross-timezone
  durations are shown as "crosses time zones" rather than a wrong number.
- Coordinates are `[longitude, latitude]`, always built through `coords()`.

Terminology, used consistently in code and copy: **destination** (a city, for
some nights), **leg** (one continuous movement by one mode, derived), **hop
override** (what the user said about one specific leg, keyed by place pair),
**stay**, **activity**, **status**.

## Brand Commitments

The product has **no confirmed name**. `trip-planner` is the repository name
and a placeholder. Future work must not invent a name, wordmark or tagline, or
brand any surface around one.

## Evidence on Hand

- One real, specific itinerary to build and demo against: London ON → Toronto
  (bus/train) → Lisbon (flight) → Porto (train) → onward through Spain and
  Morocco. Encoded as `sampleTrip` in `src/model/trip.ts`.
- A substantial written rationale in `README.md`, including a current (August
  2026) survey of the travel API landscape — Amadeus Self-Service dead, Duffel
  as the flight option, no unified European rail API, OpenTripMap for
  attractions, `open.er-api.com` for FX rates.
- Live FX rates and a vendored country→currency table.

There are **no** users, no testimonials, no usage data, no pricing, no press,
no case studies, and no deployment. None of these may be fabricated or implied
on any surface.

## Product Principles

1. **Everything is a rendering of the destination list.** Before adding a
   feature, ask whether it can be expressed as a destination, a hop override,
   a stay, an activity, or a function derived from them. If it cannot, the
   model needs discussion, not a workaround.
2. **The plan is allowed to be unfinished.** Never require a field to make a
   component simpler. An idea with nothing but a city name must render well.
3. **Never silently change what the user typed.** A rewrite is reported and
   undoable. Silently altering a date someone entered is the failure mode this
   product is most exposed to.
4. **One channel per fact.** Mode, status and selection each get their own
   distinct signal and never borrow each other's. A reader must be able to
   sweep the list and count what is still unbooked.
5. **Estimate honestly, or not at all.** A number the product cannot stand
   behind — a cross-timezone duration, a total resting on a failed rate
   fetch — degrades to the honest smaller truth instead of guessing. The
   arithmetic behind any estimate stays reachable.

## Accessibility & Inclusion

**WCAG 2.2 AA is binding.** Contrast, visible focus, target size and keyboard
parity are audited against it, not judged by eye.

Two product-specific consequences:

- **Every map-driven action has a keyboard and list equivalent.** Reordering
  already works via `Alt`+`↑`/`↓` as well as drag; drag-and-drop alone is
  never the only path, since HTML5 DnD does not fire on touch either.
- **The itinerary list is the non-visual equivalent of the map.** A map cannot
  be read by a screen reader, so anything the map is the only place to learn
  is a defect in the list.
