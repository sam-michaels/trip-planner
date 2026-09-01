// ============================================================
// Sampling a point partway along a leg's drawn line.
//
// geometry.ts decides what shape a leg draws as and style.ts decides
// how it's painted; this file answers the one question neither of
// them can: where is 40% of the way along, and which way is it
// facing? That's what a vehicle travelling the route needs, sixty
// times a second.
//
// Deliberately free of any MapLibre import. The whole file is
// arithmetic over a coordinate list, which is what makes the
// antimeridian and zero-length cases testable without a map.
// ============================================================

import type { Coordinates } from "../model/trip";
import { bearingDegrees, distanceKm } from "../lib/geo";
import type { LegFeature } from "./geometry";

export interface LegPath {
  /** Every vertex of the drawn line, flattened and unwrapped. */
  coords: Coordinates[];
  /** Kilometres travelled by each vertex; the last entry is the total. */
  cumulative: number[];
  lengthKm: number;
}

/**
 * Flatten a leg's geometry into one continuous vertex list.
 *
 * TWO THINGS THIS HAS TO SURVIVE:
 *
 * MULTILINESTRING. `greatCircle()` splits a route that crosses the
 * antimeridian into two LineStrings (see geometry.ts). MapLibre draws
 * that as one unbroken arc, so a vehicle has to treat it as one path
 * too — the rings are concatenated rather than walked separately.
 *
 * WRAPPED LONGITUDE. Those two rings meet at ±180, so raw
 * concatenation leaves a step from 179.9 to -179.9: a segment the
 * arithmetic below reads as three-quarters of the way around the
 * planet, travelled in one frame. Unwrapping shifts each vertex by
 * whole turns so consecutive longitudes never jump more than half the
 * globe, which turns that step into 179.9 -> 180.1. MapLibre accepts
 * longitudes outside [-180, 180] and wraps them itself, so the
 * unwrapped values can go straight into a source.
 */
function unwrappedVertices(feature: LegFeature): Coordinates[] {
  const rings =
    feature.geometry.type === "MultiLineString"
      ? feature.geometry.coordinates
      : [feature.geometry.coordinates];

  const flat = rings.flat() as Coordinates[];
  if (flat.length === 0) return [];

  const out: Coordinates[] = [[flat[0][0], flat[0][1]]];

  for (let i = 1; i < flat.length; i++) {
    const [lng, lat] = flat[i];
    const previousLng = out[i - 1][0];
    // Round rather than a single ±360: a duplicated seam vertex can
    // land more than one turn away, and rounding handles any of them.
    const turns = Math.round((lng - previousLng) / 360);
    out.push([lng - turns * 360, lat]);
  }

  return out;
}

export function legPath(feature: LegFeature): LegPath {
  const coords = unwrappedVertices(feature);

  const cumulative: number[] = [];
  let total = 0;

  for (let i = 0; i < coords.length; i++) {
    if (i > 0) total += distanceKm(coords[i - 1], coords[i]);
    cumulative.push(total);
  }

  return { coords, cumulative, lengthKm: total };
}

export interface PathPoint {
  coords: Coordinates;
  /** Degrees clockwise from north, along the segment being crossed. */
  heading: number;
}

/**
 * The point `t` of the way along the path, 0 at the start and 1 at the
 * end, with the heading of the segment it falls on.
 *
 * DEGENERATE PATHS ARE NORMAL HERE, not a caller error: a leg whose
 * endpoints are the same place has zero length, and dividing by it
 * would put a plane at NaN, which MapLibre drops silently — a vehicle
 * that is simply missing, with nothing in the console to say why. So a
 * zero-length or single-vertex path resolves to its one coordinate,
 * facing north.
 *
 * Interpolation is linear in lng/lat rather than along a great circle.
 * The vertices already came from `greatCircle()` for flights, so the
 * curve is in the data; this only has to cross the short hop between
 * two of its samples, where the difference from a true spherical
 * interpolation is far below a pixel.
 */
export function pointAt(path: LegPath, t: number): PathPoint {
  const { coords, cumulative, lengthKm } = path;

  if (coords.length === 0) return { coords: [0, 0], heading: 0 };
  if (coords.length === 1 || lengthKm === 0) {
    return { coords: [coords[0][0], coords[0][1]], heading: 0 };
  }

  const target = Math.min(Math.max(t, 0), 1) * lengthKm;

  // The first vertex at or past the target ends the segment we're on.
  // Starting at 1 keeps `index - 1` in range, and t=0 lands on the
  // first segment rather than falling off the front.
  let index = 1;
  while (index < cumulative.length - 1 && cumulative[index] < target) index++;

  const from = coords[index - 1];
  const to = coords[index];
  const segmentKm = cumulative[index] - cumulative[index - 1];
  // Two identical vertices in the source data — Turf emits them at the
  // antimeridian seam — would otherwise divide by zero.
  const along = segmentKm === 0 ? 0 : (target - cumulative[index - 1]) / segmentKm;

  return {
    coords: [
      from[0] + (to[0] - from[0]) * along,
      from[1] + (to[1] - from[1]) * along,
    ],
    heading: bearingDegrees(from, to),
  };
}
