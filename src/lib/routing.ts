// ============================================================
// The route engine — the thing that turns "Lisbon, then Porto"
// into an itinerary.
//
// WHY THIS FILE HAS TO EXIST: the model inverted to destinations
// first, which moved a decision the traveller used to make by hand
// (which airport, which station, which bus to it) into the app. A
// destination list is a statement of intent — "London, Ontario, then
// Lisbon" — and somebody has to answer the obvious follow-up
// question. That answer is a *chain* of hops, not a single line:
// London ON → Toronto Pearson → Lisbon Airport → Lisbon. Only the
// middle one is the flight; the two either side are the parts of a
// trip everybody forgets to plan and then spends an hour on at 5am.
//
// WHAT IT WILL AND WON'T CLAIM TO KNOW. No free service will tell
// you whether flights exist between two cities, what they cost, or
// who flies them. So this engine deliberately proposes *shape*, not
// fact: which airports, in what order, by roughly what mode. Cost
// and operator are left undefined rather than invented — an honest
// blank is worth more than a plausible-looking lie, and both are
// fields the user can fill in from the booking site they end up on.
//
// EVERYTHING HERE IS A PROPOSAL. `proposeRoutes` returns several
// options, best first, and nothing is committed until the user picks
// one — and even then, `Trip.hopOverrides` lets them contradict any
// individual hop of it. The engine narrows the choice; it never makes
// it. Same rule `plausibleModes.ts` follows, one level up.
// ============================================================

import type {
  Coordinates,
  HopId,
  Place,
  RouteHop,
  RouteMap,
  TransportMode,
  Trip,
} from "../model/trip";
import { hopId } from "../model/trip";
import { defaultMode, plausibleModes } from "../itinerary/plausibleModes";
import { distanceKm, isLandConnected } from "./geo";
import { hubByIata, isHub, nearestHubs } from "./hubs";
import {
  airportsFlyingTo,
  flightExists,
  isKnownAirport,
} from "./flightRoutes";
import { nearestAirports } from "./placesApi";

// ---------- What the engine hands back ----------

/**
 * One complete way of getting between two destinations.
 *
 * `hops` is joined end to end: the first hop leaves `from`, the last
 * arrives at `to`, and each one starts where the previous finished.
 * That invariant is what lets `deriveLegs()` splice a whole chain in
 * where one destination pair used to be, and what makes a hole in a
 * route impossible to represent (see the `findGaps` banner in the
 * model — gaps are now only ever "we don't know", never "you forgot").
 */
export interface RouteOption {
  /** Unique within one option list; stable across calls for the same pair. */
  id: string;
  /** Human phrasing for a picker: "Train to Porto", "Fly Toronto (YYZ) → Lisbon (LIS)". */
  label: string;
  hops: RouteHop[];
  /**
   * "You have to fly, and we couldn't work out from where."
   *
   * Set only when the engine knows a ground route is implausible but
   * could not resolve airports at either end — the airport dataset was
   * unreachable and no curated hub was near enough to stand in. The
   * hops are then a single city-to-city placeholder, which is exactly
   * what `deriveLegs()` produces on its own for an unrouted pair. So
   * `pickRoutes()` deliberately does NOT store these: leaving the pair
   * out of the `RouteMap` costs nothing and lets `findGaps()` raise it
   * as the open question it is.
   */
  provisional?: boolean;
}

/** Every option the engine found, keyed by DESTINATION PAIR hop id. */
export type RouteOptionMap = Map<HopId, RouteOption[]>;

/**
 * Seam for the one part of this engine that touches the network.
 *
 * WHY IT'S INJECTABLE: `nearestAirports` downloads and parses the
 * whole OurAirports CSV. A route engine is otherwise pure arithmetic
 * over two tables, and a test suite that has to reach the internet to
 * check that Lisbon → Porto is a train is a test suite nobody runs.
 * Callers in the app pass nothing and get the live lookup.
 */
export interface RouteEngineDeps {
  findAirports?: (near: Coordinates) => Promise<Place[]>;
}

// ---------- Thresholds ----------
//
// These are the engine's own judgement calls, and they are only about
// route *shape* — whether a pair is worth restructuring into a
// three-hop flight chain, and how far someone would travel to an
// airport. The choice of MODE is never made here: `plausibleModes.ts`
// already owns that reasoning and is called for every ground hop, so
// there is exactly one place in the codebase that decides train
// versus bus versus ferry.

