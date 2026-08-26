// ============================================================
// Which transport modes make sense for a given leg.
//
// WHY BOTHER: offering "walk" for Toronto → Lisbon isn't neutral.
// Six equally-weighted options make the form look like it has no
// idea what you're planning, and the one time it matters — a mode
// that's outright impossible — it lets you record something that
// can never happen.
//
// TWO LISTS, NOT A HARD FILTER. Anything ruled out stays reachable
// behind a disclosure. These are heuristics over distance and
// landmass, and heuristics are wrong sometimes: a Moroccan grand
// taxi, a repositioning ferry, a private flight. The README's rule
// that the app must stay usable while an itinerary is half-sketched
// applies here too — narrow the default, never block the plan.
// ============================================================

import type { Place, TransportMode } from "../model/trip";
import { distanceKm, isLandConnected } from "../lib/geo";
import { MODES } from "./labels";

export interface ModeOptions {
  /** Shown by default, best-first. */
  likely: TransportMode[];
  /** Everything else, behind "other modes". */
  unlikely: TransportMode[];
}

/**
 * Thresholds are deliberately generous — the goal is to remove the
 * absurd, not to enforce someone's idea of a sensible journey. People
 * really do drive 2,000km and take 30-hour buses.
 */
const WALK_FIRST_KM = 3;
const MAX_WALK_KM = 8;
const MAX_BUS_KM = 1_500;
const MAX_TRAIN_KM = 2_500;
const MAX_CAR_KM = 3_000;
/** Below this a flight is slower than the taxi to the airport. */
const MIN_FLIGHT_KM = 250;
/** A sea crossing longer than this is a cruise, not a way to get somewhere. */
const MAX_FERRY_KM = 900;

export function plausibleModes(from?: Place, to?: Place): ModeOptions {
  // With an endpoint missing there's nothing to reason from, so
  // everything stays on the table.
  if (!from || !to) {
    return { likely: MODES, unlikely: [] };
  }

  const km = distanceKm(from.coords, to.coords);
  const overland = isLandConnected(from.country, to.country);

  const likely: TransportMode[] = [];

  // Order matters: the first entry is what a new leg defaults to, so
  // each branch lists its most probable mode first.
  //
  // Walking leads only at genuinely walkable range. Between three and
  // eight kilometres it stays on the list but yields the default to
  // transit — an airport-to-station transfer is four kilometres, and
  // nobody walks that with luggage.
  if (km <= WALK_FIRST_KM) likely.push("walk");

  if (overland) {
    if (km <= MAX_TRAIN_KM) likely.push("train");
    if (km <= MAX_BUS_KM) likely.push("bus");
    if (km <= MAX_CAR_KM) likely.push("car");
  }

  if (km > WALK_FIRST_KM && km <= MAX_WALK_KM) likely.push("walk");

  if (km >= MIN_FLIGHT_KM || !overland) {
    // A leg with an ocean in the way is a flight before it's anything
    // else, so it leads rather than trails the ground modes.
    if (!overland) likely.unshift("flight");
    else likely.push("flight");
  }

  // Ferries earn a default slot only where the water is the whole
  // reason the leg exists — Algeciras to Tanger, not Lisbon to Porto.
  if (!overland && km <= MAX_FERRY_KM) {
    likely.push("ferry");
  }

  // Nothing matched (a same-place leg, or a gap in the rules): fall
  // back to offering everything rather than an empty picker.
  if (likely.length === 0) {
    return { likely: MODES, unlikely: [] };
  }

  return {
    likely,
    unlikely: MODES.filter((mode) => !likely.includes(mode)),
  };
}

/**
 * The mode a brand-new leg should start on.
 *
 * Guessing from geography beats defaulting to a fixed mode: the guess
 * is right most of the time, and when it's wrong it's one click to
 * change — whereas a fixed default is wrong for most legs of a trip
 * that spans a transatlantic flight and a walk between two stations.
 */
export function defaultMode(from?: Place, to?: Place): TransportMode {
  return plausibleModes(from, to).likely[0] ?? "train";
}
