// ============================================================
// The leg form.
//
// Layout follows how a leg is actually decided: where it goes first,
// then how you're travelling and how firm it is, then times, then
// money. Booking references and notes live behind a disclosure —
// they're only relevant once something is booked, which is the
// minority of the time you'll have this form open.
//
// Every field except from/to/mode/status is optional in the model,
// and the form treats them that way: nothing is required to save a
// half-sketched idea. That's the point of `status: "idea"`.
// ============================================================

import { ArrowDownUp, ChevronRight, Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";

import { PlacePicker } from "./PlacePicker";

import type { CurrencyCode, Leg, Place } from "../model/trip";
import { currencyForCountry } from "../lib/currencyApi";
import { convert } from "../lib/currency";
import { useRates } from "../cost/useRates";
import { fromInputValue, toInputValue } from "./datetime";
import { plausibleModes } from "./plausibleModes";
import {
  MODES,
  MODE_COLORS,
  MODE_ICONS,
  MODE_LABELS,
  STATUSES,
  STATUS_COLORS,
  STATUS_LABELS,
  formatMoney,
} from "./labels";

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

  // Kept as a string, not a number: a number state can't represent the
  // moment where the field is empty or mid-typing ("12."), and coercing
  // early makes the input fight the person using it.
  const [amount, setAmount] = useState(
    leg.cost ? String(leg.cost.amount) : "",
  );
  const [currency, setCurrency] = useState<CurrencyCode>(
    leg.cost?.currency ?? homeCurrency,
  );
  const [showDetails, setShowDetails] = useState(
    Boolean(leg.operator || leg.bookingRef || leg.bookingUrl || leg.notes),
  );

  const patch = (changes: Partial<DraftLeg>) =>
    setDraft((current) => ({ ...current, ...changes }));

  // Which modes this leg could plausibly use, given where it goes.
  const [showAllModes, setShowAllModes] = useState(false);
  const modeOptions = useMemo(
    () => plausibleModes(draft.from, draft.to),
    [draft.from, draft.to],
  );

  // The selected mode always stays visible even when it's been ruled
  // out — a picker that hides the current value looks like it lost it.
  const visibleModes = showAllModes
    ? MODES
    : modeOptions.likely.includes(draft.mode)
      ? modeOptions.likely
      : [...modeOptions.likely, draft.mode];

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

  // Opening the editor on a leg near the bottom of a long itinerary
  // otherwise leaves the form off-screen, and it looks like the click
  // did nothing.
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    formRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, []);

  // Default the currency to whatever the destination country uses —
  // a train in Portugal is priced in euros, and typing that every time
  // is exactly the kind of chore the app should absorb. Only applied
  // while the cost is still blank, so it can never overwrite a
  // currency that was deliberately chosen.
  const destinationCountry = draft.to?.country;
  const costIsBlank = amount.trim() === "";

  useEffect(() => {
    if (!destinationCountry || !costIsBlank) return;

    // An unknown country leaves the previous default in place; there's
    // nothing useful to tell the user about that.
    const local = currencyForCountry(destinationCountry);
    if (local) setCurrency(local);
  }, [destinationCountry, costIsBlank]);

  // "What does this actually cost me?" — the reason multi-currency
  // matters. You're on a Portuguese rail site quoted in euros and need
  // the number in the currency you budget in.
  const rates = useRates(homeCurrency);
  const parsedAmount = Number.parseFloat(amount);
  const convertedCost =
    rates.table && currency !== homeCurrency && Number.isFinite(parsedAmount)
      ? convert({ amount: parsedAmount, currency }, homeCurrency, rates.table)
      : undefined;

  const currencyGroups = useMemo(() => {
    const suggested = unique([currency, homeCurrency, ...tripCurrencies]);
    const rest = supportedCurrencies().filter((c) => !suggested.includes(c));
    return { suggested, rest };
  }, [currency, homeCurrency, tripCurrencies]);

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
            title="Swap origin and destination"
            aria-label="Swap origin and destination"
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

      <Field label="Mode">
        <div
          className="grid gap-1"
          style={{
            gridTemplateColumns: `repeat(${Math.max(visibleModes.length, 1)}, minmax(0, 1fr))`,
          }}
        >
          {visibleModes.map((mode) => {
            const Icon = MODE_ICONS[mode];
            const selected = draft.mode === mode;
            return (
              <button
                key={mode}
                type="button"
                onClick={() => patch({ mode })}
                title={MODE_LABELS[mode]}
                aria-label={MODE_LABELS[mode]}
                aria-pressed={selected}
                className={`flex flex-col items-center gap-1 rounded-lg border px-1 py-1.5 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-moss-500 ${
                  selected
                    ? "bg-parchment shadow-sm"
                    : "border-transparent text-bark-500 hover:bg-parchment/70"
                }`}
                // Picking a mode previews the colour the route will be
                // drawn in, so the editor doubles as the map's legend.
                style={
                  selected
                    ? {
                        color: MODE_COLORS[mode],
                        borderColor: MODE_COLORS[mode],
                        backgroundColor: `${MODE_COLORS[mode]}0f`,
                      }
                    : undefined
                }
              >
                <Icon className="size-4" aria-hidden />
                <span className="text-[10px] leading-none font-medium">
                  {MODE_LABELS[mode]}
                </span>
              </button>
            );
          })}
        </div>

        {/*
          When geography leaves exactly one answer, say so. A lone
          highlighted button with no alternatives looks like the form
          is broken; a sentence explains that it isn't.
        */}
        {modeOptions.unlikely.length > 0 && (
          <p className="mt-1.5 flex items-center gap-1.5 text-[11px] text-bark-400">
            {modeOptions.likely.length === 1 && !showAllModes && (
              <span>
                No land route — this leg has to be a{" "}
                {MODE_LABELS[modeOptions.likely[0]].toLowerCase()}.
              </span>
            )}
            <button
              type="button"
              onClick={() => setShowAllModes((shown) => !shown)}
              className="underline decoration-dotted underline-offset-2 transition hover:text-bark-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-moss-500"
            >
              {showAllModes ? "Show likely modes only" : "Other modes"}
            </button>
          </p>
        )}
      </Field>

      <Field label="Status">
        <div className="grid grid-cols-3 gap-1">
          {STATUSES.map((status) => (
            <button
              key={status}
              type="button"
              onClick={() => patch({ status })}
              aria-pressed={draft.status === status}
              className={`rounded-lg border px-2 py-1.5 text-xs font-medium transition focus:outline-none focus-visible:ring-2 focus-visible:ring-moss-500 ${
                draft.status === status
                  ? "shadow-sm"
                  : "border-transparent text-bark-500 hover:bg-parchment/70"
              }`}
              // Same trick as the mode row above: picking a status
              // previews the colour that status is drawn in everywhere
              // else, so the editor doubles as the legend for both
              // channels. Dashed until booked, exactly like the pill
              // on the card and the line on the map.
              style={
                draft.status === status
                  ? {
                      color: STATUS_COLORS[status],
                      borderColor: STATUS_COLORS[status],
                      borderStyle: status === "booked" ? "solid" : "dashed",
                      backgroundColor: `${STATUS_COLORS[status]}14`,
                    }
                  : undefined
              }
            >
              {STATUS_LABELS[status]}
            </button>
          ))}
        </div>
      </Field>

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
        <div className="flex gap-2">
          <input
            type="number"
            inputMode="decimal"
            min="0"
            step="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="Unknown"
            className={`${inputClasses} min-w-0 flex-1 tabular-nums`}
          />
          <select
            value={currency}
            onChange={(e) => setCurrency(e.target.value)}
            aria-label="Currency"
            className={`${inputClasses} w-24 shrink-0`}
          >
            <optgroup label="This trip">
              {currencyGroups.suggested.map((code) => (
                <option key={code} value={code}>
                  {code}
                </option>
              ))}
            </optgroup>
            <optgroup label="All currencies">
              {currencyGroups.rest.map((code) => (
                <option key={code} value={code}>
                  {code}
                </option>
              ))}
            </optgroup>
          </select>
        </div>

        {convertedCost !== undefined && (
          <p className="mt-1 text-[11px] text-bark-500">
            ≈{" "}
            <span className="font-medium tabular-nums">
              {formatMoney({
                amount: Math.round(convertedCost * 100) / 100,
                currency: homeCurrency,
              })}
            </span>{" "}
            each · stored in {currency}, converted only for display
          </p>
        )}
      </Field>

      <div>
        <button
          type="button"
          onClick={() => setShowDetails((shown) => !shown)}
          aria-expanded={showDetails}
          className="flex items-center gap-1 text-xs font-medium text-bark-500 transition hover:text-bark-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-moss-500"
        >
          <ChevronRight
            className={`size-3.5 transition-transform ${showDetails ? "rotate-90" : ""}`}
            aria-hidden
          />
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

      {/*
        Sticky, because this form is taller than the panel once the
        details section is open — and a Save button you have to go
        looking for is a Save button people don't press. The negative
        margins let it span the form's padding so it reads as a bar
        rather than a floating row.
      */}
      <div className="sticky bottom-0 -mx-3 -mb-3 flex items-center gap-2 rounded-b-xl border-t border-moss-200/70 bg-moss-50 px-3 py-2.5">
        {onDelete && (
          <button
            type="button"
            onClick={onDelete}
            className="rounded-lg p-2 text-bark-400 transition hover:bg-rust-50 hover:text-rust-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-rust-500"
            title="Delete this leg"
            aria-label="Delete this leg"
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

/**
 * Deliberately carries no width. Tailwind resolves `w-full w-24` by
 * stylesheet order rather than by the order they're written in the
 * class attribute, so baking a width in here means a narrower field
 * can't reliably override it — which is how the currency select ends
 * up eating the amount input. Width is stated at each use instead.
 */
const inputClasses =
  "rounded-lg border border-bark-200 bg-parchment px-2.5 py-1.5 text-sm text-bark-900 placeholder:text-bark-400 focus:border-moss-400 focus:outline-none focus:ring-2 focus:ring-moss-100";

function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-bark-500">
        {label}
      </span>
      {children}
    </label>
  );
}

function unique(codes: CurrencyCode[]): CurrencyCode[] {
  return [...new Set(codes.filter(Boolean))];
}

/**
 * Every ISO 4217 code the runtime knows about — the same source
 * `currencyApi` validates against, so the dropdown and the validator
 * can never disagree about what a real currency is.
 */
function supportedCurrencies(): CurrencyCode[] {
  return Intl.supportedValuesOf("currency");
}
