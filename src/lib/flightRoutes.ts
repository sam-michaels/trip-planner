// ============================================================
// Direct-flight lookup over a vendored OpenFlights snapshot.
//
// `hubs.ts` answers "is this airport a hub worth connecting through";
// this answers a narrower, more literal question: "does a scheduled
// airline route exist between these two IATA codes at all". The
// route engine needs both — a hub with no direct flight to where
// you're starting from is useless as a connection point.
//
// ponytail: 2014 OpenFlights snapshot; false negatives route you via a bigger
// hub than needed. Curated overrides in FLIGHT_ROUTE_CORRECTIONS; swap for a
// live carrier feed if the misses start mattering.
// ============================================================

import { FLIGHT_ROUTE_TABLE } from "./flightRoutes.data";

// Static import, not a lazy `await import()`, even though the data
// module is large and only some callers need it: these three
// functions get called inside the route engine's tight loops
// (candidate-hub scans, leg-by-leg feasibility checks), and an async
// signature would force every one of those call sites to thread a
// Promise through code that is otherwise synchronous. A synchronous
// API is worth more here than shaving the initial bundle — the table
// still isn't *parsed* until the first call (see `getForwardMap`
// below), so a page that never calls these pays only the string's
// bytes, not the Map-building cost.

/**
 * Hand corrections for routes the 2014 snapshot gets wrong — an
 * airline that's since added or dropped a route, or a pair OpenFlights
 * never had data for. Keyed the same way the generated table is
 * (uppercase IATA, one entry per origin), so a correction reads the
 * same way a real row would. Empty until a specific miss is reported;
 * resist the urge to pre-populate it from a hunch.
 */
export const FLIGHT_ROUTE_CORRECTIONS: ReadonlyMap<string, readonly string[]> =
  new Map();

let forwardMap: Map<string, Set<string>> | undefined;

/** Parses `FLIGHT_ROUTE_TABLE` (plus corrections) into origin -> destinations, once. */
function getForwardMap(): Map<string, Set<string>> {
  if (forwardMap) return forwardMap;

  const map = new Map<string, Set<string>>();
  for (const line of FLIGHT_ROUTE_TABLE.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const [origin, ...dsts] = trimmed.split(" ");
    map.set(origin, new Set(dsts));
  }

  for (const [origin, dsts] of FLIGHT_ROUTE_CORRECTIONS) {
    const existing = map.get(origin);
    if (existing) {
      for (const dst of dsts) existing.add(dst);
    } else {
      map.set(origin, new Set(dsts));
    }
  }

  forwardMap = map;
  return map;
}

let inverseMap: Map<string, Set<string>> | undefined;

/** Builds destination -> origins by inverting the forward map, once. */
function getInverseMap(): Map<string, Set<string>> {
  if (inverseMap) return inverseMap;

  const map = new Map<string, Set<string>>();
  for (const [origin, dsts] of getForwardMap()) {
    for (const dst of dsts) {
      const existing = map.get(dst);
      if (existing) {
        existing.add(origin);
      } else {
        map.set(dst, new Set([origin]));
      }
    }
  }

  inverseMap = map;
  return map;
}

const EMPTY_SET: ReadonlySet<string> = new Set();

/** Whether OpenFlights lists a direct route from `from` to `to`. Case-insensitive. */
export function flightExists(from: string, to: string): boolean {
  return (
    getForwardMap().get(from.toUpperCase())?.has(to.toUpperCase()) ?? false
  );
}

/** Every airport with a direct route into `to`. Case-insensitive; unknown codes return empty. */
export function airportsFlyingTo(to: string): ReadonlySet<string> {
  return getInverseMap().get(to.toUpperCase()) ?? EMPTY_SET;
}

/** Every airport `from` has a direct route to. Case-insensitive; unknown codes return empty. */
export function destinationsFrom(from: string): ReadonlySet<string> {
  return getForwardMap().get(from.toUpperCase()) ?? EMPTY_SET;
}

/**
 * Does the snapshot know this airport at all — in either direction?
 *
 * THE GUARD THAT MAKES THE REST SAFE TO ACT ON. `flightExists` returning
 * false means one of two things, and they are not the same fact:
 *
 *   * The airport is well represented and simply has no such route.
 *     Lyon appears in 275 routes and none of them reach Toronto, so
 *     "you cannot fly Lyon → Toronto direct" is a confident answer.
 *   * The snapshot has never heard of the airport. Berlin Brandenburg
 *     appears in ZERO routes, because it opened in 2020 and this data
 *     is from 2014. "No route" there is missing data wearing the same
 *     clothes as a real answer.
 *
 * So a caller may only REJECT an airport this returns true for. For
 * anything else the honest position is that we cannot judge it, and the
 * geography heuristic — which at least knows the airport exists — should
 * decide instead.
 *
 * WHY THIS AND NOT JUST `FLIGHT_ROUTE_CORRECTIONS`: a corrections table
 * fixes the airports somebody remembered to add. This rule degrades
 * correctly for every airport built after 2014, including the ones
 * nobody here has thought of yet.
 */
export function isKnownAirport(iata: string): boolean {
  const code = iata.toUpperCase();
  return getForwardMap().has(code) || getInverseMap().has(code);
}
