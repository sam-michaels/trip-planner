// ============================================================
// STEP 1 — The data model
//
// One rule drives everything below: a trip is an ordered list of
// DESTINATIONS (places you want to be, for some number of nights),
// and everything else hangs off that. LEGS — the movement between
// them — are DERIVED, never stored. STAYS and ACTIVITIES attach to
// the places you stop at. The map, the cost rollup, and the
// day-by-day view are all just different renderings of this.
//
// WHY DESTINATIONS AND NOT LEGS (this inverts the original design):
// nobody plans a trip by naming a bus. Planning starts at "Lisbon and
// Porto, maybe four nights each" — the transport, the dates, and the
// intermediate airports are consequences of that choice, worked out
// later and often revised. A model whose spine is legs forces you to
// invent a departure time before you can say where you want to go,
// which is backwards. Destinations first means the earliest, vaguest
// version of a plan is representable exactly as stated: an ordered
// list of cities, some of them with a night count.
// ============================================================

// ---------- Primitives ----------

/**
 * [longitude, latitude] — GeoJSON order.
 *
 * WHY THIS ORDER: MapLibre, Mapbox, Turf, and GeoJSON all use
 * [lng, lat]. Google Maps and most humans say "lat, lng".
 * Flipping these is the single most common map bug, and it fails
 * silently — your marker just ends up in the ocean off West Africa
 * (0,0 is nicknamed "Null Island" for exactly this reason).
 * Declaring the tuple type here means TypeScript can't catch a flip
 * (both are numbers), so the convention has to be enforced by
 * discipline: ALWAYS build coordinates through `coords()` below.
 */
export type Coordinates = [number, number];

/** Helper so you never hand-write a raw tuple and get the order wrong. */
export function coords(lng: number, lat: number): Coordinates {
  return [lng, lat];
}

/**
 * ISO 4217 code, e.g. "CAD", "EUR", "MAD".
 *
 * WHY NOT A UNION OF LITERALS: a fixed union only covers the
 * currencies you thought to list, and silently breaks the moment a
 * destination uses anything else. Currency codes are looked up at
 * the boundary instead — see `fetchCurrencyForCountry` in
 * currencyApi.ts — and validated there against
 * `Intl.supportedValuesOf("currency")`, which is every real ISO 4217
 * code the runtime knows about. The type stays a plain `string`
 * because TypeScript can't express "one of ~180 runtime-known values."
 */
export type CurrencyCode = string;

/**
 * Money is never a bare number.
 *
 * WHY: your trip spans three currencies (CAD at home, EUR in
 * Portugal/Spain, MAD in Morocco). If you store `cost: 45` you have
 * permanently lost what 45 means. Store the amount in the currency
 * you actually paid, and convert only at display time. Conversion is
 * a view concern, not a storage concern — exchange rates change, and
 * you want your records to stay true.
 */
export interface Money {
  amount: number;
  currency: CurrencyCode;
}

/**
 * How firm is this plan?
 *
 * WHY THIS EXISTS: this is what makes the app a *planning* tool
 * rather than a receipt folder. You need to sketch "train to Seville,
 * roughly €40, sometime around the 12th" long before you book it.
 * The map can then style tentative legs differently (dashed, faded)
 * from confirmed ones, so a glance tells you what's still open.
 */
export type PlanStatus = "idea" | "planned" | "booked";

// ---------- Places ----------

export interface Place {
  id: string;
  /** What you'd call it out loud: "Lisbon Airport", "Porto Campanhã" */
  name: string;
  city: string;
  /** ISO 3166-1 alpha-2 — "PT", "ES", "MA", "CA" */
  country: string;
  coords: Coordinates;
  /** Airports only. Handy for flight API lookups. */
  iata?: string;
}

// ---------- Legs (movement) ----------

export type TransportMode =
  | "flight"
  | "train"
  | "bus"
  | "car"
  | "ferry"
  | "walk";

