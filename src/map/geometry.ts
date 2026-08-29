// ============================================================
// Leg -> GeoJSON. This is the only place that decides *what shape*
// a leg draws as; style.ts decides how that shape is painted.
// ============================================================

import { greatCircle } from "@turf/great-circle";
import type { Feature, FeatureCollection, LineString, MultiLineString } from "geojson";

import type { Leg, PlanStatus, TransportMode } from "../model/trip";
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
