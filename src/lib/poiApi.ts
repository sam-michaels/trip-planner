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

const STAY_TAGS: Record<string, StayType> = {
  hotel: "hotel",
  hostel: "hostel",
  guest_house: "hotel",
};

/**
 * Nearest-first, deduplicated by place id, capped at `MAX_SUGGESTIONS`.
 * Shared by both converters so "closest hotel" and "closest museum"
 * mean the same thing everywhere in the app.
 */
function rank<T extends { place: Place }>(items: T[], from: Coordinates): T[] {
  const seen = new Set<string>();
  const deduped = items.filter((item) => {
    if (seen.has(item.place.id)) return false;
    seen.add(item.place.id);
    return true;
  });

  return deduped
    .sort((a, b) => distanceKm(from, a.place.coords) - distanceKm(from, b.place.coords))
    .slice(0, MAX_SUGGESTIONS);
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

    const type = STAY_TAGS[tags.tourism ?? ""];
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
      signal: signal ?? AbortSignal.timeout(OVERPASS_TIMEOUT_MS),
    });
    if (!res.ok) return [];

    const body: OverpassResponse = await res.json();
    return body.elements ?? [];
  } catch {
    return [];
  }
}

const STAY_TAG_FILTER = `["tourism"~"^(hotel|hostel|guest_house)$"]`;

/**
 * Hotels/hostels/guest houses near a city, nearest first.
 *
 * `nearStation`'s 800m-around-a-station search is two queries rather
 * than one nested Overpass expression: Overpass *can* express "around
 * a set of nodes matching another query" in one request, but it reads
 * like line noise next to fetch-stations-then-fetch-lodging, which
 * says exactly what it does.
 */
export async function nearbyStays(
  city: Place,
  opts: { nearStation?: boolean; signal?: AbortSignal } = {},
): Promise<StaySuggestion[]> {
  const [lng, lat] = city.coords;

  if (opts.nearStation) {
    const stationQuery = `[out:json];node["railway"="station"](around:5000,${lat},${lng});out center;`;
    const stations = await runOverpassQuery(stationQuery, opts.signal);

    const stationPoints = stations
      .map(elementLatLon)
      .filter((p): p is { lat: number; lon: number } => p !== undefined);
    if (stationPoints.length === 0) return [];

    const around = stationPoints
      .map(
        (p) =>
          `node${STAY_TAG_FILTER}(around:800,${p.lat},${p.lon});` +
          `way${STAY_TAG_FILTER}(around:800,${p.lat},${p.lon});`,
      )
      .join("");
    const elements = await runOverpassQuery(`[out:json];(${around});out center;`, opts.signal);
    return toStaySuggestions(elements, city);
  }

  const query =
    `[out:json];(node${STAY_TAG_FILTER}(around:2000,${lat},${lng});` +
    `way${STAY_TAG_FILTER}(around:2000,${lat},${lng}););out center;`;
  const elements = await runOverpassQuery(query, opts.signal);
  return toStaySuggestions(elements, city);
}

// ponytail: Overpass stands in for OpenTripMap here, which is the
// source `Activity.source` already names ("opentripmap") — OpenTripMap
// needs an API key this project has never provisioned, and Overpass
// answers the same "what's nearby" question for free. Upgrade path if
// OSM's attraction/museum tagging proves too thin: add OpenTripMap as
// a second source behind this same `ActivitySuggestion` shape and
// merge/dedupe the two lists, same idea as placesApi.ts running two
// place sources behind one `Place`.
const ACTIVITY_TAG_FILTERS = [
  `["tourism"="museum"]`,
  `["tourism"="attraction"]`,
  `["tourism"="viewpoint"]`,
  `["tourism"="artwork"]`,
  `["historic"]`,
  `["amenity"="restaurant"]`,
  `["amenity"="cafe"]`,
  `["leisure"="park"]`,
  `["natural"]`,
];

/**
 * Sights/food/museums/outdoors near a city, nearest first.
 *
 * `radiusKm` defaults to 5 (walkable-city scale); a caller planning a
 * day trip passes something in the 30-120 range instead.
 */
export async function nearbyActivities(
  city: Place,
  opts: { radiusKm?: number; signal?: AbortSignal } = {},
): Promise<ActivitySuggestion[]> {
  const radiusM = Math.round((opts.radiusKm ?? 5) * 1000);
  const [lng, lat] = city.coords;

  const clauses = ACTIVITY_TAG_FILTERS.flatMap((filter) => [
    `node${filter}(around:${radiusM},${lat},${lng});`,
    `way${filter}(around:${radiusM},${lat},${lng});`,
  ]).join("");

  const elements = await runOverpassQuery(`[out:json];(${clauses});out center;`, opts.signal);
  return toActivitySuggestions(elements, city);
}
