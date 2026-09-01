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
// "denied" wants a manual-entry prompt, "timeout" and "no-fix" might
// warrant a retry button, "no-match" means we found *somewhere* but
// Nominatim couldn't name a city there (open ocean, sparse rural
// address).
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

/**
 * Give up on the reverse-geocode network call after this long. A fetch
 * with no `AbortSignal` can hang forever if the host stalls without
 * ever erroring — the whole point of bounding the geolocation step
 * above is defeated if this step is left to hang instead.
 */
const GEOCODE_TIMEOUT_MS = 8_000;

/**
 * Every kind below is final EXCEPT where noted "retryable" — that's
 * the signal Unit 8's UI needs to decide between offering a "try
 * again" button and going straight to manual entry. Documented here,
 * precisely, because that UI consumes this contract without being
 * able to ask.
 */
export type HomeLocationResult =
  /** Got a fix and Nominatim could name a city there. */
  | { kind: "found"; place: Place }
  /** The user said no to the permission prompt. NOT retryable without a browser settings change — ask them to type a city instead. */
  | { kind: "denied" }
  /** No usable geolocation at all: insecure context, no API, or the browser/OS has it switched off entirely. NOT retryable — go straight to manual entry. */
  | { kind: "unavailable" }
  /** The device couldn't get a position fix this time (weak GPS/Wi-Fi signal, e.g. indoors). RETRYABLE — trying again, or moving near a window, often works. */
  | { kind: "no-fix" }
  /** The position request or the reverse-geocode call took too long. RETRYABLE. */
  | { kind: "timeout" }
  /** Got coordinates, but reverse geocoding found no city/country there (open ocean, sparse rural area). NOT retryable with the same coordinates. */
  | { kind: "no-match" }
  /** Something else went wrong (network down, Nominatim unreachable/non-200, etc). RETRYABLE at the caller's discretion. */
  | { kind: "error"; message: string };

/** Promise wrapper around the callback-based `getCurrentPosition`. */
function getCurrentPosition(options: PositionOptions): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(resolve, reject, options);
  });
}

/**
 * Best-effort human-readable message from an unknown thrown value.
 * `GeolocationPositionError` carries a `.message` but, unlike a
 * `fetch` rejection, isn't a subclass of `Error` — so `err.message`
 * alone would silently miss it.
 */
function describeError(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (err && typeof err === "object" && "message" in err && typeof err.message === "string") {
    return err.message;
  }
  return "Unknown error";
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
 *
 * Takes an optional `AbortSignal`, the same shape `searchPlaces` uses,
 * so callers can bound or cancel the request rather than risk a hang
 * on a stalled connection (see `detectHomeLocation`, which applies its
 * own deadline via `AbortSignal.timeout`).
 */
export async function reverseGeocodePlace(
  location: Coordinates,
  signal?: AbortSignal,
): Promise<Place | undefined> {
  const [lng, lat] = location;

  const url = new URL("https://nominatim.openstreetmap.org/reverse");
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("lat", String(lat));
  url.searchParams.set("lon", String(lng));
  url.searchParams.set("addressdetails", "1");
  // CITY LEVEL, NOT BUILDING LEVEL — the one line that keeps this from
  // being a privacy problem. Nominatim's `/reverse` defaults to zoom 18,
  // which resolves to the actual building you are standing in and hands
  // back ITS lat/lon; `toPlace` would then store that street-level point
  // as `trip.origin.coords` and the map would draw a line from your
  // front door. Zoom 10 resolves to the city, so what comes back — and
  // therefore all this app ever keeps — is the city's own coordinate.
  // The precise fix is used for this one request and never stored.
  url.searchParams.set("zoom", "10");

  const res = await fetch(url, { signal });
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
    // GeolocationPositionError codes: 1 = PERMISSION_DENIED (not
    // retryable), 2 = POSITION_UNAVAILABLE — a failed fix, typically
    // transient (retryable), 3 = TIMEOUT (retryable). Anything else
    // is unexpected rather than one of the three documented cases, so
    // it's reported as an error instead of guessed at.
    const code = (err as GeolocationPositionError | undefined)?.code;
    if (code === 1) return { kind: "denied" };
    if (code === 2) return { kind: "no-fix" };
    if (code === 3) return { kind: "timeout" };
    return { kind: "error", message: describeError(err) };
  }

  // Geolocation hands back {latitude, longitude} — the opposite order
  // from this app's [lng, lat] `Coordinates`. Route it through
  // `coords()` immediately so nothing downstream has to guess.
  const location = coords(position.coords.longitude, position.coords.latitude);

  try {
    const place = await reverseGeocodePlace(location, AbortSignal.timeout(GEOCODE_TIMEOUT_MS));
    return place ? { kind: "found", place } : { kind: "no-match" };
  } catch (err) {
    // AbortSignal.timeout() aborts with a DOMException named
    // "TimeoutError" (some runtimes surface "AbortError" instead) —
    // either way that's the geocode call taking too long, not a
    // hard failure, so it maps to the same retryable "timeout" as a
    // slow position fix rather than the catch-all "error".
    if (err instanceof DOMException && (err.name === "TimeoutError" || err.name === "AbortError")) {
      return { kind: "timeout" };
    }
    return { kind: "error", message: describeError(err) };
  }
}
