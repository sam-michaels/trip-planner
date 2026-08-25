// ============================================================
// Currency lookup — resolves an ISO 3166-1 country code to the
// currency it uses, via the REST Countries API.
//
// WHY A NETWORK CALL AND NOT A BUNDLED TABLE: this app is used for
// PLANNING (good wifi assumed), not as an offline travel companion,
// so there's no reason to ship and maintain a static country→currency
// table that goes stale whenever a country redenominates. A live
// lookup is always current and needs zero upkeep.
// ============================================================

import type { CurrencyCode } from "./tripModel";

/** In-memory only — a planning session looks up the same country
 * (e.g. every leg/stay in Portugal) repeatedly. */
const cache = new Map<string, CurrencyCode>();

/**
 * Some countries legally use more than one currency (e.g. Cuba: CUP
 * and, historically, CUC). We return the first the API lists — good
 * enough for a default that the user can override — plus every code
 * found, so callers that care can offer a choice.
 */
export interface CurrencyLookup {
  primary: CurrencyCode;
  all: CurrencyCode[];
}

/**
 * Look up the currency (or currencies) a country uses.
 *
 * @param countryCode ISO 3166-1 alpha-2, e.g. "PT", "MA", "CA" — the
 * same code stored on `Place.country`.
 * @throws if the country code is unrecognized or the request fails.
 */
export async function fetchCurrencyForCountry(
  countryCode: string,
): Promise<CurrencyLookup> {
  const cached = cache.get(countryCode);
  if (cached) return { primary: cached, all: [cached] };

  const res = await fetch(
    `https://restcountries.com/v3.1/alpha/${encodeURIComponent(countryCode)}?fields=currencies`,
  );

  if (!res.ok) {
    throw new Error(
      `No currency data for country "${countryCode}" (${res.status})`,
    );
  }

  const body: { currencies?: Record<string, unknown> } = await res.json();
  const codes = Object.keys(body.currencies ?? {});

  if (codes.length === 0) {
    throw new Error(`Country "${countryCode}" has no listed currency`);
  }

  const validCodes = validateCurrencyCodes(codes);
  cache.set(countryCode, validCodes[0]);
  return { primary: validCodes[0], all: validCodes };
}

/**
 * Drop anything the runtime doesn't recognize as real ISO 4217 rather
 * than trusting the API response blindly — this is the actual
 * validation step `CurrencyCode` gave up doing at the type level.
 */
function validateCurrencyCodes(codes: string[]): CurrencyCode[] {
  const known = new Set(Intl.supportedValuesOf("currency"));
  const valid = codes.filter((c) => known.has(c));

  if (valid.length === 0) {
    throw new Error(
      `None of the currency codes [${codes.join(", ")}] are recognized ISO 4217 codes`,
    );
  }

  return valid;
}
