// ============================================================
// What the trip costs, as one number.
//
// WHY ONE NUMBER AND NOT THE PER-CURRENCY BREAKDOWN: the breakdown
// is what the model stores and it's the only thing that's reliably
// true — but it isn't what anyone wants to know. "CA$1,850 and €64"
// asks the reader to do currency conversion in their head to answer
// the only question they had. You pay your credit card bill in one
// currency; the total should be in that currency.
//
// The breakdown doesn't disappear, it moves behind a disclosure —
// because a converted total is an estimate built on a rate that moved
// this morning, and being able to check the arithmetic is what makes
// an estimate trustworthy rather than magic.
//
// If rates can't be fetched, this degrades to the raw breakdown
// rather than to a wrong number or a blank.
// ============================================================

import { ChevronDown, TriangleAlert } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { formatMoney } from "../itinerary/labels";
import { toBase } from "../lib/currency";
import type { CurrencyCode, Leg, Trip } from "../model/trip";
import { totalByCurrency } from "../model/trip";
import { useRates } from "./useRates";

interface CostLine {
  currency: CurrencyCode;
  /** Already multiplied by travellers, as `totalByCurrency` returns it. */
  amount: number;
  /** In the home currency, or undefined if the provider has no rate. */
  converted?: number;
}

interface CostSummaryProps {
  trip: Trip;
  /** Derived legs, supplied by the shell — see `deriveLegs()`. */
  legs: Leg[];
}

export function CostSummary({ trip, legs }: CostSummaryProps) {
  const { table, loading, error } = useRates(trip.homeCurrency);
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  // Native <details> would handle the toggle for free but stays open
  // when you click elsewhere, which reads as broken for a dropdown.
  useEffect(() => {
    if (!open) return;

    const close = (event: PointerEvent) => {
      if (!wrapperRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);

  const lines: CostLine[] = Object.entries(totalByCurrency(trip, legs)).map(
    ([currency, amount]) => ({
      currency,
      amount: amount ?? 0,
      converted: table ? toBase({ amount: amount ?? 0, currency }, table) : undefined,
    }),
  );

  if (lines.length === 0) {
    return <p className="text-xs text-bark-400">No costs entered yet</p>;
  }

  const convertible = lines.filter((line) => line.converted !== undefined);
  const missing = lines.filter((line) => line.converted === undefined);
  const total = convertible.reduce((sum, line) => sum + (line.converted ?? 0), 0);

  // Only the home-currency figure is knowable without rates, so that's
  // what's shown while they load — no placeholder that later jumps.
  const canTotal = table !== undefined && missing.length === 0;

  return (
    <div ref={wrapperRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((shown) => !shown)}
        aria-expanded={open}
        className="flex items-center gap-2 rounded-lg px-2 py-1 text-right transition hover:bg-bark-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-moss-500"
      >
        <span>
          <span className="block text-[10px] font-medium tracking-wide text-bark-400 uppercase">
            Trip total
          </span>
          <span className="block text-base leading-tight font-semibold tabular-nums">
            {loading ? (
              <span className="text-bark-300">Converting…</span>
            ) : canTotal ? (
              formatMoney({
                amount: Math.round(total),
                currency: trip.homeCurrency,
              })
            ) : (
              <span className="flex items-center gap-1 text-bark-600">
                <TriangleAlert className="size-3.5 text-ochre-500" aria-hidden />
                {formatMoney({
                  amount: Math.round(total),
                  currency: trip.homeCurrency,
                })}
                <span className="text-xs font-normal text-bark-400">
                  + {missing.length} more
                </span>
              </span>
            )}
          </span>
        </span>
        <ChevronDown
          className={`size-4 shrink-0 text-bark-400 transition-transform ${open ? "rotate-180" : ""}`}
          aria-hidden
        />
      </button>

      {open && (
        <div className="absolute right-0 z-20 mt-1 w-80 rounded-xl border border-bark-200 bg-parchment p-3 shadow-lg">
          <p className="mb-2 text-[11px] text-bark-500">
            {trip.travellers}{" "}
            {trip.travellers === 1 ? "traveller" : "travellers"} — per-person
            costs are already multiplied through.
          </p>

          <table className="w-full text-xs">
            <tbody>
              {lines.map((line) => (
                <tr key={line.currency} className="text-bark-600">
                  <td className="py-1 pr-2 font-medium">{line.currency}</td>
                  <td className="py-1 pr-2 text-right tabular-nums">
                    {formatMoney({
                      amount: line.amount,
                      currency: line.currency,
                    })}
                  </td>
                  <td className="py-1 text-right tabular-nums text-bark-900">
                    {line.currency === trip.homeCurrency
                      ? ""
                      : line.converted === undefined
                        ? "no rate"
                        : `≈ ${formatMoney({
                            amount: Math.round(line.converted),
                            currency: trip.homeCurrency,
                          })}`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="mt-2 border-t border-bark-200 pt-2 text-xs">
            {error ? (
              <p className="text-ochre-700">
                {error} — showing each currency separately. The per-currency
                figures above are always correct; only the conversion needs a
                network.
              </p>
            ) : (
              <>
                <div className="flex justify-between font-semibold text-bark-900">
                  <span>Total</span>
                  <span className="tabular-nums">
                    {formatMoney({
                      amount: Math.round(total),
                      currency: trip.homeCurrency,
                    })}
                  </span>
                </div>
                {table?.updated && (
                  <p className="mt-1.5 text-[11px] text-bark-400">
                    Rates as of {table.updated.replace(" +0000", " UTC")}.
                    Converted for display only — legs stay stored in the
                    currency you'll actually pay.
                  </p>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
