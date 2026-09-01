// ============================================================
// Geographic arithmetic that isn't about drawing.
//
// `map/geometry.ts` turns legs into GeoJSON; this is the plain
// measurement underneath — how far apart two places are, and which
// landmass each sits on. Both feed decisions the UI makes about a
// leg (which transport modes are even possible) rather than how it
// looks.
// ============================================================

import type { Coordinates } from "../model/trip";

const EARTH_RADIUS_KM = 6371;

const toRadians = (degrees: number) => (degrees * Math.PI) / 180;

/**
 * Great-circle distance between two points, in kilometres.
 *
 * Haversine rather than a library call: it's six lines, has no edge
 * cases at this scale, and adding a dependency for it would be hard
 * to justify against the README's "one at a time, with a reason" rule.
 */
export function distanceKm(a: Coordinates, b: Coordinates): number {
  const [lngA, latA] = a;
  const [lngB, latB] = b;

  const dLat = toRadians(latB - latA);
  const dLng = toRadians(lngB - lngA);

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(latA)) *
      Math.cos(toRadians(latB)) *
      Math.sin(dLng / 2) ** 2;

  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h));
}

/**
 * Initial bearing from `a` to `b`, in degrees clockwise from north.
 *
 * "Initial" is the part that matters: on a sphere the bearing of a
 * great-circle route changes as you fly it — a flight from London to
 * Seattle leaves on roughly 330 and arrives on roughly 250. So this is
 * only meaningful for a short segment, which is exactly how the map
 * uses it: the heading of the one polyline segment a vehicle is
 * currently crossing, not the heading of the whole leg.
 */
export function bearingDegrees(a: Coordinates, b: Coordinates): number {
  const [lngA, latA] = a;
  const [lngB, latB] = b;

  const phiA = toRadians(latA);
  const phiB = toRadians(latB);
  const dLng = toRadians(lngB - lngA);

  const y = Math.sin(dLng) * Math.cos(phiB);
  const x =
    Math.cos(phiA) * Math.sin(phiB) -
    Math.sin(phiA) * Math.cos(phiB) * Math.cos(dLng);

  // atan2 returns -PI..PI; the +360 % 360 folds that onto a compass.
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

// ---------- Continents ----------

export type Continent =
  | "africa"
  | "asia"
  | "europe"
  | "north-america"
  | "south-america"
  | "oceania";

/**
 * ISO 3166-1 alpha-2 codes grouped by continent.
 *
 * WHY THIS TABLE EXISTS AT ALL: the only question it answers is
 * "could you get there overland?", which is what decides whether a
 * leg may sensibly be a train or must be a flight. Distance alone
 * can't answer it — Toronto to Lisbon and Cairo to Cape Town are
 * both about 5,700km, but one of them has an ocean in the way.
 *
 * Stored as space-separated strings purely so the table stays
 * readable as data rather than sprawling over 250 lines.
 */
const CONTINENT_MEMBERS: Record<Continent, string> = {
  africa:
    "DZ AO BJ BW BF BI CV CM CF TD KM CD CG CI DJ EG GQ ER SZ ET GA GM GH GN GW KE LS LR LY MG MW ML MR MU YT MA MZ NA NE NG RE RW SH ST SN SC SL SO ZA SS SD TZ TG TN UG EH ZM ZW",
  asia:
    "AF AM AZ BH BD BT BN KH CN CY GE HK IN ID IR IQ IL JP JO KZ KP KR KW KG LA LB MO MY MV MN MM NP OM PK PS PH QA SA SG LK SY TW TJ TH TL TR TM AE UZ VN YE",
  europe:
    "AL AD AT BY BE BA BG HR CZ DK EE FO FI FR DE GI GR GG HU IS IE IM IT JE LV LI LT LU MT MD MC ME NL MK NO PL PT RO RU SM RS SK SI ES SJ SE CH UA GB VA AX",
  "north-america":
    "AI AG AW BS BB BZ BM BQ VG CA KY CR CU CW DM DO SV GL GD GP GT HT HN JM MQ MX MS NI PA PR BL KN LC MF PM VC SX TT TC US VI",
  "south-america": "AR BO BR CL CO EC FK GF GY PY PE SR UY VE",
  oceania:
    "AS AU CK FJ PF GU KI MH FM NR NC NZ NU NF MP PW PG PN WS SB TK TO TV VU WF",
};

const CONTINENT_BY_COUNTRY = new Map<string, Continent>(
  Object.entries(CONTINENT_MEMBERS).flatMap(([continent, codes]) =>
    codes.split(" ").map((code) => [code, continent as Continent] as const),
  ),
);

export function continentOf(countryCode: string): Continent | undefined {
  return CONTINENT_BY_COUNTRY.get(countryCode.toUpperCase());
}

/**
 * Continent pairs you can cross without a boat or a plane.
 *
 * Europe and Africa are deliberately absent: the Strait of Gibraltar
 * is 14km of water, which is exactly why the Algeciras–Tanger ferry
 * exists and matters to this trip.
 */
const LAND_BRIDGES: ReadonlySet<string> = new Set([
  "europe|asia",
  "asia|africa",
  "north-america|south-america",
]);

/** Whether an overland route between two countries is even conceivable. */
export function isLandConnected(countryA: string, countryB: string): boolean {
  const a = continentOf(countryA);
  const b = continentOf(countryB);

  // An unknown country code shouldn't silently rule out every ground
  // mode — better to offer too much than to block a real plan.
  if (!a || !b) return true;
  if (a === b) return true;

  return LAND_BRIDGES.has([a, b].sort().join("|"));
}