/**
 * A leg is one continuous movement from A to B by one mode.
 *
 * WHY LEGS AND NOT "EVENTS": every leg has the same essential shape
 * (two endpoints + a mode), which is exactly what a map needs to draw
 * a line. A single unified type means the renderer is one function
 * with a switch on `mode`, not six separate code paths.
 *
 * NOTHING CONSTRUCTS THESE BY HAND ANY MORE. Legs come out of
 * `deriveLegs()` — routes proposed by the engine, with the user's
 * `hopOverrides` applied on top. The shape is unchanged from when
 * legs were stored, deliberately: the map, the cost rollup and the
 * leg cards keep consuming exactly what they consumed before, and
 * only where a leg *comes from* has changed.
 */
export interface Leg {
  id: string;
  from: Place;
  to: Place;
  mode: TransportMode;

  /** ISO 8601 strings. Optional because an "idea" leg has no times yet. */
  departure?: string;
  arrival?: string;

  cost?: Money;
  status: PlanStatus;

  /** "TAP Air Portugal", "CP", "ALSA", "Flixbus" */
  operator?: string;
  /** Confirmation code once booked */
  bookingRef?: string;
  /** Deep link out to wherever you'd buy this */
  bookingUrl?: string;
  notes?: string;
}

// ---------- Stays ----------

export type StayType =
  | "hotel"
  | "hostel"
  | "airbnb"
  | "friend"
  | "overnight-transit";

export interface Stay {
  id: string;
  place: Place;
  /** ISO dates, YYYY-MM-DD */
  checkIn: string;
  checkOut: string;
  type: StayType;
  /** Per night, so the total recomputes if you shift dates */
  costPerNight?: Money;
  status: PlanStatus;
  bookingUrl?: string;
  notes?: string;
}

// ---------- Activities ----------

export type ActivityCategory =
  | "sight"
  | "museum"
  | "food"
  | "outdoor"
  | "nightlife"
  | "shopping"
  | "other";

export interface Activity {
  id: string;
  place: Place;
  name: string;
  category: ActivityCategory;
  /** Optional — an unscheduled activity is a "maybe", which is useful */
  date?: string;
  durationMinutes?: number;
  cost?: Money;
  /** Where the suggestion came from, so you can trust it appropriately */
  source?: "manual" | "opentripmap" | "google-places" | "ai-suggestion";
  notes?: string;
}

// ---------- Destinations (the spine) ----------

/**
 * Somewhere you want to *be*, as opposed to somewhere you pass through.
 *
 * `place` is the CITY, never a station or an airport. That distinction
 * is the whole point of the inversion: "Lisbon" is a decision you make,
 * "Humberto Delgado Airport" is a consequence the route engine works
 * out. Airports and stations still appear all over the app — but as
 * endpoints of derived hops, never as items in this list.
 *
 * Almost everything here is optional because the honest early state of
 * a trip is "Porto, no idea how long, no idea when". A model that
 * demands a date before it will record an intention is a model you end
 * up filling with lies.
 */
export interface Destination {
  id: string;
  place: Place;
  /** Optional — "I don't know yet" is a valid, common, first-class state. */
  nights?: number;
  /**
   * Local wall-clock ISO, "2026-09-12T14:00" (see itinerary/datetime.ts).
   *
   * DECORATION, NEVER THE ORDERING KEY. Order is array position and
   * only array position — see the banner on `Trip.destinations`. This
   * field exists so a known date can be shown; sorting by it would
   * reintroduce exactly the bug the inversion removed.
   */
  arrival?: string;
  status: PlanStatus;
  notes?: string;
}

