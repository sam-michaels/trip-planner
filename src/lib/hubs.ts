// ============================================================
// Curated intercontinental hubs.
//
// WHY A HAND-WRITTEN TABLE IN A CODEBASE THAT OTHERWISE FETCHES
// EVERYTHING: no free dataset says which airports actually have
// flights between two cities. OurAirports tells you where the
// runways are and how big they are — it says nothing about
// schedules. `nearestAirports()` in placesApi.ts uses the size as a
// proxy for "has real service", which is right most of the time and
// occasionally absurd: the nearest large_airport to a European city
// can be a cargo field or a military-turned-civil strip that no one
// has ever connected to Toronto.
//
// So the route engine gets a second, smaller source of truth: the
// airports a person planning a long-haul trip would genuinely change
// planes at. Being *incomplete* is fine — a miss just falls back to
// the nearest-large-airport heuristic. Being *wrong* is not, which is
// why this file is nothing but the data and the lookups over it.
//
// Presented as a text table rather than ~70 object literals for the
// same reason `geo.ts` stores its continent lists as strings: at this
// size, columns you can scan beat syntax you have to read. Coordinate
// columns are written lng-then-lat, matching `coords(lng, lat)` and
// GeoJSON — see the note on `Coordinates` in model/trip.ts for why
// that order is worth being pedantic about.
// ============================================================

import type { Coordinates, Place } from "../model/trip";
import { coords } from "../model/trip";
import { distanceKm } from "./geo";

/**
 * IATA | airport name | city | ISO 3166-1 alpha-2 | longitude | latitude
 *
 * Longitude is negative west of Greenwich; latitude is negative south
 * of the equator. Grouped by region purely so gaps in coverage are
 * visible when you scan it.
 */
