// ============================================================
// Leg -> GeoJSON. This is the only place that decides *what shape*
// a leg draws as; style.ts decides how that shape is painted.
// ============================================================

import { greatCircle } from "@turf/great-circle";
import type {
  Feature,
  FeatureCollection,
  LineString,
  MultiLineString,
  Point,
} from "geojson";

import type { Destination, Leg, PlanStatus, TransportMode } from "../model/trip";
import { MODE_COLORS } from "../itinerary/labels";

/** Carried on every feature so MapLibre's data-driven expressions can
 * key off them, and so a click handler can map a feature back to its leg. */
export interface LegProperties {
  legId: string;
  mode: TransportMode;
  status: PlanStatus;
  /** The mode's colour, carried here so the map needs no lookup table. */
  color: string;
}

export type LegFeature = Feature<LineString | MultiLineString, LegProperties>;

function legProperties(leg: Leg): LegProperties {
  return {
    legId: leg.id,
    mode: leg.mode,
    status: leg.status,
    color: MODE_COLORS[leg.mode],
  };
}

function straightLine(leg: Leg): LegFeature {
  return {
    type: "Feature",
    properties: legProperties(leg),
    geometry: {
      type: "LineString",
      coordinates: [leg.from.coords, leg.to.coords],
    },
  };
}

/**
 * One leg -> one feature, with geometry that depends on mode.
 *
 * WHY FLIGHTS ARE SPECIAL: a flight doesn't follow a road or track, so
 * the *shortest* path between two airports is a curve on a Mercator
 * map, not a straight line — `turf.greatCircle` computes that curve.
 * If the route crosses the antimeridian, Turf splits it into a
 * MultiLineString, which is why `LegFeature`'s geometry type includes
 * both; MapLibre's line layer renders either without extra handling.
 *
 * Every other mode gets a straight line for now. There's no free
 * rail-routing API and OSRM's public demo server isn't for production
 * use (see README), so a straight line between stations is the
 * honest option — it reads fine at country zoom and doesn't block
 * this step on solving routing.
 */
export function legToFeature(leg: Leg): LegFeature {
  if (leg.mode === "flight") {
    return greatCircle(leg.from.coords, leg.to.coords, {
      properties: legProperties(leg),
    }) as LegFeature;
  }
  return straightLine(leg);
}

export function legsToCollection(
  legs: Leg[],
): FeatureCollection<LineString | MultiLineString, LegProperties> {
  return {
    type: "FeatureCollection",
    features: legs.map(legToFeature),
  };
}

// ============================================================
// Destination -> GeoJSON.
//
// A destination is a different KIND of thing from a leg endpoint: it's
// somewhere the trip stops on purpose, not just wherever a hop happens
// to start or end (an airport, a transfer station). Legs don't carry
// that distinction — `Leg.from`/`Leg.to` are just `Place`s — so
// destinations get their own source and their own point layer rather
// than being folded into the line geometry above. See style.ts for how
// they're painted.
// ============================================================

/** Carried on every destination-marker feature. */
export interface DestinationProperties {
  destinationId: string;
  status: PlanStatus;
  /** What you'd call the place out loud, for the map label. */
  name: string;
  /**
   * Always a number, since MapLibre expressions can't branch on
   * "absent" the way TypeScript can — but `-1` is a sentinel for
   * "the user hasn't decided yet," kept deliberately distinct from an
   * explicit `0`. `destination.nights ?? 0` would have rendered an
   * undecided stop identically to a day trip the traveller has
   * actually chosen to make — collapsing exactly the distinction
   * `Destination.nights` being optional exists to preserve. See
   * `NIGHTS_RADIUS` in style.ts for how the two stay visually distinct.
   */
  nights: number;
}

export type DestinationFeature = Feature<Point, DestinationProperties>;

function destinationToFeature(destination: Destination): DestinationFeature {
  return {
    type: "Feature",
    properties: {
      destinationId: destination.id,
      status: destination.status,
      name: destination.place.name,
      nights: destination.nights ?? -1,
    },
    geometry: {
      type: "Point",
      // Always through `.coords` on the Place, never a hand-built
      // tuple — see the [lng, lat] warning on `Coordinates` in
      // model/trip.ts.
      coordinates: destination.place.coords,
    },
  };
}

export function destinationsToCollection(
  destinations: Destination[],
): FeatureCollection<Point, DestinationProperties> {
  return {
    type: "FeatureCollection",
    features: destinations.map(destinationToFeature),
  };
}