// ============================================================
// HOP IDENTITY — the crux of "legs are fully derived"
//
// A hop is one derived movement between two places. Legs are thrown
// away and recomputed on every render, so anything the user says
// about a hop ("actually we're taking the train, and it was €32")
// has to be stored somewhere that survives that recomputation — and,
// more importantly, that survives REORDERING the destinations.
//
// WHY NOT AN INDEX: `hopOverrides[2]` is a statement about a position
// in a list, not about a journey. Drag Porto above Lisbon and index 2
// is now a completely different physical movement, so your train
// booking silently reattaches itself to a flight. Index keys make
// reordering — the single most common edit in a destination-first
// planner — quietly destructive.
//
// WHY THE PLACE PAIR: `"lis-oriente->opo-campanha"` names the journey
// itself. Reorder all you like: while that hop still exists anywhere
// in the trip, the override rides along with it. And the converse is
// the feature, not a gap — a hop whose endpoints change is a
// DIFFERENT journey, so it correctly starts fresh rather than
// inheriting a booking reference for a train you're no longer taking.
//
// The pair is directional on purpose. Porto→Lisbon is not the same
// booking as Lisbon→Porto; it has its own time, price and reference.
// ============================================================

/** `${fromPlaceId}->${toPlaceId}`. Build it with `hopId()`, never by hand. */
export type HopId = string;

export function hopId(from: Place, to: Place): HopId {
  return `${from.id}->${to.id}`;
}

/**
 * What the user said that the route engine didn't (or got wrong).
 *
 * Every field is optional and every field means "override the derived
 * value for this one hop". An absent field is not "empty" — it means
 * "I have no opinion, keep whatever the engine proposed", which is why
 * none of these can be `null`.
 */
export interface HopOverride {
  /** Set when the user disagreed with the engine's guess. */
  mode?: TransportMode;
  cost?: Money;
  operator?: string;
  bookingRef?: string;
  bookingUrl?: string;
  notes?: string;
  status?: PlanStatus;
  /** Local wall-clock ISO — the engine never invents times, only people do. */
  departure?: string;
  arrival?: string;
}

/**
 * One movement the route engine proposes, before the user touches it.
 *
 * SUPPLIED BY THE CALLER, NOT BUILT HERE. Unit 6 owns the engine that
 * turns "London, Ontario → Lisbon" into [London ON → Toronto Pearson,
 * Toronto Pearson → Lisbon Airport, Lisbon Airport → Lisbon]. This
 * module only needs to know the shape well enough to fold overrides
 * onto it, so the type is deliberately the minimum that supports that:
 * no times (only people know dates), no booking fields (nothing is
 * booked until a person books it).
 */
export interface RouteHop {
  from: Place;
  to: Place;
  mode: TransportMode;
  /** A likely carrier, if the engine knows one. Overridable. */
  operator?: string;
  /** A fare estimate, if the engine has one. Overridable. */
  cost?: Money;
}

/**
 * Routes for every consecutive destination pair, keyed by the pair.
 *
 * TWO KEY SPACES, ONE KEY FUNCTION — worth reading twice:
 *
 *   * This map is keyed by the hop id of the DESTINATION PAIR, e.g.
 *     `hopId(londonOntario, lisbonCity)`, and the value is the whole
 *     chain of hops that gets you between them.
 *   * `Trip.hopOverrides` is keyed by the hop id of an INDIVIDUAL HOP
 *     in that chain, e.g. `hopId(torontoPearson, lisbonAirport)`.
 *
 * They share `hopId()` because they mean the same thing by it — "the
 * journey from this place to that place" — but they are looked up at
 * different levels, which is what lets you override just the airport
 * bus without disturbing the transatlantic flight.
 *
 * A pair with no entry is not an error: see `deriveLegs`.
 */
export type RouteMap = Map<HopId, RouteHop[]>;

// ---------- The trip ----------

