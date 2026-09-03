// ============================================================
// POI lookup — Overpass API (OpenStreetMap) for "what's near here"
// suggestions: hotels/hostels for a Stay, sights/food/museums for
// an Activity.
//
// WHY OVERPASS: free, no API key, and it's the same OpenStreetMap
// data Nominatim (placesApi.ts) already resolves places against —
// one mental model for "where things are" across this codebase.
// The tradeoff is tag quality: OSM contributors tag POIs
// inconsistently, so an unnamed or oddly-tagged element is common
// and gets dropped rather than guessed at (same reasoning as
// `toPlace` returning `undefined` for an address with no city).
//
// SHAPE MIRRORS placesApi.ts ON PURPOSE: a pure `toXSuggestions`
// converter that only touches already-parsed JSON (so it's testable
// with hand-written fixtures and never touches the network), plus a
// thin `fetch` wrapper around it that's short enough not to need its
// own test.
// ============================================================

import type { ActivityCategory, Coordinates, Place, StayType } from "../model/trip";
import { coords } from "../model/trip";
import { distanceKm } from "./geo";

const OVERPASS_URL = "https://overpass-api.de/api/interpreter";

/** Matches the 8-10s the rest of the app's network calls use. */
const OVERPASS_TIMEOUT_MS = 10_000;

/** A picker showing 20 hotels is already more than anyone reads top to bottom. */
const MAX_SUGGESTIONS = 20;

/** One Overpass element, narrowed to the fields we read. */
export interface OverpassElement {
  type: "node" | "way" | "relation";
  id: number;
  lat?: number;
  lon?: number; // nodes
  center?: { lat: number; lon: number }; // ways/relations, via `out center`
  tags?: Record<string, string>;
}

export interface StaySuggestion {
  place: Place;
  type: StayType;
}

export interface ActivitySuggestion {
  place: Place;
  category: ActivityCategory;
}

interface OverpassResponse {
  elements?: OverpassElement[];
}

/**
 * A node has its own lat/lon; a way or relation only gets one via
 * `out center` (see the query builders below). Neither is optional
 * on the type because Overpass genuinely omits both when a way's
 * geometry couldn't be resolved — treat that as "unusable" too.
 */
function elementLatLon(el: OverpassElement): { lat: number; lon: number } | undefined {
  if (el.lat !== undefined && el.lon !== undefined) return { lat: el.lat, lon: el.lon };
  return el.center;
}

/** Convert one Overpass element to a `Place`, given its already-resolved coords. */
function toPlace(el: OverpassElement, city: Place, at: { lat: number; lon: number }): Place {
  return {
    id: `osm-${el.type}-${el.id}`,
    name: el.tags!.name,
    // Inherited from the city we searched, never read off the element:
    // Overpass doesn't reliably tag city/country on individual POIs,
    // and inventing them would be a lie a Place isn't allowed to tell.
    city: city.city,
    country: city.country,
    coords: coords(at.lon, at.lat),
  };
}

/**
 * A `Map`, not an object literal, because the key is an untrusted OSM
 * tag value. `STAY_TAGS["constructor"]` on a plain object walks the
 * prototype and returns a truthy function, which sails past the
 * `if (!type) continue` guard and yields a suggestion whose `type` is
 * `Object` — a row with a blank chip. A `Map` has no prototype chain
 * to fall through to.
 */
const STAY_TAGS = new Map<string, StayType>([
  ["hotel", "hotel"],
  ["hostel", "hostel"],
  ["guest_house", "hotel"],
]);

/**
 * Nearest-first, deduplicated by place id, capped at `MAX_SUGGESTIONS`.
 * Shared by both converters so "closest hotel" and "closest museum"
 * mean the same thing everywhere in the app.
 */
function rank<T extends { place: Place }>(items: T[], from: Coordinates): T[] {
  const seen = new Set<string>();
  const measured: { item: T; km: number }[] = [];

  for (const item of items) {
    if (seen.has(item.place.id)) continue;
    seen.add(item.place.id);
    // Measured once each, up front, rather than inside the comparator —
    // a comparator runs O(n log n) times, so a haversine in there is
    // the same distance recomputed a dozen times per element.
    measured.push({ item, km: distanceKm(from, item.place.coords) });
  }

  return measured
    .sort((a, b) => a.km - b.km)
    .slice(0, MAX_SUGGESTIONS)
    .map((entry) => entry.item);
}

/**
 * Pure. Overpass JSON -> stay suggestions.
 *
 * Drops anything unnamed (not selectable in a picker), uncoordinated
 * (nothing to put on the map), or tagged with something other than
 * hotel/hostel/guest_house — `StayType` also has "airbnb", "friend"
 * and "overnight-transit", which are never OSM-sourced and have no
 * tag to map from.
 */
