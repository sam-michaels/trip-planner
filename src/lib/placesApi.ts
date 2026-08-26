// ============================================================
// Place lookup — resolves a search query or IATA code to a full
// `Place` (coords, city, country) instead of hand-typing them.
//
// WHY TWO SOURCES: a general geocoder (Nominatim/OpenStreetMap) is
// fine for cities, stations, and landmarks, but it's unreliable for
// small airports and doesn't guarantee an IATA match. Airports get
// looked up against OurAirports instead — a static, purpose-built
// dataset keyed by IATA code, which is exactly the identifier
// `Leg`/`Place` already use.
//
// OurAirports also answers a question the geocoder can't: given a
// city, which airport would you actually fly out of? `nearestAirports`
// sorts by distance and filters by the dataset's size classification,
// because "large_airport" is the best free stand-in for "has
// scheduled service" — nothing free lists actual routes. `hubs.ts`
// hand-corrects that heuristic where being wrong would hurt.
// ============================================================

import type { Coordinates, Place } from "../model/trip";
import { coords } from "../model/trip";
import { distanceKm } from "./geo";

// ---------- General places (Nominatim) ----------

/**
 * NOTE ON HEADERS: Nominatim's usage policy asks for an identifying
 * User-Agent or Referer. Browsers won't let JS set a custom
 * User-Agent and send the page's Referer automatically, which
 * satisfies the policy for normal, human-paced usage (this is how
 * most client-side Nominatim integrations work). If this ever moves
 * behind a server or grows beyond occasional personal use, proxy
 * these requests through a backend that sets a real User-Agent —
 * Nominatim will start blocking otherwise.
 */
export interface NominatimResult {
  place_id: number;
  lat: string;
  lon: string;
  display_name: string;
  name?: string;
  address?: {
    city?: string;
    town?: string;
    village?: string;
    municipality?: string;
    country_code?: string;
  };
}

/**
 * Convert one Nominatim hit to a `Place`, or `undefined` if it lacks
 * the city/country the model requires.
 *
 * WHY UNDEFINED RATHER THAN A THROW: a search for "Porto" returns a
 * mix of stations, neighbourhoods and administrative regions, and some
 * of those genuinely have no city. In a picker, a result you can't
 * select is worse than no result at all, so unconvertible hits are
 * dropped from the list rather than surfaced as errors.
 */
export function toPlace(result: NominatimResult, fallbackName: string): Place | undefined {
  const address = result.address ?? {};
  const city =
    address.city ?? address.town ?? address.village ?? address.municipality;
  const countryCode = address.country_code;

  if (!city || !countryCode) return undefined;

  return {
    id: `osm-${result.place_id}`,
    name: result.name || fallbackName,
    city,
    country: countryCode.toUpperCase(),
    coords: coords(parseFloat(result.lon), parseFloat(result.lat)),
  };
}

/**
 * Search for places matching a free-text query, best match first.
 *
 * WHY THIS EXISTS ALONGSIDE `fetchPlace`: an autocomplete needs to
 * show the user a choice. "Porto" could be the city, Campanhã station,
 * or São Bento station, and only the person planning the trip knows
 * which one they meant — guessing silently puts a leg endpoint in the
 * wrong place, which is exactly the kind of error that's invisible
 * until you look at the map.
 *
 * Callers are responsible for rate limiting: Nominatim's usage policy
 * allows roughly one request per second, so debounce keystrokes rather
 * than firing per character (see `PlacePicker`).
 */
export async function searchPlaces(
  query: string,
  limit = 6,
  signal?: AbortSignal,
): Promise<Place[]> {
  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("q", query);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("addressdetails", "1");
  url.searchParams.set("limit", String(limit));

  const res = await fetch(url, { signal });
  if (!res.ok) {
    throw new Error(`Place lookup failed for "${query}" (${res.status})`);
  }

  const results: NominatimResult[] = await res.json();
  return results
    .map((r) => toPlace(r, query))
    .filter((p): p is Place => p !== undefined);
}

/**
 * Resolve a free-text query ("Seville", "Porto Campanhã station") to
 * a single `Place` — the best match that has a usable city/country.
 * Throws if nothing usable matches.
 *
 * Asks for several results rather than one because Nominatim's top hit
 * is sometimes an administrative region with no city attached; taking
 * the first *convertible* result is more useful than failing on it.
 */
export async function fetchPlace(query: string): Promise<Place> {
  const [best] = await searchPlaces(query, 5);
  if (!best) {
    throw new Error(`No place found for "${query}"`);
  }
  return best;
}

// ---------- Airports (OurAirports, by IATA code) ----------

/**
 * OurAirports' `type` column, verbatim.
 *
 * WHY IT EARNS A TYPE: it is the only signal in any free dataset that
 * distinguishes an airport with scheduled service from a grass strip
 * or a hospital helipad. No open API will tell you whether flights
 * exist between two cities, so `large_airport` is the proxy the route
 * engine plans against. It is a proxy, not a fact — see `hubs.ts` for
 * the curated correction on the routes that matter most.
 */
export type AirportType =
  | "large_airport"
  | "medium_airport"
  | "small_airport"
  | "seaplane_base"
  | "heliport"
  | "balloonport"
  | "closed";

/**
 * The three types worth ranking against each other.
 *
 * Heliports, seaplane bases, balloonports and closed fields are
 * deliberately absent: they score nothing and are never returned by
 * `nearestAirports`. Splitting the type this way also means
 * `{ minType: "heliport" }` doesn't typecheck — a floor that isn't a
 * size has no sensible interpretation, and defaulting it to "anything"
 * would silently widen the search instead of narrowing it.
 */
