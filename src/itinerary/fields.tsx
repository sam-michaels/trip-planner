// ============================================================
// The form controls the itinerary shares.
//
// WHY THESE MOVED OUT OF THE EDITOR: they used to have two callers —
// the hop editor, which records a disagreement with the route engine,
// and the leg editor, which edited a stored leg directly. Unit 8
// deleted the leg editor along with stored legs themselves, leaving
// `StatusPicker` a second caller in the destination card and
// `ModePicker`/`MoneyInput` used only by the hop editor — but they stay
// shared rather than folded back in, because the day a second mode
// picker reappears is the day it quietly drifts from this one.
//
// Everything here is presentational and stateless apart from the "other
// modes" disclosure, which is pure view state and belongs with the
// control that owns it. Provenance — whether a value came from the
// engine or from the user — is expressly NOT handled here: it is the
// hop editor's whole subject, and it rides in through `action`.
// ============================================================

import { useMemo, useState } from "react";
import type { ReactNode } from "react";

import type { CurrencyCode, PlanStatus, TransportMode } from "../model/trip";
import { convert } from "../lib/currency";
import { useRates } from "../cost/useRates";
import type { ModeOptions } from "./plausibleModes";
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

/**
 * Deliberately carries no width. Tailwind resolves `w-full w-24` by
 * stylesheet order rather than by the order they're written in the
 * class attribute, so baking a width in here means a narrower field
 * can't reliably override it — which is how the currency select ends
 * up eating the amount input. Width is stated at each use instead.
 */
// `text-body` per the input-text component spec ("the working size — form
// fields..."). Placeholder is `bark-600`, not the `bark-400` the component
// prose used to suggest: the Text Floor Rule is explicit that placeholder
// text is still text someone has to read to know what a field wants, and
// bark-400 measures 2.6:1 on parchment — nowhere near the 4.5:1 floor.
export const inputClasses =
  "rounded-lg border border-bark-200 bg-parchment px-2.5 py-1.5 text-body text-bark-900 placeholder:text-bark-600 focus:border-moss-400 focus:outline-none focus:ring-2 focus:ring-moss-100";

/**
 * An icon button's name, said once.
 *
 * `title` (the hover tooltip) and `aria-label` (the accessible name)
 * have to agree, and writing the same literal twice is how they stop
 * agreeing — one gets edited and the other doesn't, and the divergence
 * is invisible to whoever can only hear one of them.
 */
export function labelled(text: string): { title: string; "aria-label": string } {
  return { title: text, "aria-label": text };
}

interface FieldProps {
  label: string;
  /** Right-hand side of the label row — provenance, a reset button. */
  action?: ReactNode;
  children: ReactNode;
}

/**
 * One labelled control.
 *
 * The visible caption is a plain span and the accessible name comes
 * from a hidden one inside the `<label>`. That looks redundant and
 * isn't: `action` holds a button, and a button nested inside a
 * `<label>` is also a click target for the label's control, so the
 * reset button would focus the input it just reset.
 */
export function Field({ label, action, children }: FieldProps) {
  return (
    <div>
      <div className="mb-1 flex min-h-4 items-center justify-between gap-2">
        <span className="text-label font-medium text-bark-600">{label}</span>
        {action}
      </div>
      <label className="block">
        <span className="sr-only">{label}</span>
        {children}
      </label>
    </div>
  );
}

/**
 * Same header, for a set of buttons rather than one input.
 *
 * A `<label>` can only name a form control, so wrapping a row of
 * buttons in one names nothing. `role="group"` with an `aria-label` is
 * the shape that actually announces "Mode, group" before the options.
 */
export function FieldGroup({ label, action, children }: FieldProps) {
  return (
    <div>
      <div className="mb-1 flex min-h-4 items-center justify-between gap-2">
        <span className="text-label font-medium text-bark-600">{label}</span>
        {action}
      </div>
      <div role="group" aria-label={label}>
        {children}
      </div>
    </div>
  );
}

interface ModePickerProps {
  value: TransportMode;
  /** Which modes the geography makes plausible — see plausibleModes.ts. */
  options: ModeOptions;
  onChange: (mode: TransportMode) => void;
}