/**
 * Below this, an air chain is never proposed FOR A PAIR THAT ISN'T
 * ALREADY A FLIGHT — see `flightLeads` in `proposeRoutes`, which is
 * how a sea crossing sidesteps this rule.
 *
 * Not because short flights don't exist — Lisbon to Porto has several
 * a day — but because the chain around them doesn't pay: two airport
 * transfers, two hours of check-in and security, for a train ride you
 * could have spent asleep. Nothing is blocked by this: the pair still
 * gets a direct hop, and a `HopOverride` can set its mode to "flight"
 * if the traveller disagrees.
 */
const AIR_CHAIN_MIN_KM = 700;

/**
 * The floor for a pair that IS a flight — a sea crossing, which
 * sidesteps the rule above because no train substitutes for it.
 *
 * It still needs a floor of its own. Algeciras to Tangier is 55km of
 * water, and with no floor the engine proposed flying it out of
 * Gibraltar: a forty-kilometre flight reached by an international
 * border crossing, against a ferry that has run for a century. 250km
 * is `plausibleModes`' own MIN_FLIGHT_KM and its reasoning applies
 * unchanged — below it the flight is slower than the taxi to the
 * airport.
 */
const SEA_CROSSING_MIN_FLIGHT_KM = 250;

/**
 * Above this, flying leads the list even where the ground route is
 * perfectly real and `plausibleModes` ranked it first. Roughly the
 * point where a European train stops being a day and starts being a
 * day and a night.
 */
const AIR_CHAIN_PREFERRED_KM = 1_000;

/**
 * Ground transfer to an airport: never shorter than this — every city
 * gets at least a local radius, however short the flight.
 */
const MIN_TRANSFER_KM = 60;
/**
 * ...and never longer than this, whatever the flight at the other end
 * of it. Four hundred kilometres is already most of a day's driving
 * before you have checked in.
 *
 * WHY A HARD CEILING AND NOT "WHATEVER IT TAKES": a generous radius
 * looks like generosity and isn't. Run against the live airport
 * dataset with a 1,200km budget, this engine cheerfully proposed
 * getting from Iqaluit to Nuuk — across the Davis Strait — and, since
 * the continent table has both on the same landmass, proposed doing it
 * BY TRAIN. When the nearest usable airport is further away than
 * anyone would travel to it, the true answer is that the engine does
 * not know how you get there, and saying so (see `provisional`) is
 * worth more than a confident absurdity.
 */
const MAX_TRANSFER_KM = 400;
/**
 * ...and never more than this share of the flight it exists to catch.
 *
 * A third sounds generous and is roughly what people really do: Seville
 * is a third of the way to Marrakesh and is exactly how you fly there.
 * An earlier, meaner figure made the budget for a 700km hop 88km, which
 * excluded every airport that could serve it and left the engine
 * proposing a ferry between two inland cities.
 */
const TRANSFER_SHARE = 0.3;

/**
 * Past this, a transfer has to stay inside one country.
 *
 * WHY: `isLandConnected` works on continents, so it cannot see the
 * Florida Straits — Cuba and the United States are both
 * "north-america" — and a 365km transfer from Havana to Miami came out
 * of this engine as a TRAIN. Short cross-border transfers are real and
 * common (Klagenfurt serves Slovenia, Basel serves three countries), so
 * they stay; a long one is rare enough, and unverifiable enough, that
 * proposing it unprompted is not worth the times it is nonsense. It
 * also stops the engine from casually routing a Canadian traveller
 * through a US border crossing they never asked for.
 */
const MAX_CROSS_BORDER_TRANSFER_KM = 150;

/**
 * `loadAirports` issues a bare `fetch` with no signal, so a stalled
 * connection never resolves and never rejects. Bounded here rather
 * than there because `placesApi.ts` is shared — same reasoning as
 * `detectHomeLocation` bounding the reverse geocode it calls.
 */
const AIRPORT_LOOKUP_TIMEOUT_MS = 8_000;

