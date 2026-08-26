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
// ============================================================

import type { Place } from "../model/trip";
import { coords } from "../model/trip";

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
interface NominatimResult {
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
function toPlace(result: NominatimResult, fallbackName: string): Place | undefined {
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

interface AirportRow {
  name: string;
  municipality: string;
  isoCountry: string;
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
      .then(parseAirportsCsv);
  }
  return airportsByIata;
}

/** Resolve an IATA code ("YYZ", "LIS") to a `Place`. Throws if unknown. */
export async function fetchAirport(iata: string): Promise<Place> {
  const code = iata.toUpperCase();
  const airports = await loadAirports();
  const row = airports.get(code);

  if (!row) {
    throw new Error(`No airport found for IATA code "${code}"`);
  }

  return {
    id: `apt-${code.toLowerCase()}`,
    name: row.name,
    city: row.municipality,
    country: row.isoCountry,
    coords: coords(row.lon, row.lat),
    iata: code,
  };
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
