// ============================================================
// How long things take, and how long you stay.
//
// THE CONSTRAINT THIS FILE WORKS AROUND: times are stored as local
// wall-clock with no offset (see datetime.ts). Subtracting two of
// them is only a real duration when both are on the same clock.
// Toronto 20:15 → Lisbon 08:30 is a 7-hour flight that naive
// arithmetic calls 12h15m.
//
// So durations are computed only where the answer is trustworthy,
// and simply withheld where it isn't. Showing "12h 15m" for that
// flight would be worse than showing nothing: a wrong number gets
// believed and planned around, a missing one gets looked up.
//
// The good news is that the number the itinerary most wants — how
// long you're in a city between two legs — is always safe, because
// both of its endpoints are in that same city.
// ============================================================

import type { Leg, Place } from "../model/trip";
import { toMillis } from "./datetime";

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

/** Below this, a stop isn't a wait — you land and keep moving. */
const STRAIGHT_THROUGH_MS = 10 * 60_000;

/**
 * Whether two places are close enough to certainly share a clock.
 *
 * Same country plus a narrow longitude span. The country check alone
 * fails for Canada (Toronto and Vancouver are three hours apart), and
 * the longitude check alone fails at borders where the zone changes
 * over a short distance. Together they're conservative in the right
 * direction: they say "no" more often than they should, and saying
 * "no" only costs a hidden duration.
 */
function sharesClock(a: Place, b: Place): boolean {
  return a.country === b.country && Math.abs(a.coords[0] - b.coords[0]) < 15;
}

/**
 * How long the leg takes, or `undefined` if that can't be answered
 * honestly — either the times aren't filled in, or the endpoints are
 * on different clocks.
 */
export function travelDuration(leg: Leg): number | undefined {
  if (!leg.departure || !leg.arrival) return undefined;
  if (!sharesClock(leg.from, leg.to)) return undefined;

  const ms = toMillis(leg.arrival) - toMillis(leg.departure);
  return ms > 0 ? ms : undefined;
}

/** True when a duration is being withheld only because of timezones — the
 * UI says "crosses time zones" rather than showing nothing at all. */
export function crossesTimezones(leg: Leg): boolean {
  return Boolean(leg.departure && leg.arrival && !sharesClock(leg.from, leg.to));
}

/**
 * The stretch between arriving on one leg and departing on the next —
 * i.e. the time actually spent in a place.
 *
 * Always safe to compute: both timestamps are local to the same city,
 * so whatever timezone that city is in cancels out.
 */
export function timeInPlace(
  arriving: Leg,
  departing: Leg,
): number | undefined {
  if (!arriving.arrival || !departing.departure) return undefined;

  const ms = toMillis(departing.departure) - toMillis(arriving.arrival);
  return ms >= 0 ? ms : undefined;
}

/**
 * Nights, counted as calendar-date changes rather than 24-hour blocks.
 *
 * WHY: hotels bill by night, and "check in Friday afternoon, out
 * Sunday morning" is two nights even though it's only ~40 hours.
 * Dividing by 86,400,000 would call that one.
 */
export function nightsBetween(from: string, to: string): number {
  const start = new Date(toMillis(from));
  const end = new Date(toMillis(to));

  start.setHours(0, 0, 0, 0);
  end.setHours(0, 0, 0, 0);

  return Math.max(0, Math.round((end.getTime() - start.getTime()) / DAY_MS));
}

/** "6h 45m", "45m", "2d 3h" — compact enough for a one-line label. */
export function formatDuration(ms: number): string {
  const minutes = Math.round(ms / 60_000);

  if (minutes < 60) return `${minutes}m`;

  const hours = Math.floor(minutes / 60);
  const restMinutes = minutes % 60;

  if (hours < 24) {
    return restMinutes ? `${hours}h ${restMinutes}m` : `${hours}h`;
  }

  const days = Math.floor(hours / 24);
  const restHours = hours % 24;
  return restHours ? `${days}d ${restHours}h` : `${days}d`;
}

/**
 * How a stop between two legs should be described.
 *
 * The distinction is what the stop *is*, not just how long it lasts:
 * under ten minutes you never really stopped, under a day you're
 * waiting for a connection, over a day you're staying somewhere and
 * it's counted in nights. Three different things to do with an
 * afternoon, and `interludes.ts` writes a different line for each.
 */
export type StopKind = "straight-through" | "connection" | "stay";

export interface DescribedStop {
  /** Names the city: for when this is the only thing on the line. */
  headline: string;
  /** Doesn't: for when something above it already said where. */
  short: string;
  kind: StopKind;
}

export function describeStop(
  arrival: string,
  departure: string,
  place: Place,
): DescribedStop {
  const ms = toMillis(departure) - toMillis(arrival);

  // A transfer added to fill a gap starts the moment you land, so this
  // stop is genuinely zero-length. "0m in Lisbon" is arithmetically
  // right and reads like a bug; say what it means instead.
  if (ms < STRAIGHT_THROUGH_MS) {
    return {
      headline: `Straight through ${place.city}`,
      short: "Straight through",
      kind: "straight-through",
    };
  }

  if (ms < DAY_MS) {
    return {
      headline: `${formatDuration(ms)} in ${place.city}`,
      short: formatDuration(ms),
      kind: "connection",
    };
  }

  // Counted from the dates, not from the elapsed milliseconds: arrive
  // Friday 22:00 and leave Sunday 08:00 and you have slept there twice,
  // even though only 34 hours passed.
  const nights = Math.max(1, nightsBetween(arrival, departure));
  const counted = `${nights} ${nights === 1 ? "night" : "nights"}`;
  return {
    headline: `${counted} in ${place.city}`,
    short: counted,
    kind: "stay",
  };
}

/**
 * How many dots to draw on the connector for a given stop.
 *
 * Logarithmic, not linear: a three-week stay shouldn't produce a
 * connector the length of the panel, but a week should still read as
 * visibly longer than an afternoon.
 *
 * The floor is three rather than two because two dots aren't a run —
 * they read as a pair of specks beside the text, and the strip stops
 * looking like a path between two places, which is the entire point
 * of drawing it.
 */
export function dotCountForDuration(ms: number | undefined): number {
  // No dates yet. Sits mid-range so an undated trip's spine looks the
  // same width as a dated one's rather than visibly thinner — you
  // haven't decided how long you're staying, and the list shouldn't
  // imply you've decided on "briefly".
  if (ms === undefined) return 4;

  const hours = ms / HOUR_MS;
  return Math.max(3, Math.min(8, Math.round(2 + Math.log2(1 + hours))));
}