const HUB_TABLE = `
  YYZ | Toronto Pearson International    | Toronto        | CA |  -79.6248 |  43.6777
  YUL | Montréal–Trudeau                 | Montreal       | CA |  -73.7408 |  45.4706
  YVR | Vancouver International          | Vancouver      | CA | -123.1815 |  49.1967
  YYC | Calgary International            | Calgary        | CA | -114.0106 |  51.1315
  JFK | John F. Kennedy International    | New York       | US |  -73.7781 |  40.6413
  EWR | Newark Liberty International     | Newark         | US |  -74.1745 |  40.6895
  BOS | Boston Logan International       | Boston         | US |  -71.0096 |  42.3656
  IAD | Washington Dulles International  | Washington     | US |  -77.4565 |  38.9531
  ORD | Chicago O'Hare International     | Chicago        | US |  -87.9073 |  41.9742
  ATL | Hartsfield–Jackson Atlanta       | Atlanta        | US |  -84.4277 |  33.6407
  MIA | Miami International              | Miami          | US |  -80.2870 |  25.7959
  DFW | Dallas/Fort Worth International  | Dallas         | US |  -97.0403 |  32.8998
  LAX | Los Angeles International        | Los Angeles    | US | -118.4085 |  33.9416
  SFO | San Francisco International      | San Francisco  | US | -122.3790 |  37.6213
  SEA | Seattle–Tacoma International     | Seattle        | US | -122.3088 |  47.4502
  MEX | Mexico City International        | Mexico City    | MX |  -99.0719 |  19.4361

  LHR | London Heathrow                  | London         | GB |   -0.4543 |  51.4700
  LGW | London Gatwick                   | London         | GB |   -0.1821 |  51.1537
  DUB | Dublin Airport                   | Dublin         | IE |   -6.2701 |  53.4213
  CDG | Paris Charles de Gaulle          | Paris          | FR |    2.5479 |  49.0097
  BRU | Brussels Airport                 | Brussels       | BE |    4.4844 |  50.9014
  AMS | Amsterdam Schiphol               | Amsterdam      | NL |    4.7683 |  52.3105
  FRA | Frankfurt Airport                | Frankfurt      | DE |    8.5622 |  50.0379
  MUC | Munich Airport                   | Munich         | DE |   11.7861 |  48.3538
  ZRH | Zurich Airport                   | Zurich         | CH |    8.5492 |  47.4647
  VIE | Vienna International             | Vienna         | AT |   16.5697 |  48.1103
  FCO | Rome Fiumicino                   | Rome           | IT |   12.2389 |  41.8003
  MXP | Milan Malpensa                   | Milan          | IT |    8.7281 |  45.6306
  ATH | Athens International             | Athens         | GR |   23.9445 |  37.9364
  MAD | Madrid Barajas                   | Madrid         | ES |   -3.5626 |  40.4719
  BCN | Barcelona El Prat                | Barcelona      | ES |    2.0833 |  41.2974
  SVQ | Seville Airport                  | Seville        | ES |   -5.8931 |  37.4180
  LIS | Humberto Delgado Airport         | Lisbon         | PT |   -9.1359 |  38.7813
  OPO | Francisco Sá Carneiro Airport    | Porto          | PT |   -8.6814 |  41.2481
  FAO | Faro Airport                     | Faro           | PT |   -7.9659 |  37.0144
  CPH | Copenhagen Kastrup               | Copenhagen     | DK |   12.6508 |  55.6180
  ARN | Stockholm Arlanda                | Stockholm      | SE |   17.9186 |  59.6519
  OSL | Oslo Gardermoen                  | Oslo           | NO |   11.1004 |  60.1939
  HEL | Helsinki-Vantaa                  | Helsinki       | FI |   24.9633 |  60.3172
  KEF | Keflavík International           | Reykjavik      | IS |  -22.6056 |  63.9850

  CMN | Mohammed V International         | Casablanca     | MA |   -7.5898 |  33.3675
  RAK | Marrakesh Menara                 | Marrakesh      | MA |   -8.0363 |  31.6069
  TNG | Tangier Ibn Battouta             | Tangier        | MA |   -5.9169 |  35.7269
  CAI | Cairo International              | Cairo          | EG |   31.4056 |  30.1219
  LOS | Murtala Muhammed International   | Lagos          | NG |    3.3212 |   6.5774
  ADD | Addis Ababa Bole International    | Addis Ababa    | ET |   38.7993 |   8.9779
  NBO | Jomo Kenyatta International      | Nairobi        | KE |   36.9278 |  -1.3192
  JNB | O. R. Tambo International        | Johannesburg   | ZA |   28.2411 | -26.1367
  CPT | Cape Town International          | Cape Town      | ZA |   18.6021 | -33.9715

  IST | Istanbul Airport                 | Istanbul       | TR |   28.7519 |  41.2753
  TLV | Ben Gurion Airport               | Tel Aviv       | IL |   34.8867 |  32.0114
  DXB | Dubai International              | Dubai          | AE |   55.3657 |  25.2532
  DOH | Hamad International              | Doha           | QA |   51.6080 |  25.2731
  DEL | Indira Gandhi International      | Delhi          | IN |   77.1000 |  28.5562
  BOM | Chhatrapati Shivaji Maharaj      | Mumbai         | IN |   72.8656 |  19.0896
  BKK | Suvarnabhumi Airport             | Bangkok        | TH |  100.7501 |  13.6900
  SIN | Singapore Changi                 | Singapore      | SG |  103.9915 |   1.3644
  HKG | Hong Kong International          | Hong Kong      | HK |  113.9185 |  22.3080
  PVG | Shanghai Pudong International    | Shanghai       | CN |  121.8083 |  31.1443
  PEK | Beijing Capital International    | Beijing        | CN |  116.6031 |  40.0799
  ICN | Incheon International            | Seoul          | KR |  126.4407 |  37.4602
  NRT | Tokyo Narita                     | Tokyo          | JP |  140.3929 |  35.7720
  HND | Tokyo Haneda                     | Tokyo          | JP |  139.7798 |  35.5494

  SYD | Sydney Kingsford Smith           | Sydney         | AU |  151.1753 | -33.9399
  MEL | Melbourne Airport                | Melbourne      | AU |  144.8410 | -37.6690
  AKL | Auckland Airport                 | Auckland       | NZ |  174.7850 | -37.0082

  GRU | São Paulo Guarulhos              | Sao Paulo      | BR |  -46.4731 | -23.4356
  EZE | Buenos Aires Ezeiza              | Buenos Aires   | AR |  -58.5358 | -34.8222
  SCL | Santiago Arturo Merino Benítez   | Santiago       | CL |  -70.7858 | -33.3930
  LIM | Jorge Chávez International       | Lima           | PE |  -77.1143 | -12.0219
  BOG | El Dorado International          | Bogota         | CO |  -74.1469 |   4.7016
`;