export type AirportSize = Extract<
  AirportType,
  "small_airport" | "medium_airport" | "large_airport"
>;

const SIZE_RANK: Record<AirportSize, number> = {
  small_airport: 1,
  medium_airport: 2,
  large_airport: 3,
};

function sizeRank(type: AirportType): number {
  return SIZE_RANK[type as AirportSize] ?? 0;
}

interface AirportRow {
  name: string;
  municipality: string;
  isoCountry: string;
  type: AirportType;
  lat: number;
  lon: number;
}

const OUR_AIRPORTS_CSV_URL =
  "https://davidmegginson.github.io/ourairports-data/airports.csv";

/** Fetched and parsed once per session, then reused for every airport lookup. */
let airportsByIata: Promise<Map<string, AirportRow>> | undefined;

function loadAirports(): Promise<Map<string, AirportRow>> {
  if (!airportsByIata) {
    airportsByIata = fetch(OUR_AIRPORTS_CSV_URL)
      .then((res) => {
        if (!res.ok) {
          throw new Error(`Failed to load airport data (${res.status})`);
        }
        return res.text();
      })
      .then(parseAirportsCsv)
      // Caching a *rejected* promise would turn one dropped connection
      // into a session where no airport ever resolves again. Drop it so
      // the next lookup retries.
      .catch((err) => {
        airportsByIata = undefined;
        throw err;
      });
  }
  return airportsByIata;
}

/** One parsed CSV row as the `Place` the rest of the app speaks. */
function toAirportPlace(code: string, row: AirportRow): Place {
  return {
    id: `apt-${code.toLowerCase()}`,
    name: row.name,
    city: row.municipality,
    country: row.isoCountry,
    coords: coords(row.lon, row.lat),
    iata: code,
  };
}

/** Resolve an IATA code ("YYZ", "LIS") to a `Place`. Throws if unknown. */
export async function fetchAirport(iata: string): Promise<Place> {
  const code = iata.toUpperCase();
  const airports = await loadAirports();
  const row = airports.get(code);

  if (!row) {
    throw new Error(`No airport found for IATA code "${code}"`);
  }

  return toAirportPlace(code, row);
}

/**
 * Airports near a point, nearest first.
 *
 * WHY `minType` DEFAULTS TO `large_airport`: the question a route
 * engine is really asking is "where would I fly out of from here?",
 * and the literally-nearest airport to London, Ontario is a flying
 * club. Filtering by size is the closest free approximation of
 * "somewhere with scheduled service" available — see `AirportType`.
 * Widen it to `medium_airport` when the answer comes back empty or
 * absurdly far, which happens across sparse regions.
 *
 * Rows whose coordinates failed to parse are skipped rather than
 * sorted with a `NaN` distance, which would scatter them through the
 * results unpredictably.
 */
export async function nearestAirports(
  to: Coordinates,
  opts: { minType?: AirportSize; limit?: number } = {},
): Promise<Place[]> {
  const { minType = "large_airport", limit = 5 } = opts;
  const floor = SIZE_RANK[minType];
  const airports = await loadAirports();

  const candidates: { code: string; row: AirportRow; km: number }[] = [];

  for (const [code, row] of airports) {
    if (sizeRank(row.type) < floor) continue;
    if (Number.isNaN(row.lat) || Number.isNaN(row.lon)) continue;

    candidates.push({ code, row, km: distanceKm(to, coords(row.lon, row.lat)) });
  }

  return candidates
    .sort((a, b) => a.km - b.km)
    .slice(0, limit)
    .map(({ code, row }) => toAirportPlace(code, row));
}

/**
 * Minimal CSV parser handling OurAirports' quoted fields (names and
 * keywords routinely contain commas, e.g. "Toronto, Ontario").
 */
function parseAirportsCsv(csv: string): Map<string, AirportRow> {
  const rows = new Map<string, AirportRow>();
  const lines = csv.split("\n");
  const header = splitCsvLine(lines[0]);

  const nameIdx = header.indexOf("name");
  const typeIdx = header.indexOf("type");
  const latIdx = header.indexOf("latitude_deg");
  const lonIdx = header.indexOf("longitude_deg");
  const countryIdx = header.indexOf("iso_country");
  const municipalityIdx = header.indexOf("municipality");
  const iataIdx = header.indexOf("iata_code");

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;

    const fields = splitCsvLine(line);
    const iata = fields[iataIdx];
    if (!iata) continue;

    rows.set(iata.toUpperCase(), {
      name: fields[nameIdx],
      municipality: fields[municipalityIdx],
      isoCountry: fields[countryIdx],
      // Trusted as-is: an unrecognised value simply ranks as unusable
      // in `SIZE_RANK`, which is the right answer for a type we don't
      // know how to interpret.
      type: fields[typeIdx] as AirportType,
      lat: parseFloat(fields[latIdx]),
      lon: parseFloat(fields[lonIdx]),
    });
  }

  return rows;
}

function splitCsvLine(line: string): string[] {
  const fields: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (inQuotes) {
      if (char === '"' && line[i + 1] === '"') {
        field += '"';
        i++;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        field += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      fields.push(field);
      field = "";
    } else {
      field += char;
    }
  }
  fields.push(field);

  return fields;
}