/**
 * A curated hub this close IS the city's airport, so nothing the live
 * dataset could return would be meaningfully nearer and the
 * ten-megabyte CSV can be skipped. Lisbon, Madrid and Toronto all
 * resolve this way.
 *
 * WHY IT IS THIS SMALL: it used to be 250km, on the theory that a hub
 * anywhere in range settled the question. It doesn't. Birmingham is
 * 150km from Heathrow, which meant BHX — ten kilometres away, and with
 * its own flights to Toronto — was never even looked up. A shortcut
 * that skips the search has to be certain, and only a hub in the city
 * itself is.
 */
const HUB_IS_CITY_AIRPORT_KM = 50;

/** How far past the nearest airport a second one can be and still be a real choice. */
const ALT_AIRPORT_SLACK_KM = 50;

const CANDIDATES_PER_END = 2;
const GROUND_OPTIONS = 2;

/**
 * How many gateways to offer when nothing local flies to the destination.
 *
 * Three, because the choice is real (Toronto or Montreal, Paris or
 * Frankfurt) but stops being a choice past that — a fourth is another
 * hub the traveller has to rule out by hand.
 */
const GATEWAY_CANDIDATES = 3;

/** Rough door-to-door speeds, for the "how long is this transfer" estimate. */
const MODE_KMH: Partial<Record<TransportMode, number>> = {
  car: 85,
  bus: 65,
  train: 95,
  flight: 550,
};

/**
 * Written out here rather than imported from `itinerary/labels.ts`
 * because that module pulls in Lucide's React icon set, and a routing
 * engine has no business dragging icons into everything that imports
 * it — the tests included. Six nouns is the cheaper duplicate.
 */
const MODE_NOUN: Record<TransportMode, string> = {
  flight: "Flight",
  train: "Train",
  bus: "Bus",
  car: "Car",
  ferry: "Ferry",
  walk: "Walk",
};

// ---------- Proposing routes for one pair ----------

/**
 * Every way the engine can see of getting from `from` to `to`, best
 * first. The first entry is what gets used unless the user says
 * otherwise.
 *
 * NEVER REJECTS. A dropped connection, an empty airport dataset, a
 * city in the middle of nowhere — each degrades to a shorter answer
 * (a ground route, or a single placeholder hop) rather than throwing.
 * A trip that can't be routed is a normal state of a plan; an
 * exception escaping into a render is not.
 */
export async function proposeRoutes(
  from: Place,
  to: Place,
  deps: RouteEngineDeps = {},
): Promise<RouteOption[]> {
  // "Lisbon, then Lisbon" is not a journey. Same rule `deriveLegs`
  // applies, for the same reason: there is nothing to draw.
  if (from.id === to.id) return [];

  const km = distanceKm(from.coords, to.coords);
  const modes = plausibleModes(from, to);

  // The surface modes, in the order `plausibleModes` ranked them —
  // which is the whole heuristic, borrowed rather than rebuilt. An
  // empty list means there is no way to do this on the ground: an
  // ocean in the way, or further than anyone drives.
  const surface = modes.likely
    .filter((mode) => mode !== "flight")
    .slice(0, GROUND_OPTIONS);

  // `plausibleModes` puts flight first exactly when there is water in
  // the way, which is the one signal this engine needs and refuses to
  // work out for itself. Three consequences, all borrowed rather than
  // invented: a sea crossing is worth an air chain at any distance
  // (Seville to Marrakesh is 670km with a strait across it, and the
  // ferry lands three hundred kilometres from where you're going), it
  // is what the traveller should be offered first, and it is when the
  // curated hub table is worth preferring over whatever is nearest.
  const flightLeads = modes.likely[0] === "flight";

  const ground = surface.map((mode) => groundOption(from, to, mode));
  const worthFlying = flightLeads
    ? km >= SEA_CROSSING_MIN_FLIGHT_KM
    : km >= AIR_CHAIN_MIN_KM;
  const air = worthFlying
    ? await airOptions(from, to, km, flightLeads, deps)
    : [];

  if (air.length === 0 && ground.length === 0) {
    return [provisionalOption(from, to)];
  }

  const airLeads = flightLeads || km >= AIR_CHAIN_PREFERRED_KM;
  return airLeads ? [...air, ...ground] : [...ground, ...air];
}

function groundOption(from: Place, to: Place, mode: TransportMode): RouteOption {
  return {
    id: `ground-${mode}`,
    label: `${MODE_NOUN[mode]} to ${to.city}`,
    hops: [{ from, to, mode }],
  };
}