/** A `Place` that is definitely an airport — `iata` is optional on `Place`. */
export type Hub = Place & { iata: string };

function parseHubTable(table: string): Hub[] {
  return table
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      const [iata, name, city, country, lng, lat] = line
        .split("|")
        .map((field) => field.trim());

      // Throwing at module load looks harsh for a typo, but it is the
      // whole point: a dropped `|` yields `Number(undefined)` — NaN —
      // and a NaN distance neither sorts nor compares, so the hub would
      // just quietly vanish from routing, or worse, sort to the front.
      // This is static data, so any failure here happens on the first
      // page load a developer does, never to someone planning a trip.
      const [lngDeg, latDeg] = [Number(lng), Number(lat)];
      if (
        !/^[A-Z]{3}$/.test(iata ?? "") ||
        !/^[A-Z]{2}$/.test(country ?? "") ||
        !name ||
        !city ||
        !Number.isFinite(lngDeg) ||
        !Number.isFinite(latDeg) ||
        Math.abs(lngDeg) > 180 ||
        Math.abs(latDeg) > 90
      ) {
        throw new Error(`Malformed hub row: "${line}"`);
      }

      return {
        // Same id shape `fetchAirport` produces, so the route engine can
        // dedupe a curated hub against a fetched one without a special case.
        id: `apt-${iata.toLowerCase()}`,
        name,
        city,
        country,
        coords: coords(lngDeg, latDeg),
        iata,
      };
    });
}

/** Every curated hub, in table order. */
export const HUBS: readonly Hub[] = parseHubTable(HUB_TABLE);

const HUBS_BY_IATA = new Map(HUBS.map((hub) => [hub.iata, hub]));

/** Whether an IATA code is one of the curated hubs. Case-insensitive. */
export function isHub(iata: string): boolean {
  return HUBS_BY_IATA.has(iata.toUpperCase());
}

/** The curated hub for an IATA code, or `undefined` if it isn't one. */
export function hubByIata(iata: string): Hub | undefined {
  return HUBS_BY_IATA.get(iata.toUpperCase());
}

/**
 * The curated hub closest to a point, by great-circle distance.
 *
 * `withinKm` is the interesting argument: without it this always
 * returns something, and "nearest hub to Reykjavik" happily answers
 * with an airport on another continent. A caller deciding *whether* to
 * route through a hub should pass a radius it would actually travel to
 * reach — beyond that, falling back to `nearestAirports()` gives a
 * closer and more honest answer.
 */
export function nearestHub(
  to: Coordinates,
  withinKm = Infinity,
): Hub | undefined {
  let best: Hub | undefined;
  let bestKm = Infinity;

  for (const hub of HUBS) {
    const km = distanceKm(to, hub.coords);
    if (km < bestKm && km <= withinKm) {
      best = hub;
      bestKm = km;
    }
  }

  return best;
}

/** Curated hubs sorted by distance from a point, nearest first. */
export function nearestHubs(to: Coordinates, limit = 3): Hub[] {
  return HUBS.map((hub) => ({ hub, km: distanceKm(to, hub.coords) }))
    .sort((a, b) => a.km - b.km)
    .slice(0, limit)
    .map((entry) => entry.hub);
}