export function toStaySuggestions(elements: readonly OverpassElement[], city: Place): StaySuggestion[] {
  const suggestions: StaySuggestion[] = [];

  for (const el of elements) {
    const tags = el.tags;
    if (!tags?.name) continue;

    const type = STAY_TAGS.get(tags.tourism ?? "");
    if (!type) continue;

    const at = elementLatLon(el);
    if (!at) continue;

    suggestions.push({ place: toPlace(el, city, at), type });
  }

  return rank(suggestions, city.coords);
}

/** Same drop rule as `toStaySuggestions`, for the tag families below. */
function activityCategory(tags: Record<string, string>): ActivityCategory | undefined {
  if (tags.tourism === "museum") return "museum";
  if (
    tags.tourism === "attraction" ||
    tags.tourism === "viewpoint" ||
    tags.tourism === "artwork" ||
    tags.historic !== undefined
  ) {
    return "sight";
  }
  if (tags.amenity === "restaurant" || tags.amenity === "cafe") return "food";
  if (tags.leisure === "park" || tags.natural !== undefined) return "outdoor";
  return undefined;
}

/** Pure. Overpass JSON -> activity suggestions, same drop rule as `toStaySuggestions`. */
export function toActivitySuggestions(
  elements: readonly OverpassElement[],
  city: Place,
): ActivitySuggestion[] {
  const suggestions: ActivitySuggestion[] = [];

  for (const el of elements) {
    const tags = el.tags;
    if (!tags?.name) continue;

    const category = activityCategory(tags);
    if (!category) continue;

    const at = elementLatLon(el);
    if (!at) continue;

    suggestions.push({ place: toPlace(el, city, at), category });
  }

  return rank(suggestions, city.coords);
}

/**
 * POST one Overpass QL query and return its elements.
 *
 * WHY [] RATHER THAN A THROW on a bad response or unparsable body: an
 * empty suggestion list makes the onboarding step that called this
 * skip itself, which is a correct, honest outcome — "nothing found
 * nearby" happens for real, sparsely-mapped places. An exception
 * during onboarding is not a correct outcome; it would stop a
 * traveller from finishing a trip over a hotel-suggestion sidebar.
 */
async function runOverpassQuery(query: string, signal?: AbortSignal): Promise<OverpassElement[]> {
  try {
    const res = await fetch(OVERPASS_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `data=${encodeURIComponent(query)}`,
      // BOTH BOUNDS, NOT WHICHEVER ONE THE CALLER DIDN'T SUPPLY. This
      // was `signal ?? AbortSignal.timeout(…)`, and the only caller
      // always passes a signal — so the deadline never once applied and
      // a stalled Overpass connection left the step spinning forever.
      // A caller's signal says "I stopped caring"; the timeout says
      // "this is taking too long". Neither replaces the other.
      signal: AbortSignal.any([
        ...(signal ? [signal] : []),
        AbortSignal.timeout(OVERPASS_TIMEOUT_MS),
      ]),
    });
    if (!res.ok) return [];

    const body: OverpassResponse = await res.json();
    return body.elements ?? [];
  } catch {
    return [];
  }
}

/**
 * WHAT ACTUALLY MAKES THESE QUERIES SLOW, measured against Lisbon on
 * the public Overpass instance rather than reasoned about:
 *
 *   | shape                                   | time  | bytes |
 *   |-----------------------------------------|-------|-------|
 *   | 18 node/way clauses, 5km, bare `natural`| 7.1s  | 4.3MB |
 *   | 4 `nwr` clauses, name-filtered, 5km     | 20.8s | 276KB |
 *   | 11 `nwr` clauses, name-filtered, 2km    | timed out at 25s |
 *   | 6 node/way clauses, 2km, no name filter | 2.6s  | 183KB |
 *
 * THE COST IS IN THE LOOKUPS, NOT THE BYTES, which is the opposite of
 * what it looks like. Two consequences, both counter-intuitive enough
 * to be worth writing down before someone "improves" them back:
 *
 *   * `nwr` is NOT a cheaper way to write `node…;way…;`. It is
 *     node + way + RELATION — half again as many index lookups per
 *     clause. Collapsing four clause-pairs into four `nwr` clauses
 *     made the query three times slower while making the response
 *     fifteen times smaller.
 *   * `["name"]` is a bare-key filter and costs server time to apply.
 *     It is also nearly free to skip: of 300 elements the narrow tag
 *     filters returned, 278 were already named. Let the converters
 *     drop the other 22 after the fact.
 *
 * So: few clauses, small radius, exact-ish tags, filter on the client.
 *
 * `[timeout:25]` is not decoration either — the 11-clause attempt above
 * hit it, and without it that query would have held a connection open
 * until the browser gave up.
 */
const OVERPASS_PREAMBLE = `[out:json][timeout:25];`;

/**
 * The cap DOES bite in a dense city — Lisbon returns more than this
 * within 2km — so it is not the pure backstop it looks like. What the
 * step shows is therefore "twenty things worth doing near the centre",
 * not "the twenty provably nearest": Overpass picks which 300 in its
 * own order and `rank()` sorts those. Everything in the set is within
 * a short walk of the middle of town, so the distinction costs the
 * traveller nothing, but it is a real one and raising the cap to erase
 * it costs seconds.
 */