function provisionalOption(from: Place, to: Place): RouteOption {
  return {
    id: "direct",
    label: `Travel to ${to.city} — route unknown`,
    // `defaultMode` rather than a hardcoded "flight": if this ever
    // fires for a pair the geography says is a ferry, the placeholder
    // should say ferry.
    hops: [{ from, to, mode: defaultMode(from, to) }],
    provisional: true,
  };
}

// ---------- The three-hop air chain ----------

/**
 * City → airport → airport → city, for as many airport pairings as
 * are genuinely worth offering.
 *
 * The two ground hops are moded by `defaultMode`, so the transfer to
 * Pearson comes out as a train and the Lisbon metro run comes out as a
 * train too, without this file knowing anything about either.
 */
async function airOptions(
  from: Place,
  to: Place,
  km: number,
  preferCurated: boolean,
  deps: RouteEngineDeps,
): Promise<RouteOption[]> {
  const radiusKm = transferLimitKm(km);
  const find = deps.findAirports ?? liveAirports;

  const [origins, destinations] = await Promise.all([
    airportsNear(from, radiusKm, preferCurated, find),
    airportsNear(to, radiusKm, preferCurated, find),
  ]);

  // Nowhere to land is the end of it. Nowhere to take off from is not:
  // that is exactly when a gateway is the answer.
  if (destinations.length === 0) return [];

  const direct = directPairings(from, to, origins, destinations);
  if (direct.length > 0) {
    return direct.map(([origin, destination]) =>
      airChain(from, to, origin, destination),
    );
  }

  return gatewayOptions(from, to, origins, destinations);
}

// ---------- Does a flight actually exist? ----------

/**
 * `true`, `false`, or — the one that matters — `undefined`.
 *
 * WHY THREE ANSWERS AND NOT TWO. The snapshot behind `flightExists` is
 * from 2014, so a `false` means one of two unrelated things: the airport
 * is well covered and genuinely has no such route (Lyon appears in 275
 * routes, and none of them reach Toronto), or the snapshot has never
 * heard of the airport at all (Berlin Brandenburg appears in zero,
 * because it opened six years later). Treating the second as a `no`
 * would have this engine reject a working airport on the strength of
 * data that predates it.
 *
 * So `undefined` means "not our call", and every caller below reads it
 * as permission to fall back to the geography heuristic, which at least
 * knows the airport exists.
 */
function servesDirect(origin: Place, destination: Place): boolean | undefined {
  if (!origin.iata || !destination.iata) return undefined;
  if (!isKnownAirport(origin.iata) || !isKnownAirport(destination.iata)) {
    return undefined;
  }
  return flightExists(origin.iata, destination.iata);
}

/**
 * THE WHOLE FIX, IN ONE PREDICATE: connectivity filters, distance only
 * ranks what survives.
 *
 * The engine used to choose airports by proximity and hub status alone,
 * which answers "what is the nearest big airport" and then presents it
 * as "what airport can get me there". Those come apart constantly —
 * Lyon has an airport twenty kilometres away and you still fly to
 * Toronto out of Paris. An airport the data rules out is no longer a
 * candidate at all, however near it is and whether or not it is curated.
 */
function notRuledOut(origin: Place, destination: Place): boolean {
  return servesDirect(origin, destination) !== false;
}

/** Ground distance from the traveller to an airport, and back down at the far end. */
function transferCost(from: Place, to: Place, origin: Place, destination: Place) {
  return (
    distanceKm(from.coords, origin.coords) +
    distanceKm(destination.coords, to.coords)
  );
}

/**
 * Airport pairs with real service between them, least travelling first.
 *
 * The full cross product is deliberately not offered — what a traveller
 * wants to compare is the same flight out of the other airport, not four
 * near-identical chains — so this keeps the cheapest few and lets
 * `proposeRoutes` order them against the ground alternatives.
 */
function directPairings(
  from: Place,
  to: Place,
  origins: Place[],
  destinations: Place[],
): [Place, Place][] {
  const pairs: [Place, Place][] = [];

  for (const origin of origins) {
    for (const destination of destinations) {
      // Two destinations sharing a nearest hub is not a flight.
      if (origin.id === destination.id) continue;
      if (!notRuledOut(origin, destination)) continue;
      pairs.push([origin, destination]);
    }
  }

  return pairs
    .sort(
      (a, b) =>
        transferCost(from, to, a[0], a[1]) - transferCost(from, to, b[0], b[1]),
    )
    .slice(0, CANDIDATES_PER_END + 1);
}

