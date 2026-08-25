// ============================================================
// STEP 1 — The data model
//
// One rule drives everything below: a trip is an ordered list
// of LEGS (movement) with STAYS and ACTIVITIES attached to the
// places in between. The map, the cost rollup, and the day-by-day
// view are all just different renderings of this one structure.
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

// ---------- The trip ----------

export interface Trip {
  id: string;
  title: string;
  travellers: number;
  /** What you want totals displayed in */
  homeCurrency: CurrencyCode;
  legs: Leg[];
  stays: Stay[];
  activities: Activity[];
}

/**
 * NOTE ON WHAT'S *NOT* HERE: there is no `totalCost` field, and no
 * `order` field on Leg.
 *
 * WHY: both are derivable. A stored total goes stale the moment you
 * edit a leg and forget to recompute it — that's a whole class of bug
 * you can simply refuse to have. Order comes from `departure` time,
 * so inserting a leg in the middle needs no reshuffling. Derive,
 * don't store. See the functions at the bottom.
 */

// ============================================================
// SAMPLE DATA — your actual trip, as far as it's decided
// Using real data from the start means the model gets tested
// against reality instead of against a convenient fiction.
// ============================================================

const LONDON_ON: Place = {
  id: "yxu-city",
  name: "London, Ontario",
  city: "London",
  country: "CA",
  coords: coords(-81.2497, 42.9849),
};

const TORONTO_YYZ: Place = {
  id: "yyz",
  name: "Toronto Pearson International",
  city: "Toronto",
  country: "CA",
  coords: coords(-79.6248, 43.6777),
  iata: "YYZ",
};

const LISBON_LIS: Place = {
  id: "lis",
  name: "Humberto Delgado Airport",
  city: "Lisbon",
  country: "PT",
  coords: coords(-9.1359, 38.7813),
  iata: "LIS",
};

const LISBON_ORIENTE: Place = {
  id: "lis-oriente",
  name: "Lisboa Oriente",
  city: "Lisbon",
  country: "PT",
  coords: coords(-9.0994, 38.7676),
};

const PORTO_CAMPANHA: Place = {
  id: "opo-campanha",
  name: "Porto Campanhã",
  city: "Porto",
  country: "PT",
  coords: coords(-8.5853, 41.1494),
};

export const sampleTrip: Trip = {
  id: "iberia-morocco-2026",
  title: "Portugal → Spain → Morocco",
  travellers: 2,
  homeCurrency: "CAD",
  legs: [
    {
      id: "leg-1",
      from: LONDON_ON,
      to: TORONTO_YYZ,
      mode: "bus",
      status: "idea",
      operator: "Robert Q Airbus",
      cost: { amount: 75, currency: "CAD" },
      notes:
        "Train (VIA) and driving+parking are the alternatives — compare before booking",
    },
    {
      id: "leg-2",
      from: TORONTO_YYZ,
      to: LISBON_LIS,
      mode: "flight",
      status: "idea",
      operator: "TAP Air Portugal",
      cost: { amount: 850, currency: "CAD" },
    },
    {
      id: "leg-3",
      from: LISBON_ORIENTE,
      to: PORTO_CAMPANHA,
      mode: "train",
      status: "idea",
      operator: "CP — Alfa Pendular",
      cost: { amount: 32, currency: "EUR" },
    },
  ],
  stays: [],
  activities: [],
};

// ============================================================
// DERIVED VALUES — computed, never stored
// ============================================================

/**
 * Legs in the order they actually happen.
 *
 * Undated legs sort to the end rather than throwing — while you're
 * still sketching, most legs have no date, and the app has to stay
 * usable in that half-finished state.
 */
export function orderedLegs(trip: Trip): Leg[] {
  return [...trip.legs].sort((a, b) => {
    if (!a.departure && !b.departure) return 0;
    if (!a.departure) return 1;
    if (!b.departure) return -1;
    return a.departure.localeCompare(b.departure);
  });
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
 */
export function totalByCurrency(
  trip: Trip,
): Partial<Record<CurrencyCode, number>> {
  const totals: Partial<Record<CurrencyCode, number>> = {};

  const add = (m?: Money, multiplier = 1) => {
    if (!m) return;
    totals[m.currency] = (totals[m.currency] ?? 0) + m.amount * multiplier;
  };

  for (const leg of trip.legs) add(leg.cost, trip.travellers);
  for (const stay of trip.stays) add(stay.costPerNight, nightsInStay(stay));
  for (const act of trip.activities) add(act.cost, trip.travellers);

  return totals;
}

/**
 * Find the holes in the itinerary.
 *
 * WHY THIS IS THE MOST VALUABLE FUNCTION HERE: this is the check no
 * booking site does for you. It catches the classic mistake of
 * booking a flight into Lisbon airport and a train out of Lisbon
 * Oriente without planning how you get between them — and the
 * more expensive version, where your train leaves from a city you
 * never arranged to reach.
 *
 * Endpoints are compared by city, not by place id, because arriving
 * at LIS and departing from Lisboa Oriente is a real but *minor*
 * gap (a metro ride), while Porto → Seville with nothing in between
 * is a trip-breaking one. Same-city gaps are flagged as "soft".
 */
export interface ItineraryGap {
  afterLegId: string;
  beforeLegId: string;
  from: Place;
  to: Place;
  severity: "soft" | "hard";
}

export function findGaps(trip: Trip): ItineraryGap[] {
  const legs = orderedLegs(trip);
  const gaps: ItineraryGap[] = [];

  for (let i = 0; i < legs.length - 1; i++) {
    const current = legs[i];
    const next = legs[i + 1];
    if (current.to.id === next.from.id) continue;

    gaps.push({
      afterLegId: current.id,
      beforeLegId: next.id,
      from: current.to,
      to: next.from,
      severity:
        current.to.city === next.from.city &&
        current.to.country === next.from.country
          ? "soft"
          : "hard",
    });
  }

  return gaps;
}
