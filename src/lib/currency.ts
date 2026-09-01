// ============================================================
// Exchange rates — display-time only.
//
// THE DIVISION OF LABOUR, because it's easy to blur:
//
//   `totalByCurrency()` in the model returns { CAD: 925, EUR: 32 }.
//   That is the TRUTH: it needs no network, can't go stale, and stays
//   correct if this file breaks entirely.
//
//   This file turns that truth into ONE number in the currency you
//   think in. That is a VIEW. It's approximate, it moves daily, and
//   it must never be written back into a leg.
//
// The README's "money is never a bare number" rule is about storage.
// Nothing here converts anything on the way in — only on the way out.
//
// Two things use this: the trip total, and the "≈ CA$47" hint under
// a fare entered in euros, which is the actual reason multi-currency
// matters — you're on a Portuguese rail site being quoted in EUR and
// need to know what it costs you.
// ============================================================

import type { CurrencyCode, Money } from "../model/trip";

/**
 * open.er-api.com: free, no API key, ~160 currencies including MAD.
 *
 * WHY NOT FRANKFURTER/ECB, the other obvious free option: the ECB
 * reference set is about 30 currencies and does not include the
 * Moroccan dirham, which this trip ends in.
 */
const RATES_URL = "https://open.er-api.com/v6/latest/";

export interface RateTable {
  base: CurrencyCode;
  /** Units of each currency per 1 unit of `base`. */
  rates: Record<CurrencyCode, number>;
  /** When the provider last refreshed, for showing honestly in the UI. */
  updated?: string;
}

/**
 * One in-flight request per base currency, reused for the session.
 * Rates move on a daily cycle; refetching per render would be pure
 * waste and would rate-limit a free endpoint fast.
 */
const cache = new Map<CurrencyCode, Promise<RateTable>>();

/** Matches the 8s the rest of the app's network calls use. */
const RATES_TIMEOUT_MS = 8_000;

export function fetchRates(base: CurrencyCode): Promise<RateTable> {
  const cached = cache.get(base);
  if (cached) return cached;

  const request = fetch(`${RATES_URL}${encodeURIComponent(base)}`, {
    // A stalled rates request must fail rather than hang: `CostSummary`
    // awaits this, and an unsettled promise leaves the total showing a
    // loading state that never resolves.
    signal: AbortSignal.timeout(RATES_TIMEOUT_MS),
  })
    .then(async (res) => {
      if (!res.ok) throw new Error(`Exchange rates unavailable (${res.status})`);

      const body: {
        result?: string;
        rates?: Record<string, number>;
        time_last_update_utc?: string;
      } = await res.json();

      if (body.result !== "success" || !body.rates) {
        throw new Error("Exchange rate provider returned no rates");
      }

      return {
        base,
        rates: body.rates,
        updated: body.time_last_update_utc,
      };
    })
    .catch((cause) => {
      // Don't cache a failure forever — a dropped connection shouldn't
      // leave the app unable to convert for the rest of the session.
      cache.delete(base);
      throw cause;
    });

  cache.set(base, request);
  return request;
}

/**
 * Convert into the table's base currency.
 *
 * `rates` maps base -> currency, so going the other way divides.
 * Returns `undefined` for a currency the provider doesn't cover,
 * which callers must show as "not converted" rather than as zero —
 * a missing rate silently becoming 0 would understate a total, which
 * is the worst direction for a number about money to be wrong in.
 */
export function toBase(money: Money, table: RateTable): number | undefined {
  if (money.currency === table.base) return money.amount;

  const rate = table.rates[money.currency];
  if (!rate) return undefined;

  return money.amount / rate;
}

/** Convert between any two covered currencies, via the base. */
export function convert(
  money: Money,
  target: CurrencyCode,
  table: RateTable,
): number | undefined {
  const inBase = toBase(money, table);
  if (inBase === undefined) return undefined;

  if (target === table.base) return inBase;

  const rate = table.rates[target];
  return rate ? inBase * rate : undefined;
}
