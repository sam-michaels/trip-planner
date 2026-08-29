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
import { distanceKm } from "./geo";
import { isHub, nearestHubs } from "./hubs";
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
 * Above this, flying leads the list even where the ground route is
 * perfectly real and `plausibleModes` ranked it first. Roughly the
 * point where a European train stops being a day and starts being a
 * day and a night.
 */
const AIR_CHAIN_PREFERRED_KM = 1_000;

/** Ground transfer to an airport: never shorter than this... */
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
/** ...and never more than this share of the flight it exists to catch. */
const TRANSFER_SHARE = 0.12;

/**
 * A curated hub this close settles the question on its own — no point
 * downloading a ten-megabyte CSV to be told about the same airport.
 * The motivating trip (Toronto Pearson, Lisbon) never touches the
 * network because of this line.
 */
const HUB_TRUSTED_KM = 250;

/** How far past the nearest airport a second one can be and still be a real choice. */
const ALT_AIRPORT_SLACK_KM = 50;

const CANDIDATES_PER_END = 2;
const GROUND_OPTIONS = 2;
const AIR_OPTIONS = 3;

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
  // empty list is the engine's definition of "this has to be flown":
  // an ocean in the way, or further than anyone drives.
  const surface = modes.likely
    .filter((mode) => mode !== "flight")
    .slice(0, GROUND_OPTIONS);
  const mustFly = surface.length === 0;

  // `plausibleModes` puts flight first exactly when there is water in
  // the way, which is the one signal this engine needs and refuses to
  // work out for itself. Two consequences, both borrowed rather than
  // invented: a sea crossing is worth an air chain at any distance
  // (Seville to Marrakesh is 670km with a strait across it, and the
  // ferry lands three hundred kilometres from where you're going), and
  // it is what the traveller should be offered first.
  const flightLeads = modes.likely[0] === "flight";

  const ground = surface.map((mode) => groundOption(from, to, mode));
  const air =
    flightLeads || km >= AIR_CHAIN_MIN_KM
      ? await airOptions(from, to, km, mustFly, deps)
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
  longHaul: boolean,
  deps: RouteEngineDeps,
): Promise<RouteOption[]> {
  // A crossing with no ground alternative gets the full budget: you
  // would genuinely drive half a day to catch the one flight to
  // another continent. Anything shorter has to justify the transfer
  // against the flight it is there to catch.
  const radiusKm = longHaul ? MAX_TRANSFER_KM : transferLimitKm(km);
  const find = deps.findAirports ?? liveAirports;

  const [origins, destinations] = await Promise.all([
    airportsNear(from, radiusKm, longHaul, find),
    airportsNear(to, radiusKm, longHaul, find),
  ]);

  // Vary one end at a time from the best pairing. The full cross
  // product would offer four near-identical routes and bury the one
  // that matters; what a traveller actually wants to compare is "the
  // same flight out of the other airport".
  const pairings: [Place, Place][] = [];
  for (const [origin, destination] of [
    [origins[0], destinations[0]],
    [origins[1], destinations[0]],
    [origins[0], destinations[1]],
  ]) {
    // A pairing that flies an airport to itself isn't a flight — it
    // happens when two destinations share their nearest hub.
    if (!origin || !destination || origin.id === destination.id) continue;
    pairings.push([origin, destination]);
  }

  return pairings.slice(0, AIR_OPTIONS).map(([origin, destination]) => ({
    id: `air-${code(origin)}-${code(destination)}`.toLowerCase(),
    label: `Fly ${airportLabel(origin)} → ${airportLabel(destination)}`,
    hops: chain([
      { from, to: origin, mode: defaultMode(from, origin) },
      { from: origin, to: destination, mode: "flight" },
      { from: destination, to, mode: defaultMode(destination, to) },
    ]),
  }));
}

/**
 * How far someone will travel overland to catch this particular
 * flight. Scaled, because the answer is obviously different for a
 * transatlantic crossing and for a two-hour hop — driving three
 * hours to Pearson to fly to Lisbon is normal; driving three hours
 * past your own airport to fly 800km is not.
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

  const curated: Place[] = nearestHubs(city.coords, CANDIDATES_PER_END).filter(
    (hub) => near(hub) <= radiusKm,
  );

  if (curated.length > 0 && near(curated[0]) <= HUB_TRUSTED_KM) {
    return competitive(curated, near);
  }

  // The network call, and the only one in this file. A failure here is
  // ordinary — offline, rate-limited, CSV moved — and costs at most
  // the alternatives: whatever the curated table already offered still
  // stands, and if it offered nothing the caller degrades to a ground
  // route or a placeholder.
  const fetched = (await find(city.coords).catch(() => [])).filter(
    (airport) => near(airport) <= radiusKm,
  );

  const merged = dedupeById([...curated, ...fetched]);

  // On a long haul the curated hub keeps the lead even when a closer
  // airport exists, because "closer" and "has a flight to another
  // continent" are different questions and only the table answers the
  // second. On a shorter flight, closest wins.
  return competitive(
    preferCurated ? merged : [...merged].sort((a, b) => near(a) - near(b)),
    near,
  );
}

/**
 * Trim a distance-ordered candidate list to the airports a person
 * would actually weigh against each other.
 *
 * Heathrow and Gatwick are a real choice; Lisbon and Porto are not,
 * even though Porto is the second-nearest hub to Lisbon. The test is
 * relative to whatever the nearest option turned out to be, so it
 * holds both for a city with an airport in it and for one three hours
 * from the nearest runway.
 */
function competitive(sorted: Place[], near: (place: Place) => number): Place[] {
  const [best] = sorted;
  if (!best) return [];

  const ceiling = Math.max(near(best) * 1.5, near(best) + ALT_AIRPORT_SLACK_KM);
  return sorted
    .filter((airport) => near(airport) <= ceiling)
    .slice(0, CANDIDATES_PER_END);
}

const liveAirports = (near: Coordinates) =>
  nearestAirports(near, {
    minType: "large_airport",
    limit: CANDIDATES_PER_END + 1,
  });

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
 * source produces has one, so both of these fall back rather than
 * printing "undefined" at somebody planning a trip.
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