const OVERPASS_OUT = `out center 300;`;

/** Nodes and ways, no relations — see the lookup-cost note above. */
function around(filter: string, radiusM: number, lat: number, lng: number): string {
  return (
    `node${filter}(around:${radiusM},${lat},${lng});` +
    `way${filter}(around:${radiusM},${lat},${lng});`
  );
}

const STAY_FILTER = `["tourism"~"^(hotel|hostel|guest_house)$"]`;

/**
 * Hotels, hostels and guest houses near a city centre, nearest first.
 *
 * NO STATION FILTER, THOUGH THERE USED TO BE. The idea was lodging
 * within a 10-minute walk of a `railway=station`, and it cost a
 * separate uncapped station query plus two spatial subqueries per
 * station returned — in a city where the metro stops all carry that
 * tag, several hundred subqueries and up to three round trips. It also
 * bought nothing: `rank()` sorts by distance from the city centre, so
 * the filter's only effect was excluding outlying hotels that
 * centre-ranking drops from the top twenty regardless.
 */
export function nearbyStays(
  city: Place,
  opts: { signal?: AbortSignal } = {},
): Promise<StaySuggestion[]> {
  const [lng, lat] = city.coords;
  const query = `${OVERPASS_PREAMBLE}(${around(STAY_FILTER, 2000, lat, lng)});${OVERPASS_OUT}`;

  return runOverpassQuery(query, opts.signal).then((elements) =>
    toStaySuggestions(elements, city),
  );
}

// ponytail: Overpass stands in for OpenTripMap here, which is the
// source `Activity.source` already names ("opentripmap") — OpenTripMap
// needs an API key this project has never provisioned, and Overpass
// answers the same "what's nearby" question for free. Upgrade path if
// OSM's attraction/museum tagging proves too thin: add OpenTripMap as
// a second source behind this same `ActivitySuggestion` shape and
// merge/dedupe the two lists, same idea as placesApi.ts running two
// place sources behind one `Place`.
/**
 * NARROW ON PURPOSE, AND THE NARROWNESS IS THE PERFORMANCE FIX. This
 * was nine filters, two of them bare-key: `["natural"]` matches
 * `natural=tree`, which is tens of thousands of nodes in a European
 * city and forces geometry resolution on every wooded way; `["historic"]`
 * added thousands more. All of it downloaded, then discarded by
 * `activityCategory` and the unnamed check.
 *
 * NO RESTAURANTS OR CAFÉS, DELIBERATELY. `amenity=restaurant|cafe` is
 * thousands per city centre — enough to swamp the twenty rows the step
 * shows, so the list would stop being "what would you do here" and
 * become "here is a map of lunch". `activityCategory` still maps the
 * `food` category, because the converter's job is to read whatever it
 * is handed; this is the query declining to ask for it.
 */
/**
 * THREE FILTERS, WHICH IS THE PERFORMANCE FIX. This was nine, expanded
 * to eighteen clauses at 5km. `["natural"]` is gone entirely: it
 * matches `natural=tree`, and a European city has tens of thousands of
 * those — most of the 14,990 elements and 4.3MB the old query returned
 * to show twenty rows. `["historic"]` stays a bare key, which looks
 * like the same mistake and isn't: bounded to 2km it is a few hundred,
 * and narrowing it to a value list measurably cost more than it saved
 * (see the table above — regex filters don't use the tag index).
 *
 * NO RESTAURANTS OR CAFÉS, DELIBERATELY. `amenity=restaurant|cafe` is
 * thousands per city centre — enough to swamp the twenty rows the step
 * shows, so the list would stop being "what would you do here" and
 * become "here is a map of lunch". `activityCategory` still maps the
 * `food` category, because the converter's job is to read whatever it
 * is handed; this is the query declining to ask for it.
 */
const ACTIVITY_FILTERS = [
  `["tourism"~"^(museum|attraction|viewpoint|artwork)$"]`,
  `["historic"]`,
  `["leisure"="park"]`,
];

/**
 * Sights, museums and outdoors near a city, nearest first.
 *
 * `radiusKm` defaults to 2 — the walkable core, and the radius the
 * measurements above were taken at. It was 5, which is most of a city
 * and was a large part of why this took seven seconds. A caller
 * planning a day trip passes something in the 30-120 range instead,
 * and should expect it to be slower for the same reason.
 */
export function nearbyActivities(
  city: Place,
  opts: { radiusKm?: number; signal?: AbortSignal } = {},
): Promise<ActivitySuggestion[]> {
  const radiusM = Math.round((opts.radiusKm ?? 2) * 1000);
  const [lng, lat] = city.coords;

  const clauses = ACTIVITY_FILTERS.map((filter) =>
    around(filter, radiusM, lat, lng),
  ).join("");

  const query = `${OVERPASS_PREAMBLE}(${clauses});${OVERPASS_OUT}`;
  return runOverpassQuery(query, opts.signal).then((elements) =>
    toActivitySuggestions(elements, city),
  );
}