export interface Trip {
  id: string;
  title: string;
  travellers: number;
  /** What you want totals displayed in */
  homeCurrency: CurrencyCode;
  /**
   * Where the trip starts and (for now) ends — home.
   *
   * Absent until the traveller says where they are: a trip can exist
   * before that's known (see the onboarding "where are you?" prompt),
   * and forcing a placeholder `Place` into this field would just be a
   * lie stored as data. Read the trip as an ordered walk through
   * `tripPlaces()`, not by reaching for `origin` directly.
   */
  origin?: Place;
  /**
   * ORDER IS ARRAY POSITION. Nothing else. Not dates, not ids.
   *
   * WHY EXPLICIT ORDER, when this file used to argue the opposite:
   * the old model derived leg order from `departure`, on the grounds
   * that a stored order is a derived value waiting to go stale. That
   * reasoning assumed there was always something to sort by. In a
   * destination-first planner there usually isn't — the whole point is
   * that you can say "Lisbon, then Porto" before either has a date, a
   * night count, or a way of getting there. With every date optional,
   * a derived order has nothing to derive from and collapses to
   * "whatever order they happen to be in", i.e. array position, but
   * arrived at by accident and impossible to edit deliberately.
   *
   * So sequence is now first-class data, because sequence is the first
   * real decision a traveller makes. Reordering is a splice, dates
   * stay optional, and dragging a card no longer has to rewrite a
   * departure time you typed by hand just to hold its position.
   */
  destinations: Destination[];
  /**
   * User corrections to derived hops, keyed by hop id so they survive
   * reordering. See the HOP IDENTITY banner above.
   */
  hopOverrides: Record<HopId, HopOverride>;
  stays: Stay[];
  activities: Activity[];
}

/**
 * NOTE ON WHAT'S *NOT* HERE: there is no `totalCost` field, and no
 * `legs` array.
 *
 * WHY: both are derivable, and a stored derived value goes stale the
 * moment you edit its inputs and forget to recompute — a whole class
 * of bug you can simply refuse to have. Totals come from
 * `totalByCurrency()`; legs come from `deriveLegs()`. Derive, don't
 * store. Explicit `destinations` order is the one deliberate
 * exception, and the comment above says why.
 */

// ============================================================
// SAMPLE DATA — your actual trip, as far as it's decided
// Using real data from the start means the model gets tested
// against reality instead of against a convenient fiction.
//
// Note how much SHORTER this is than the leg-based version it
// replaces: three hand-written legs (with hand-chosen airports and a
// hand-chosen station) collapse to two destinations, because the
// airports and the station were always consequences rather than
// decisions. That shrinkage is the argument for the inversion, in
// miniature.
// ============================================================

const LONDON_ON: Place = {
  id: "yxu-city",
  name: "London, Ontario",
  city: "London",
  country: "CA",
  coords: coords(-81.2497, 42.9849),
};

const LISBON: Place = {
  id: "lisbon",
  name: "Lisbon",
  city: "Lisbon",
  country: "PT",
  coords: coords(-9.1393, 38.7223),
};

const PORTO: Place = {
  id: "porto",
  name: "Porto",
  city: "Porto",
  country: "PT",
  coords: coords(-8.6291, 41.1579),
};

export const sampleTrip: Trip = {
  id: "iberia-morocco-2026",
  title: "Portugal → Spain → Morocco",
  travellers: 2,
  homeCurrency: "CAD",
  origin: LONDON_ON,
  destinations: [
    {
      id: "dest-lisbon",
      place: LISBON,
      nights: 4,
      status: "idea",
    },
    {
      id: "dest-porto",
      place: PORTO,
      nights: 4,
      status: "idea",
      notes: "Day trip to the Douro valley if there's time",
    },
  ],
  hopOverrides: {},
  stays: [],
  activities: [],
};

// ============================================================
// DERIVED VALUES — computed, never stored
// ============================================================

/**
 * How a hop gets a mode when the engine had nothing to say about it.
 *
 * There is no "unknown" member of `TransportMode`, and adding one
 * would force every consumer to handle a case that isn't a way of
 * travelling. So an unrouted pair still draws as a line, and
 * `findGaps()` is what tells the UI the pair is unresolved — detect
 * placeholders through `findGaps()`, never by inspecting the mode.
 *
 * WHY THIS IS A CALLBACK AND NOT A CONSTANT: a fixed default is wrong
 * for most of a trip that spans a transatlantic flight and a walk
 * between two stations — and wrong loudly, because the map
 * great-circles flights and draws every other mode as a straight
 * Mercator line, so a bad guess puts a car across the Atlantic. The
 * good guess is a geographic one (`defaultMode` in
 * itinerary/plausibleModes.ts), and this module deliberately does not
 * import it: the model stays free of heuristics, and the caller that
 * already owns them passes one in.
 */