export function ModePicker({ value, options, onChange }: ModePickerProps) {
  const [showAll, setShowAll] = useState(false);

  // The selected mode always stays visible even when it's been ruled
  // out — a picker that hides the current value looks like it lost it.
  const visible = showAll
    ? MODES
    : options.likely.includes(value)
      ? options.likely
      : [...options.likely, value];

  return (
    <>
      <div
        className="grid gap-1"
        style={{
          gridTemplateColumns: `repeat(${Math.max(visible.length, 1)}, minmax(0, 1fr))`,
        }}
      >
        {visible.map((mode) => {
          const Icon = MODE_ICONS[mode];
          const selected = value === mode;
          return (
            <button
              key={mode}
              type="button"
              onClick={() => onChange(mode)}
              title={MODE_LABELS[mode]}
              aria-label={MODE_LABELS[mode]}
              aria-pressed={selected}
              className={`flex flex-col items-center gap-1 rounded-lg border px-1 py-1.5 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-moss-500 ${
                selected
                  ? "bg-parchment shadow-sm"
                  : "border-transparent text-bark-600 hover:bg-parchment/70"
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
              <span className="text-micro">{MODE_LABELS[mode]}</span>
            </button>
          );
        })}
      </div>

      {/*
        When geography leaves exactly one answer, say so. A lone
        highlighted button with no alternatives looks like the form is
        broken; a sentence explains that it isn't.
      */}
      {options.unlikely.length > 0 && (
        <p className="mt-1.5 flex items-center gap-1.5 text-micro text-bark-600">
          {options.likely.length === 1 && !showAll && (
            <span>
              No land route — this hop has to be a{" "}
              {MODE_LABELS[options.likely[0]].toLowerCase()}.
            </span>
          )}
          <button
            type="button"
            onClick={() => setShowAll((shown) => !shown)}
            className="underline decoration-dotted underline-offset-2 transition hover:text-bark-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-moss-500"
          >
            {showAll ? "Show likely modes only" : "Other modes"}
          </button>
        </p>
      )}
    </>
  );
}

interface StatusPickerProps {
  value: PlanStatus;
  onChange: (status: PlanStatus) => void;
}

export function StatusPicker({ value, onChange }: StatusPickerProps) {
  return (
    <div className="grid grid-cols-3 gap-1">
      {STATUSES.map((status) => (
        <button
          key={status}
          type="button"
          onClick={() => onChange(status)}
          aria-pressed={value === status}
          className={`rounded-lg border px-2 py-1.5 text-label font-medium transition focus:outline-none focus-visible:ring-2 focus-visible:ring-moss-500 ${
            value === status
              ? "shadow-sm"
              : "border-transparent text-bark-600 hover:bg-parchment/70"
          }`}
          // Same trick as the mode row: picking a status previews the
          // colour that status is drawn in everywhere else, so the
          // editor doubles as the legend for both channels. Dashed
          // until booked, exactly like the pill on the card and the
          // line on the map. Status never borrows the mode's colour —
          // see STATUS_COLORS for why.
          style={
            value === status
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
  );
}

interface MoneyInputProps {
  /** Kept as a string, not a number: a number can't represent the
   * moment where the field is empty or mid-typing ("12."), and coercing
   * early makes the input fight the person using it. */
  amount: string;
  currency: CurrencyCode;
  onAmountChange: (amount: string) => void;
  onCurrencyChange: (currency: CurrencyCode) => void;
  /** Currencies already used in this trip, offered above the full ISO list. */
  tripCurrencies: CurrencyCode[];
  homeCurrency: CurrencyCode;
  placeholder?: string;
}

export function MoneyInput({
  amount,
  currency,
  onAmountChange,
  onCurrencyChange,
  tripCurrencies,
  homeCurrency,
  placeholder = "Unknown",
}: MoneyInputProps) {
  // "What does this actually cost me?" — the reason multi-currency
  // matters. You're on a Portuguese rail site quoted in euros and need
  // the number in the currency you budget in. The amount stays stored
  // in the currency you'll actually pay; this is display only.
  const rates = useRates(homeCurrency);
  const parsed = Number.parseFloat(amount);
  const converted =
    // A negative amount is a typo rather than a price, and converting
    // it just puts a second wrong number under the first.
    rates.table && currency !== homeCurrency && Number.isFinite(parsed) && parsed >= 0
      ? convert({ amount: parsed, currency }, homeCurrency, rates.table)
      : undefined;

  const groups = useMemo(() => {
    const suggested = unique([currency, homeCurrency, ...tripCurrencies]);
    const rest = supportedCurrencies().filter((c) => !suggested.includes(c));
    return { suggested, rest };
  }, [currency, homeCurrency, tripCurrencies]);

  return (
    <>
      <div className="flex gap-2">
        <input
          type="number"
          inputMode="decimal"
          min="0"
          step="0.01"
          value={amount}
          onChange={(e) => onAmountChange(e.target.value)}
          placeholder={placeholder}
          className={`${inputClasses} min-w-0 flex-1 tabular-nums`}
        />
        <select
          value={currency}
          onChange={(e) => onCurrencyChange(e.target.value)}
          aria-label="Currency"
          className={`${inputClasses} w-24 shrink-0`}
        >
          <optgroup label="This trip">
            {groups.suggested.map((code) => (
              <option key={code} value={code}>
                {code}
              </option>
            ))}
          </optgroup>
          <optgroup label="All currencies">
            {groups.rest.map((code) => (
              <option key={code} value={code}>
                {code}
              </option>
            ))}
          </optgroup>
        </select>
      </div>

      {converted !== undefined && (
        <p className="mt-1 text-micro text-bark-600">
          ≈{" "}
          <span className="font-medium tabular-nums">
            {formatMoney({
              amount: Math.round(converted * 100) / 100,
              currency: homeCurrency,
            })}
          </span>{" "}
          each · stored in {currency}, converted only for display
        </p>
      )}
    </>
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
