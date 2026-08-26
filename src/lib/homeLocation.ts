// ============================================================
// Home location — guesses the trip's starting point from the
// browser's Geolocation API so the user doesn't have to type
// their own city on every new trip.
//
// WHY THIS FAILS MORE OFTEN THAN IT SUCCEEDS, AND WHY THAT'S FINE:
// geolocation requires a permission the user can (and often should)
// deny, doesn't exist in every context (insecure origins, some
// embedded browsers), and can simply time out on a bad signal. None
// of that is exceptional — it's the normal shape of "where is this
// person" on the web. So this module never throws: every failure
// mode resolves to a tagged outcome instead, and the caller (the
// origin-editing UI) decides what each one means for the user —
// "denied" wants a manual-entry prompt, "timeout" might warrant a
// retry button, "no-match" means we found *somewhere* but Nominatim
// couldn't name a city there (open ocean, sparse rural address).
//
// WHY A TAGGED RESULT INSTEAD OF `Place | undefined`: undefined alone
// can't distinguish "user said no" from "the network hiccuped," and
// the UI genuinely wants to react differently to those two cases.
// ============================================================

import type { Coordinates, Place } from "../model/trip";
import { coords } from "../model/trip";
import { toPlace, type NominatimResult } from "./placesApi";

/**
 * Give up on the browser's location fix after this long. Geolocation
 * can hang indefinitely on a bad GPS/Wi-Fi signal; a trip planner
 * would rather fall back to manual entry quickly than block on that.
 */
const POSITION_TIMEOUT_MS = 8_000;

export type HomeLocationResult =
  /** Got a fix and Nominatim could name a city there. */
  | { kind: "found"; place: Place }
  /** The user said no to the permission prompt. Ask them to type a city instead. */
  | { kind: "denied" }
  /** No usable geolocation at all: insecure context, no API, or the browser/OS has it switched off. */
  | { kind: "unavailable" }
  /** Took longer than `POSITION_TIMEOUT_MS` to get a fix. Worth letting the user retry. */
  | { kind: "timeout" }
  /** Got coordinates, but reverse geocoding found no city/country there (open ocean, sparse rural area). */
  | { kind: "no-match" }
  /** Something else went wrong (network down, Nominatim unreachable/non-200, etc). */
  | { kind: "error"; message: string };

/** Promise wrapper around the callback-based `getCurrentPosition`. */
function getCurrentPosition(options: PositionOptions): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(resolve, reject, options);
  });
}

/**
 * Reverse-geocode a coordinate pair to a `Place` via Nominatim's
 * `/reverse` endpoint, reusing the same address parsing `searchPlaces`
 * uses for forward lookups (see placesApi.ts's `toPlace` and its note
 * on Nominatim's usage policy — this is a single on-demand call, not
 * a poll, so it stays well within "occasional personal use").
 *
 * Returns `undefined` rather than throwing when the address at these
 * coordinates has no city/country, for the same reason `toPlace`
 * does: a result you can't use is not an error, just an empty one.
 */
export async function reverseGeocodePlace(location: Coordinates): Promise<Place | undefined> {
  const [lng, lat] = location;

  const url = new URL("https://nominatim.openstreetmap.org/reverse");
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("lat", String(lat));
  url.searchParams.set("lon", String(lng));
  url.searchParams.set("addressdetails", "1");

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Reverse geocode failed for ${lat},${lng} (${res.status})`);
  }

  const result: NominatimResult = await res.json();
  return toPlace(result, result.display_name ?? "Home");
}

/**
 * Guess the trip's origin from the browser's current location.
 *
 * Never throws and never fires the permission prompt just from being
 * imported — it only runs when called, so callers can gate it behind
 * an explicit "use my location" action rather than surprising the
 * user with a prompt on page load.
 */
export async function detectHomeLocation(): Promise<HomeLocationResult> {
  if (typeof navigator === "undefined" || !navigator.geolocation) {
    return { kind: "unavailable" };
  }

  let position: GeolocationPosition;
  try {
    position = await getCurrentPosition({
      enableHighAccuracy: false,
      timeout: POSITION_TIMEOUT_MS,
      maximumAge: 0,
    });
  } catch (err) {
    // GeolocationPositionError codes: 1 = PERMISSION_DENIED,
    // 2 = POSITION_UNAVAILABLE, 3 = TIMEOUT.
    const code = (err as GeolocationPositionError | undefined)?.code;
    if (code === 1) return { kind: "denied" };
    if (code === 3) return { kind: "timeout" };
    return { kind: "unavailable" };
  }

  // Geolocation hands back {latitude, longitude} — the opposite order
  // from this app's [lng, lat] `Coordinates`. Route it through
  // `coords()` immediately so nothing downstream has to guess.
  const location = coords(position.coords.longitude, position.coords.latitude);

  try {
    const place = await reverseGeocodePlace(location);
    return place ? { kind: "found", place } : { kind: "no-match" };
  } catch (err) {
    return { kind: "error", message: err instanceof Error ? err.message : String(err) };
  }
}