export type ModeGuess = (from: Place, to: Place) => TransportMode;

/** Least committal fallback, for a caller with no opinion at all. */
const guessNothing: ModeGuess = () => "car";

/**
 * `[origin, ...destinations]` — the trip as a walk, skipping an origin
 * nobody has set yet.
 *
 * WHY THIS EXISTS: five call sites across the app used to write this
 * concatenation by hand, which was fine while `origin` was required.
 * Now that it's optional, each of those five would also need its own
 * null check — this is the one place that check lives, so an absent
 * origin is just a shorter walk rather than a `!` or a scattered `if`.
 */
export function tripPlaces(trip: Trip): Place[] {
  const rest = trip.destinations.map((d) => d.place);
  return trip.origin ? [trip.origin, ...rest] : rest;
}

/**
 * Every leg of the trip, in order, built fresh from destinations.
 *
 * The walk is over `[origin, ...destinations]` pairwise, so a trip
 * with two destinations produces two journeys (home → Lisbon,
 * Lisbon → Porto), each of which may expand into several hops. For
 * each hop the engine's proposal is the base and the user's override
 * — looked up by that hop's own id — is laid on top of it.
 *
 * `routes` comes from the caller (Unit 6's engine). Pass an empty map
 * and you get one straight placeholder hop per destination pair, moded
 * by `guessMode` — a perfectly reasonable thing to render while the
 * engine is thinking, offline, or not yet built.
 */
export function deriveLegs(
  trip: Trip,
  routes: RouteMap,
  guessMode: ModeGuess = guessNothing,
): Leg[] {
  const legs: Leg[] = [];
  const places = tripPlaces(trip);

  // The same physical hop can occur twice in one trip (Lisbon → Porto
  // on the way up, and again after a detour). The override is shared —
  // it is the same journey, so the same booking preferences apply —
  // but the *leg* ids must stay unique or React keys and MapLibre
  // feature ids collide and the second occurrence stops rendering.
  const seen = new Map<HopId, number>();

  for (let i = 0; i < places.length - 1; i++) {
    const from = places[i];
    const to = places[i + 1];

    // A place repeated back-to-back ("Lisbon, then Lisbon") is not a
    // journey. Skip rather than emit a zero-length leg the map would
    // draw as a dot.
    if (from.id === to.id) continue;

    const hops = routes.get(hopId(from, to)) ?? [];
    const chain: RouteHop[] =
      hops.length > 0 ? hops : [{ from, to, mode: guessMode(from, to) }];

    for (const hop of chain) {
      const id = hopId(hop.from, hop.to);
      const occurrence = (seen.get(id) ?? 0) + 1;
      seen.set(id, occurrence);

      const override = trip.hopOverrides[id];

      legs.push({
        id: occurrence === 1 ? id : `${id}#${occurrence}`,
        from: hop.from,
        to: hop.to,
        mode: override?.mode ?? hop.mode,
        departure: override?.departure,
        arrival: override?.arrival,
        cost: override?.cost ?? hop.cost,
        // A derived leg is an idea until a person says otherwise —
        // the engine has no way to know you've booked anything.
        status: override?.status ?? "idea",
        operator: override?.operator ?? hop.operator,
        bookingRef: override?.bookingRef,
        bookingUrl: override?.bookingUrl,
        notes: override?.notes,
      });
    }
  }

  return legs;
}

export function nightsInStay(stay: Stay): number {
  const ms =
    new Date(stay.checkOut).getTime() - new Date(stay.checkIn).getTime();
  return Math.max(0, Math.round(ms / 86_400_000));
}

