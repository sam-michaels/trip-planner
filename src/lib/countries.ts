// ============================================================
// "PT" → "Portugal".
//
// The model stores ISO 3166-1 alpha-2 because that's what every
// data source speaks — Nominatim, OurAirports, the curated list.
// It is not what anyone recognises on a card they're browsing for
// fun, and "MA" in particular reads as a US state.
//
// WHY NOT A LOOKUP TABLE: `Intl` already ships the full list, in
// the reader's own language, in every browser. Hand-maintaining 250
// rows here would be strictly worse and permanently out of date.
//
// It lives in lib/ rather than beside the other labels because the
// SEARCH needs it too: whatever a row displays is what someone will
// type at it, so `placeSearch` has to match on the expanded name as
// well as the code (see `placeMatches`), and lib must not import
// from the UI.
// ============================================================

/**
 * Built once, not per call. `Intl` constructors are among the most
 * expensive calls in the engine, and the inspiration grid asks for
 * eighty country names every time it renders.
 */
let displayNames: Intl.DisplayNames | undefined;

/** Memoised per code, for the same reason. Bounded by ~250 codes. */
const cache = new Map<string, string>();

/**
 * The country's name in the reader's language.
 *
 * Falls back to the code itself: an unrecognised or malformed code
 * should show *something* rather than blank out the line it's on.
 */
export function countryName(code: string): string {
  const key = code.toUpperCase();

  const hit = cache.get(key);
  if (hit !== undefined) return hit;

  let name = key;
  try {
    displayNames ??= new Intl.DisplayNames(undefined, { type: "region" });
    name = displayNames.of(key) ?? key;
  } catch {
    // Intl throws on a malformed code, and `DisplayNames` itself is
    // absent in a few stripped-down runtimes. Neither is worth an
    // empty label.
  }

  cache.set(key, name);
  return name;
}
