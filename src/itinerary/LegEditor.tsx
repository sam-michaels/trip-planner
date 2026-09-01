// ============================================================
// The old, hand-assembled leg form.
//
// TODO(unit-8): delete this file. It edits a STORED leg — a thing the
// model no longer has — and everything it can express is now said
// better by choosing destinations (endpoints, order) or by
// `HopEditor` (mode, times, money, bookings, per-field resets back to
// the route engine's guess). It survives one wave only because
// `ItineraryPanel` still lists hand-made legs and would not compile
// without it; the moment that panel is rebuilt around destinations,
// this goes.
//
// It is deliberately thin: every control it draws now comes from
// `fields.tsx`, shared with `HopEditor`, so there is exactly one mode
// picker and one money input in the app rather than two that drift
// apart over the wave it takes to remove this.
// ============================================================

import { ArrowDownUp, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";

import { PlacePicker } from "./PlacePicker";

import type { CurrencyCode, Leg, Place } from "../model/trip";
import { currencyForCountry } from "../lib/currencyApi";
import { fromInputValue, toInputValue } from "./datetime";
import { plausibleModes } from "./plausibleModes";
import {
  Field,
  FieldGroup,
  ModePicker,
  MoneyInput,
  StatusPicker,
  inputClasses,
  labelled,
} from "./fields";

/** A leg being written. `from`/`to` are required on a saved `Leg`, but
 * a brand-new one starts with neither, so the draft loosens just those. */
type DraftLeg = Omit<Leg, "from" | "to"> & { from?: Place; to?: Place };

interface LegEditorProps {
  leg: DraftLeg;
  knownPlaces: Place[];
  /** Currencies already used in this trip, offered above the full ISO list. */
  tripCurrencies: CurrencyCode[];
  homeCurrency: CurrencyCode;
  onSave: (leg: Leg) => void;
  onCancel: () => void;
  onDelete?: () => void;
}

export function LegEditor({
  leg,
  knownPlaces,
  tripCurrencies,
  homeCurrency,
  onSave,
  onCancel,
  onDelete,
}: LegEditorProps) {
  const [draft, setDraft] = useState<DraftLeg>(leg);

  const [amount, setAmount] = useState(leg.cost ? String(leg.cost.amount) : "");
  const [currency, setCurrency] = useState<CurrencyCode>(
    leg.cost?.currency ?? homeCurrency,
  );
  const [showDetails, setShowDetails] = useState(
    Boolean(leg.operator || leg.bookingRef || leg.bookingUrl || leg.notes),
  );

  const patch = (changes: Partial<DraftLeg>) =>
    setDraft((current) => ({ ...current, ...changes }));

  const modeOptions = plausibleModes(draft.from, draft.to);

  // Changing an endpoint can invalidate the mode: switch Toronto's
  // destination from Montreal to Lisbon and "bus" stops being a thing
  // that can happen. Correcting the draft is safe because nothing is
  // saved until Save is pressed, and leaving it stale would let an
  // impossible leg through.
  const fromId = draft.from?.id;
  const toId = draft.to?.id;
  useEffect(() => {
    if (!draft.from || !draft.to) return;
    const { likely } = plausibleModes(draft.from, draft.to);
    if (!likely.includes(draft.mode)) patch({ mode: likely[0] });
    // Keyed on the endpoints only: this must react to where the leg
    // goes, not to the user deliberately picking an unlikely mode.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromId, toId]);

  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    formRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, []);

  // Default the currency to whatever the destination country uses,
  // while the cost is still blank so it can never overwrite a currency
  // that was deliberately chosen.
  const destinationCountry = draft.to?.country;
  const costIsBlank = amount.trim() === "";

  useEffect(() => {
    if (!destinationCountry || !costIsBlank) return;
    const local = currencyForCountry(destinationCountry);
    if (local) setCurrency(local);
  }, [destinationCountry, costIsBlank]);

  const sameEndpoints =
    draft.from !== undefined && draft.from.id === draft.to?.id;
  const canSave =
    draft.from !== undefined && draft.to !== undefined && !sameEndpoints;

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!draft.from || !draft.to) return;

    const parsed = Number.parseFloat(amount);

    onSave({
      ...draft,
      from: draft.from,
      to: draft.to,
      // A blank or unparseable amount means "cost unknown", which is a
      // real and common state — not zero.
      cost: Number.isFinite(parsed) ? { amount: parsed, currency } : undefined,
    });
  }

  return (
    <form
      ref={formRef}
      onSubmit={handleSubmit}
      className="space-y-4 rounded-xl border border-moss-200 bg-moss-50/40 p-3"
    >
      <div className="space-y-2">
        <PlacePicker
          label="From"
          value={draft.from}
          knownPlaces={knownPlaces}
          onChange={(from) => patch({ from })}
        />

        <div className="flex justify-center">
          <button
            type="button"
            onClick={() => patch({ from: draft.to, to: draft.from })}
            {...labelled("Swap origin and destination")}
            className="rounded-full border border-bark-200 bg-parchment p-1.5 text-bark-500 transition hover:border-bark-300 hover:text-bark-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-moss-500"
          >
            <ArrowDownUp className="size-3.5" aria-hidden />
          </button>
        </div>

        <PlacePicker
          label="To"
          value={draft.to}
          knownPlaces={knownPlaces}
          onChange={(to) => patch({ to })}
        />

        {sameEndpoints && (
          <p className="text-xs text-rust-600">
            A leg has to go somewhere — pick a different destination.
          </p>
        )}
      </div>

      <FieldGroup label="Mode">
        <ModePicker
          value={draft.mode}
          options={modeOptions}
          onChange={(mode) => patch({ mode })}
        />
      </FieldGroup>

      <FieldGroup label="Status">
        <StatusPicker
          value={draft.status}
          onChange={(status) => patch({ status })}
        />
      </FieldGroup>

      <div className="grid grid-cols-2 gap-2">
        <Field label="Departure">
          <input
            type="datetime-local"
            value={toInputValue(draft.departure)}
            onChange={(e) =>
              patch({ departure: fromInputValue(e.target.value) })
            }
            className={`${inputClasses} w-full`}
          />
        </Field>
        <Field label="Arrival">
          <input
            type="datetime-local"
            value={toInputValue(draft.arrival)}
            onChange={(e) => patch({ arrival: fromInputValue(e.target.value) })}
            className={`${inputClasses} w-full`}
          />
        </Field>
      </div>

      <Field label="Cost, per person">
        <MoneyInput
          amount={amount}
          currency={currency}
          onAmountChange={setAmount}
          onCurrencyChange={setCurrency}
          tripCurrencies={tripCurrencies}
          homeCurrency={homeCurrency}
        />
      </Field>

      <div>
        <button
          type="button"
          onClick={() => setShowDetails((shown) => !shown)}
          aria-expanded={showDetails}
          className="text-xs font-medium text-bark-500 underline decoration-dotted underline-offset-2 transition hover:text-bark-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-moss-500"
        >
          Operator, booking &amp; notes
        </button>

        {showDetails && (
          <div className="mt-2 space-y-2">
            <Field label="Operator">
              <input
                value={draft.operator ?? ""}
                onChange={(e) =>
                  patch({ operator: e.target.value || undefined })
                }
                placeholder="TAP Air Portugal, CP, ALSA…"
                className={`${inputClasses} w-full`}
              />
            </Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Booking reference">
                <input
                  value={draft.bookingRef ?? ""}
                  onChange={(e) =>
                    patch({ bookingRef: e.target.value || undefined })
                  }
                  className={`${inputClasses} w-full`}
                />
              </Field>
              <Field label="Booking link">
                <input
                  type="url"
                  value={draft.bookingUrl ?? ""}
                  onChange={(e) =>
                    patch({ bookingUrl: e.target.value || undefined })
                  }
                  placeholder="https://…"
                  className={`${inputClasses} w-full`}
                />
              </Field>
            </div>
            <Field label="Notes">
              <textarea
                value={draft.notes ?? ""}
                onChange={(e) => patch({ notes: e.target.value || undefined })}
                rows={2}
                placeholder="Alternatives you're weighing, things to check…"
                className={`${inputClasses} w-full resize-y`}
              />
            </Field>
          </div>
        )}
      </div>

      <div className="sticky bottom-0 -mx-3 -mb-3 flex items-center gap-2 rounded-b-xl border-t border-moss-200/70 bg-moss-50 px-3 py-2.5">
        {onDelete && (
          <button
            type="button"
            onClick={onDelete}
            className="rounded-lg p-2 text-bark-400 transition hover:bg-rust-50 hover:text-rust-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-rust-500"
            {...labelled("Delete this leg")}
          >
            <Trash2 className="size-4" aria-hidden />
          </button>
        )}
        <div className="flex-1" />
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg px-3 py-1.5 text-sm font-medium text-bark-600 transition hover:bg-bark-200/70 focus:outline-none focus-visible:ring-2 focus-visible:ring-moss-500"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={!canSave}
          className="rounded-lg bg-moss-700 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-moss-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-moss-500 disabled:cursor-not-allowed disabled:bg-bark-300"
        >
          Save leg
        </button>
      </div>
    </form>
  );
}