/**
 * Total cost, grouped by currency.
 *
 * WHY NOT ONE NUMBER: converting requires a live FX rate, which is a
 * network call and a moving target. Returning `{ CAD: 925, EUR: 32 }`
 * is always correct and needs no network. The UI layer can convert
 * for display and show the raw breakdown on hover — which is more
 * honest anyway, since you'll be paying in those currencies.
 *
 * WHY LEGS ARE AN ARGUMENT: they are no longer on the trip, and
 * deriving them here would mean this function needed a `RouteMap` too
 * — quietly recomputing the whole route on every render just to add up
 * some numbers. The caller already has the legs it is rendering; the
 * total should be of *those* legs, not of a second derivation that
 * might disagree with what's on screen.
 */
export function totalByCurrency(
  trip: Trip,
  legs: Leg[],
): Partial<Record<CurrencyCode, number>> {
  const totals: Partial<Record<CurrencyCode, number>> = {};

  const add = (m?: Money, multiplier = 1) => {
    if (!m) return;
    totals[m.currency] = (totals[m.currency] ?? 0) + m.amount * multiplier;
  };

  for (const leg of legs) add(leg.cost, trip.travellers);
  for (const stay of trip.stays) add(stay.costPerNight, nightsInStay(stay));
  for (const act of trip.activities) add(act.cost, trip.travellers);

  return totals;
}

/**
 * Consecutive destinations the route engine could not connect at all.
 *
 * WHAT THIS USED TO MEAN, AND WHY IT CHANGED: under stored legs, a gap
 * was a mistake you'd made — flying into Lisbon airport and out of
 * Lisboa Oriente with nothing arranged in between. That mistake is now
 * impossible to make: the chain of hops between two destinations comes
 * out of the engine already joined end to end, and the transfer across
 * town is one of the hops it proposes. Nobody hand-assembles a
 * sequence of legs any more, so nobody can leave a hole in one.
 *
 * What remains genuinely worth flagging is the engine coming up empty:
 * you have said you want to go from here to there and the app has no
 * idea how. That's not a mistake, it's an open question — and it is
 * still the one thing no booking site will tell you.
 *
 * Severity survives with a narrower meaning. Same city means the
 * unrouted move is a local one (a metro ride, a taxi) that you can
 * clearly solve yourself, so it's "soft"; anything else is a real hole
 * in the plan and is "hard".
 */
export interface ItineraryGap {
  /**
   * The unroutable pair: the key a `HopOverride` for it lives under,
   * and the key `routes` would need an entry at.
   *
   * NOT a leg id. `deriveLegs` suffixes repeat occurrences (`…#2`) to
   * keep its ids unique and this doesn't, so key gaps by
   * `toDestinationId`, which is unique by construction.
   */
  hop: HopId;
  /** Index into `trip.destinations` of the destination this pair leads to. */
  toIndex: number;
  /** Absent when the pair starts at `trip.origin` rather than a destination. */
  fromDestinationId?: string;
  toDestinationId: string;
  from: Place;
  to: Place;
  severity: "soft" | "hard";
}

export function findGaps(trip: Trip, routes: RouteMap): ItineraryGap[] {
  const gaps: ItineraryGap[] = [];

  for (let i = 0; i < trip.destinations.length; i++) {
    const previous = trip.destinations[i - 1];
    const from = previous ? previous.place : trip.origin;
    // No previous destination and no origin set: there's no pair here
    // to judge connectivity on. "You haven't said where you are" is a
    // different claim from "these two places don't connect", and
    // reporting the former as the latter is the false-alarm problem
    // the connector work just fixed — so skip, don't invent a gap.
    if (!from) continue;
    const to = trip.destinations[i].place;

    if (from.id === to.id) continue;

    const id = hopId(from, to);
    if ((routes.get(id) ?? []).length > 0) continue;

    gaps.push({
      hop: id,
      toIndex: i,
      fromDestinationId: previous?.id,
      toDestinationId: trip.destinations[i].id,
      from,
      to,
      severity:
        from.city === to.city && from.country === to.country ? "soft" : "hard",
    });
  }

  return gaps;
}