/** city → airport → airport → city. */
function airChain(
  from: Place,
  to: Place,
  origin: Place,
  destination: Place,
): RouteOption {
  return {
    id: `air-${code(origin)}-${code(destination)}`.toLowerCase(),
    label: `Fly ${airportLabel(origin)} → ${airportLabel(destination)}`,
    hops: chain([
      { from, to: origin, mode: defaultMode(from, origin) },
      { from: origin, to: destination, mode: "flight" },
      { from: destination, to, mode: defaultMode(destination, to) },
    ]),
  };
}

// ---------- The gateway search ----------

interface Gateway {
  hub: Place;
  /** The airport at the far end that this gateway actually reaches. */
  arrival: Place;
  km: number;
  /** 1 = reachable overland, 2 = reachable only by flying to it. */
  tier: 1 | 2;
  /** For tier 2: the local airport the access flight leaves from. */
  via?: Place;
}

/**
 * "You cannot get there from here — so where do you have to get to first?"
 *
 * This is the question the engine could not previously ask. Nothing near
 * London, Ontario flies to Lisbon; plenty of places do, and one of them
 * is a two-hour bus away. Working that out means going at the problem
 * backwards — start from everything that lands where you are going, then
 * ask which of those you can reach — which is why `airportsFlyingTo`
 * exists and why no amount of geography substitutes for it.
 *
 * ONLY CURATED HUBS ARE CONSIDERED. Lisbon alone has 97 airports flying
 * into it, and resolving each to coordinates would be 97 lookups against
 * a ten-megabyte CSV to answer one question. The hand-written table is
 * already the set of airports worth connecting through, and it comes
 * with coordinates attached.
 *
 * DEPTH IS ONE, DELIBERATELY. The engine never looks for a gateway to a
 * gateway: a pair it cannot reach in one step is honestly unknown, and
 * there is no real trip whose answer is "a bus to a different bus to a
 * third airport".
 */
function gatewayOptions(
  from: Place,
  to: Place,
  origins: Place[],
  destinations: Place[],
): RouteOption[] {
  const candidates: Gateway[] = [];
  const seen = new Set<string>();

  for (const destination of destinations) {
    if (!destination.iata || !isKnownAirport(destination.iata)) continue;

    for (const iata of airportsFlyingTo(destination.iata)) {
      const hub = hubByIata(iata);
      if (!hub) continue;

      const key = `${hub.id}->${destination.id}`;
      if (seen.has(key) || hub.id === destination.id) continue;
      seen.add(key);

      const km = distanceKm(from.coords, hub.coords);

      // Tier 1: you can simply travel there. Same overland rules the
      // transfer to your own airport already follows — including the
      // short leash on crossing a border, because `isLandConnected`
      // works on continents and cannot see a strait.
      const overland =
        km <= MAX_TRANSFER_KM &&
        isLandConnected(from.country, hub.country) &&
        (hub.country === from.country || km <= MAX_CROSS_BORDER_TRANSFER_KM);

      // Tier 2: too far to drive, but your own airport flies there.
      // This is the London → Toronto case when the bus is not wanted.
      const via = overland
        ? undefined
        : origins.find(
            (origin) =>
              origin.id !== hub.id && servesDirect(origin, hub) === true,
          );

      if (!overland && !via) continue;

      candidates.push({
        hub,
        arrival: destination,
        km,
        tier: overland ? 1 : 2,
        via,
      });
    }
  }

  return candidates
    .sort((a, b) => a.tier - b.tier || a.km - b.km)
    .slice(0, GATEWAY_CANDIDATES)
    .map((candidate) => gatewayChain(from, to, candidate));
}

/**
 * The chain through a gateway. Four hops when the gateway itself has to
 * be flown to, which is a real shape and not a bug: London → YXU → YYZ
 * → LIS → Lisbon is one way people genuinely make that trip.
 */
