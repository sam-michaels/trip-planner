// ============================================================
// The vehicle travelling each route.
//
// One per leg, in that leg's mode and colour, departing A and
// arriving B on a loop. path.ts answers "where is 40% of the way
// along"; this file decides how fast, when, how bright, and which way
// up — and hands MapLibre a fresh FeatureCollection every frame.
//
// WHY THIS REPLACED THE REPEATED ICONS: the route layer used to
// stamp the mode's glyph along the line every 130px. That said what
// kind of journey a line was, but never which way it went — nothing
// on the map distinguished Porto -> Lisbon from Lisbon -> Porto. One
// icon that moves says both. Keeping the parked ones as well was
// tried on paper and rejected: five stationary planes with a sixth
// sliding past them reads as a rendering fault, not as a journey.
//
// PACING IS BY GROUND DISTANCE, NOT BY THE LEG'S OWN DURATION. Using
// the real travel time was tempting and wrong twice over: most legs
// have no times entered yet, so the map would have paced half its
// vehicles by one rule and half by another, and where it did work it
// inverts — the twelve-hour flight would crawl while the twenty
// minute metro hop shot across the screen.
// ============================================================

import type { Feature, FeatureCollection, Point } from "geojson";

import type { Leg, TransportMode } from "../model/trip";
import { MODE_COLORS } from "../itinerary/labels";
import type { LegPath } from "./path";
import { pointAt } from "./path";
import { STATUS_OPACITY } from "./style";

/**
 * Which glyphs may be turned to face where they're going, and by how
 * much the artwork is already rotated.
 *
 * A mode is in this table only if its icon is drawn from ABOVE, where
 * "facing north-east" is a meaningful thing for it to do. `plane` and
 * `footprints` are plan views. `train-front` and `ship` are drawn
 * head-on and `bus` and `car` in side elevation, so turning them is
 * incoherent at best — a side-view car on a westward heading drives
 * along upside down — and they stay upright instead.
 *
 * The value is where the artwork's nose already points, in degrees
 * clockwise from up: lucide's plane flies toward the top-right corner
 * of its box, so it needs 45 taken off its heading to point true.
 */
const GLYPH_NOSE_DEGREES: Partial<Record<TransportMode, number>> = {
  flight: 45,
  walk: 0,
};

/** Kilometres of ground per second of animation, before clamping. */
const KM_PER_SECOND = 170;

/**
 * How long one run may take. Without the floor, a four-kilometre
 * airport transfer is over before the eye finds it; without the
 * ceiling, a transatlantic flight is a nine-hour crawl.
 */
const MIN_RUN_MS = 4_000;
const MAX_RUN_MS = 14_000;

/**
 * The fraction of a cycle spent moving. The remainder is the vehicle
 * sitting at B before it fades — a run has to ARRIVE somewhere, and a
 * loop that wraps straight back to A reads as a stutter rather than
 * as a second journey.
 */
const TRAVEL_FRACTION = 0.85;

const FADE_IN_END = 0.05;
const FADE_OUT_START = 0.9;

export function runDurationMs(lengthKm: number): number {
  const raw = (lengthKm / KM_PER_SECOND) * 1000;
  return Math.min(Math.max(raw, MIN_RUN_MS), MAX_RUN_MS);
}

/**
 * A stable offset in [0, 1) so vehicles don't march in lockstep.
 *
 * Derived from the leg's id rather than from its index, because index
 * changes whenever the itinerary is reordered — and a vehicle that
 * jumps to a new point on its line because a different leg was
 * dragged is a glitch with no explanation on screen.
 *
 * FNV-1a: three lines, no dependency, and evenly spread over short
 * ids, which is all that's being asked of it.
 */
export function phaseFor(legId: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < legId.length; i++) {
    hash ^= legId.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return ((hash >>> 0) % 10_000) / 10_000;
}

/** Departure and arrival, so a vehicle doesn't blink in and out at full strength. */
function envelope(p: number): number {
  const raw =
    p < FADE_IN_END
      ? p / FADE_IN_END
      : p > FADE_OUT_START
        ? (1 - p) / (1 - FADE_OUT_START)
        : 1;
  // Smoothstep: a linear fade has a visible corner at each end.
  return raw * raw * (3 - 2 * raw);
}

export interface VehicleProperties {
  legId: string;
  mode: TransportMode;
  /** The mode's colour, carried so nothing downstream needs a lookup table. */
  color: string;
  /** What `icon-rotate` should be — heading with the artwork's own offset removed. */
  heading: number;
  rotates: boolean;
  opacity: number;
  size: number;
}

export interface LegWithPath {
  leg: Leg;
  path: LegPath;
}

/**
 * Where every vehicle is right now.
 *
 * `still` is the paused / reduced-motion case: each vehicle parks at
 * the midpoint of its line at full presence, which is roughly what one
 * of the old repeated markers looked like. A resting map still shows
 * one icon per route rather than none.
 */
export function vehicleCollection(
  paths: LegWithPath[],
  elapsedMs: number,
  selectedLegId: string | undefined,
  still: boolean,
): FeatureCollection<Point, VehicleProperties> {
  return {
    type: "FeatureCollection",
    features: paths.map(({ leg, path }) =>
      vehicleFeature(leg, path, elapsedMs, selectedLegId === leg.id, still),
    ),
  };
}

function vehicleFeature(
  leg: Leg,
  path: LegPath,
  elapsedMs: number,
  selected: boolean,
  still: boolean,
): Feature<Point, VehicleProperties> {
  const cycle = still
    ? { t: 0.5, presence: 1 }
    : progress(elapsedMs, path.lengthKm, leg.id);

  const { coords, heading } = pointAt(path, cycle.t);
  const nose = GLYPH_NOSE_DEGREES[leg.mode];

  // Selection is size and full opacity, never dimming the rest: an
  // unbooked leg is already at 0.72 and the design record forbids
  // taking it lower, so pushing unselected vehicles down to make one
  // stand out would have broken the one rule protecting ideas from
  // looking like failures.
  const base = selected ? 1 : STATUS_OPACITY[leg.status];

  return {
    type: "Feature",
    properties: {
      legId: leg.id,
      mode: leg.mode,
      color: MODE_COLORS[leg.mode],
      heading: nose === undefined ? 0 : heading - nose,
      rotates: nose !== undefined,
      opacity: base * cycle.presence,
      size: selected ? 1.2 : 1,
    },
    geometry: { type: "Point", coordinates: coords },
  };
}

/** How far into its run a leg's vehicle is, and how present it is. */
export function progress(elapsedMs: number, lengthKm: number, legId: string) {
  const p = (elapsedMs / runDurationMs(lengthKm) + phaseFor(legId)) % 1;
  return { t: Math.min(p / TRAVEL_FRACTION, 1), presence: envelope(p) };
}
