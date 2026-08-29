// ============================================================
// One text matcher, used by every place-shaped search in the app.
//
// WHY IT'S ITS OWN FILE: this predicate existed twice — privately
// inside `PlacePicker` (name/city/country/IATA over the trip's own
// places) and again inside `searchPopular` (name/city/country/hook
// over the curated set). Two copies of "does this place match what
// they typed" is how one search box quietly starts behaving
// differently from the one next to it: someone fixes case handling
// in one, or teaches one about IATA codes, and the other silently
// disagrees. There is only one sensible answer to the question, so
// there is one function.
//
// Deliberately not fuzzy and deliberately not ranked. Every caller
// is filtering a list it already holds in memory — the trip's own
// places, or forty curated rows — and a substring test is both
// enough and predictable. Ranking is the remote geocoder's job, and
// it already does it.
// ============================================================

import type { Place } from "../model/trip";
import { countryName } from "./countries";
import { distanceKm } from "./geo";

/**
 * Trimmed and lowercased, so callers all agree on what "empty" and
 * "same" mean. An untrimmed query is the reason " lisbon" matches
 * nothing in an otherwise working search box.
 */
export function normalizeQuery(query: string): string {
  return query.trim().toLowerCase();
}

/**
 * Does this place match a free-text query?
 *
 * `extraFields` is for text that belongs to the *entry* rather than
 * the place — the curated list's `hook` is the case that exists —
 * so typing "penguins" can find Cape Town. Callers with no such text
 * pass nothing.
 *
 * An empty query matches everything. Both callers want that (one
 * shows the whole trip, the other the whole curated list), and the
 * alternative is every caller repeating the same `!query ||` guard.
 */
export function placeMatches(
  place: Place,
  query: string,
  extraFields: readonly string[] = [],
): boolean {
  const q = normalizeQuery(query);
  if (!q) return true;

  // IATA is an exact code, not a word: "LIS" should find Lisbon
  // Airport, but a substring test would also make "IS" match it and
  // put an airport in the middle of a search for Israel.
  if (place.iata && place.iata.toLowerCase() === q) return true;

  // Both spellings of the country, because both are true of it and
  // only one of them is ever on screen: the cards say "Portugal",
  // and a search that then can't find "portugal" makes the card you
  // were just looking at vanish as you type its own subtitle.
  return [
    place.name,
    place.city,
    place.country,
    countryName(place.country),
    ...extraFields,
  ].some((field) => field?.toLowerCase().includes(q));
}

// ---------- Same-place matching ----------

/**
 * How close two references have to be before they're treated as the
 * same destination.
 *
 * WHY DISTANCE AND NOT ID: the ids in this app come from three
 * different namespaces — `pop-lisbon` from the curated list,
 * `osm-12345` from Nominatim, `apt-lis` from OurAirports — and none
 * of them can be compared to another. Nor can the names: the
 * geocoder says "Lisboa" where the curated list says "Lisbon", and
 * both are right. Coordinates are the one thing all three agree on.
 *
 * 20km covers a city and its close-in airport (Lisbon and LIS are
 * 7km apart, and they are one answer to "where are you going", not
 * two) while keeping cities that are genuinely separate destinations
 * separate — Amsterdam and Utrecht are 35km apart and nobody means
 * one when they say the other.
 *
 * That ceiling means the far-flung hubs don't merge: CDG is 25km
 * from Paris and Narita 60km from Tokyo, so a destination taken
 * from `fetchAirport("NRT")` sits alongside curated Tokyo rather
 * than folding into it. That's the fail-open direction — a
 * duplicate row you can see and ignore, rather than a city silently
 * missing from a list you're browsing.
 */
export const SAME_PLACE_KM = 20;

/** Two references that almost certainly mean the same destination. */
export function samePlace(a: Place, b: Place): boolean {
  if (a.id === b.id) return true;
  return distanceKm(a.coords, b.coords) <= SAME_PLACE_KM;
}

/**
 * Is this place already covered by one of `listed`?
 *
 * Used two ways: to badge a curated card that's already in the trip,
 * and to drop a geocoder hit that's a near-duplicate of a row already
 * on screen. Both are the same question.
 */
export function alreadyListed(place: Place, listed: readonly Place[]): boolean {
  return listed.some((other) => samePlace(place, other));
}