function gatewayChain(from: Place, to: Place, gateway: Gateway): RouteOption {
  const { hub, arrival, via } = gateway;

  const access: RouteHop[] = via
    ? [
        { from, to: via, mode: defaultMode(from, via) },
        { from: via, to: hub, mode: "flight" },
      ]
    : [{ from, to: hub, mode: defaultMode(from, hub) }];

  return {
    id: `gateway-${code(hub)}-${code(arrival)}`.toLowerCase(),
    label: `Fly ${airportLabel(hub)} → ${airportLabel(arrival)}, via ${hub.city}`,
    hops: chain([
      ...access,
      { from: hub, to: arrival, mode: "flight" },
      { from: arrival, to, mode: defaultMode(arrival, to) },
    ]),
  };
}

// ---------- How you reach the gateway ----------

/**
 * Every way of getting to a gateway, for the traveller to choose between.
 *
 * The engine picks one for its own proposal; this is the same question
 * asked so a picker can offer all the answers. Deliberately no prices:
 * no free service quotes a bus fare, and an invented number is worse
 * than a blank the user can fill in from the booking site.
 */
export interface AccessOption {
  mode: TransportMode;
  /** One hop overland; two when it is a flight out of a local airport. */
  hops: RouteHop[];
  estimateMinutes?: number;
}

export function accessOptions(
  from: Place,
  gateway: Place,
  localAirports: readonly Place[] = [],
): AccessOption[] {
  const km = distanceKm(from.coords, gateway.coords);
  const options: AccessOption[] = [];

  for (const mode of plausibleModes(from, gateway).likely) {
    if (mode === "flight") continue;
    options.push({
      mode,
      hops: [{ from, to: gateway, mode }],
      estimateMinutes: estimateMinutes(km, mode),
    });
  }

  // Flying to the gateway is only on the table if something near home
  // actually flies there — the question this engine exists to ask.
  const via = localAirports.find(
    (airport) => airport.id !== gateway.id && servesDirect(airport, gateway) === true,
  );
  if (via) {
    options.push({
      mode: "flight",
      hops: [
        { from, to: via, mode: defaultMode(from, via) },
        { from: via, to: gateway, mode: "flight" },
      ],
      estimateMinutes: estimateMinutes(
        distanceKm(via.coords, gateway.coords),
        "flight",
      ),
    });
  }

  return options;
}

/**
 * Door to door, roughly. Rounded to five minutes because the honest
 * precision here is "about two hours", and a bare 137 claims a
 * timetable this engine has never seen.
 */
function estimateMinutes(km: number, mode: TransportMode): number | undefined {
  const kmh = MODE_KMH[mode];
  if (!kmh) return undefined;
  return Math.max(5, Math.round((km / kmh) * 12)) * 5;
}

/**
 * How far someone will travel overland to catch this particular
 * flight. Scaled, because the answer is obviously different for a
 * transatlantic crossing and for a two-hour hop — driving three
 * hours to Pearson to fly to Lisbon is normal; driving three hours
 * past your own airport to fly 300km is not. Long hauls all land on
 * `MAX_TRANSFER_KM` anyway, so the scale needs no special case for
 * them.
 */
function transferLimitKm(flightKm: number): number {
  return Math.min(
    MAX_TRANSFER_KM,
    Math.max(MIN_TRANSFER_KM, flightKm * TRANSFER_SHARE),
  );
}

/**
 * Airports worth flying out of near a city, best first.
 *
 * TWO SOURCES, AND THE CURATED ONE LEADS. `hubs.ts` exists because
 * OurAirports' size classification is a proxy for scheduled service
 * and occasionally an absurd one — the nearest `large_airport` to a
 * European city can be a cargo field nobody has ever flown to Toronto
 * from. So a curated hub in range answers the question outright, and
 * the live dataset is the fallback for everywhere the hand-written
 * table doesn't reach.
 *
 * The dedupe needs no special case: `hubs.ts` builds its ids in
 * `fetchAirport`'s `apt-{iata}` shape precisely so that the same
 * airport arriving from both sources collapses to one entry.
 */
