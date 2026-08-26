// ============================================================
// Exchange rates as React state.
//
// Kept separate from `lib/currency.ts` so that file stays a plain
// async function anything can call — the fetching and the rendering
// have no business being tangled together.
// ============================================================

import { useEffect, useState } from "react";

import type { CurrencyCode } from "../model/trip";
import type { RateTable } from "../lib/currency";
import { fetchRates } from "../lib/currency";

export interface RatesState {
  table?: RateTable;
  loading: boolean;
  /** Set when rates couldn't be loaded. The UI falls back to the raw
   * per-currency breakdown, which is always correct without a network. */
  error?: string;
}

export function useRates(base: CurrencyCode): RatesState {
  const [state, setState] = useState<RatesState>({ loading: true });

  useEffect(() => {
    let cancelled = false;
    setState({ loading: true });

    fetchRates(base)
      .then((table) => {
        if (!cancelled) setState({ table, loading: false });
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setState({
          loading: false,
          error: cause instanceof Error ? cause.message : "Rates unavailable",
        });
      });

    return () => {
      cancelled = true;
    };
  }, [base]);

  return state;
}