async function airportsNear(
  city: Place,
  radiusKm: number,
  preferCurated: boolean,
  find: NonNullable<RouteEngineDeps["findAirports"]>,
): Promise<Place[]> {
  const near = (place: Place) => distanceKm(city.coords, place.coords);
  const reachable = (airport: Place) =>
    near(airport) <= radiusKm &&
    (airport.country === city.country ||
      near(airport) <= MAX_CROSS_BORDER_TRANSFER_KM);

  const curated: Place[] = nearestHubs(city.coords, CANDIDATES_PER_END).filter(
    reachable,
  );

  // The one shortcut, and it has to be certain: only skip the search
  // when a curated hub is already the city's own airport.
  const settled =
    curated.length > 0 && near(curated[0]) <= HUB_IS_CITY_AIRPORT_KM;

  // The network call, and the only one in this file. A failure here is
  // ordinary — offline, rate-limited, CSV moved — and costs at most
  // the alternatives: whatever the curated table already offered still
  // stands, and if it offered nothing the caller degrades to a ground
  // route or a placeholder.
  const fetched = settled
    ? []
    : (await lookUpAirports(find, city.coords)).filter(reachable);

  return rank(dedupeById([...curated, ...fetched]), curated[0], preferCurated, near);
}

/**
 * Pick the two airports worth putting in front of a traveller.
 *
 * THIS IS NO LONGER THE RECOMMENDATION — it is the SHORTLIST. Once
 * `directPairings` could ask whether a flight exists, the actual choice
 * moved there, and this function's job narrowed to deciding which two
 * airports per end are worth asking about at all.
 *
 * SLOT ONE still favours the curated hub on a long haul or a sea
 * crossing, and the reason survives the narrowing intact: the shortlist
 * is only two long, so an end whose two nearest airports both turn out
 * to fly nowhere useful has nothing left to offer. Reserving a slot for
 * a hub keeps a plausible long-haul candidate in the running to be
 * tested. Dropping this promotion fails three tests, which is the
 * honest reason it is still here — the earlier guess that connectivity
 * data would make it redundant was wrong.
 *
 * (Its old justification — that "closer" and "flies to another
 * continent" are different questions and only the hand-written table
 * answers the second — is now answered properly by `flightExists`.
 * Valencia loses to Barcelona on evidence rather than on curation.)
 *
 * SLOT TWO is reserved for the nearest airport that isn't slot one, so
 * long as it's a genuine choice rather than an airport in the next
 * country over. This is the half that used to be missing: the fetched
 * result was downloaded and then dropped, so Lyon was told to take a
 * 300km train to Milan while LYS sat unmentioned nineteen kilometres
 * away. Heathrow and Gatwick are a real choice; Lisbon and Porto are
 * not, even though Porto is the second-nearest hub to Lisbon.
 */
function rank(
  candidates: Place[],
  curatedLead: Place | undefined,
  preferCurated: boolean,
  near: (place: Place) => number,
): Place[] {
  const byDistance = [...candidates].sort((a, b) => near(a) - near(b));

  const lead = (preferCurated ? curatedLead : undefined) ?? byDistance[0];
  if (!lead) return [];

  const ceiling = Math.max(near(lead) * 1.5, near(lead) + ALT_AIRPORT_SLACK_KM);
  const alternative = byDistance.find(
    (airport) => airport.id !== lead.id && near(airport) <= ceiling,
  );

  return alternative ? [lead, alternative] : [lead];
}

/**
 * The airport lookup, bounded.
 *
 * `loadAirports` fetches without a signal, so a stalled connection
 * hangs forever rather than failing — and an engine that promises
 * never to reject would simply never settle instead, which is worse
 * than an error. A timeout reads as "no airports", which is a state
 * the caller already handles.
 */
async function lookUpAirports(
  find: NonNullable<RouteEngineDeps["findAirports"]>,
  at: Coordinates,
): Promise<Place[]> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      find(at),
      new Promise<Place[]>((resolve) => {
        timer = setTimeout(() => resolve([]), AIRPORT_LOOKUP_TIMEOUT_MS);
      }),
    ]);
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

/**
 * More than the two that can be offered, because the reachability
 * filter throws some away — the nearest large airports to Havana
 * include several across the Florida Straits.
 */
const liveAirports = (near: Coordinates) =>
  nearestAirports(near, { minType: "large_airport", limit: 5 });

/**
 * Drop the hops that go nowhere.
 *
 * A destination that IS an airport (nothing in the model forbids it)
 * would otherwise get a zero-length transfer hop bracketing its
 * flight, which `deriveLegs` would turn into a leg the map draws as a
 * dot and the itinerary lists as a journey to where you already are.
 */
function chain(hops: RouteHop[]): RouteHop[] {
  return hops.filter((hop) => hop.from.id !== hop.to.id);
}

function dedupeById(places: Place[]): Place[] {
  const byId = new Map<string, Place>();
  for (const place of places) {
    // First wins: the curated entry is listed ahead of the fetched one
    // and has the better-checked name and city.
    if (!byId.has(place.id)) byId.set(place.id, place);
  }
  return [...byId.values()];
}

/**
 * `iata` is optional on `Place` even though every airport either
 * source produces has one, so this falls back rather than baking
 * "undefined" into an option id.
 */
function code(place: Place): string {
  return place.iata ?? place.id;
}

/**
 * "Toronto (YYZ)" — the city is what a traveller recognises and the
 * code is what disambiguates it.
 *
 * The city is only trustworthy for a curated hub, though. OurAirports'
 * `municipality` is whichever settlement the runway physically sits
 * in, which is often a village nobody has heard of: Ljubljana's
 * airport comes back as "Zgornji Brnik", and "Fly Zgornji Brnik (LJU)"
 * is a route nobody will recognise as the one they meant. The
 * dataset's airport NAME does contain the city in those cases, so
 * that's what a fetched airport is labelled by.
 */
function airportLabel(place: Place): string {
  if (!place.iata) return place.name;
  return isHub(place.iata)
    ? `${place.city} (${place.iata})`
    : `${place.name} (${place.iata})`;
}

// ---------- Routing a whole trip ----------

/**
 * Options for every consecutive destination pair in the trip.
 *
 * Pairs are walked exactly the way `deriveLegs` walks them —
 * `[origin, ...destinations]`, skipping a place repeated back to back
 * — so the keys line up with what it will ask for. A pair that occurs
 * twice in one trip (Lisbon → Porto on the way up and again later) is
 * routed once: it is the same journey, and the `RouteMap` keys it
 * once too.
 */
export async function proposeTripRoutes(
  trip: Trip,
  deps: RouteEngineDeps = {},
): Promise<RouteOptionMap> {
  const places = [trip.origin, ...trip.destinations.map((d) => d.place)];

  const pairs = new Map<HopId, [Place, Place]>();
  for (let i = 0; i < places.length - 1; i++) {
    const from = places[i];
    const to = places[i + 1];
    if (from.id === to.id) continue;
    pairs.set(hopId(from, to), [from, to]);
  }

  const entries = await Promise.all(
    [...pairs].map(async ([id, [from, to]]) => {
      // Belt and braces over `proposeRoutes`' own promise never to
      // reject: one pair the engine chokes on must not take the other
      // eleven down with it. An empty list reads downstream as "no
      // idea", which is true and which `findGaps` already surfaces.
      const options = await proposeRoutes(from, to, deps).catch(
        () => [] as RouteOption[],
      );
      return [id, options] as const;
    }),
  );

  return new Map(entries);
}

/**
 * Collapse proposals to the one route per pair that the itinerary is
 * actually built from.
 *
 * `chosen` maps a destination-pair hop id to a `RouteOption.id`, which
 * is how a picker records "no, take the bus" durably: it names the
 * option rather than storing its hops, so the choice survives the
 * engine being re-run with better data. Anything unnamed falls to the
 * first option, which is the engine's own best guess.
 */
export function pickRoutes(
  options: RouteOptionMap,
  chosen: Record<HopId, string> = {},
): RouteMap {
  const routes: RouteMap = new Map();

  for (const [id, list] of options) {
    const picked = list.find((option) => option.id === chosen[id]) ?? list[0];
    // A provisional route carries no more information than the
    // placeholder `deriveLegs` would invent anyway, so storing it would
    // only hide the pair from `findGaps` — see `RouteOption.provisional`.
    if (!picked || picked.provisional) continue;
    routes.set(id, picked.hops);
  }

  return routes;
}

/**
 * The one call the app makes: trip in, `RouteMap` out, ready for
 * `deriveLegs(trip, routes, defaultMode)`.
 *
 * Use `proposeTripRoutes` + `pickRoutes` instead wherever the
 * alternatives matter — a UI offering the traveller the choice this
 * function makes silently on their behalf.
 */
export async function buildRouteMap(
  trip: Trip,
  deps: RouteEngineDeps = {},
): Promise<RouteMap> {
  return pickRoutes(await proposeTripRoutes(trip, deps));
}
