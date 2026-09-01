// ============================================================
// The hop editor — "want to be super detailed?"
//
// WHAT THIS FORM IS, AND WHY IT ISN'T THE OLD LEG EDITOR:
//
// Legs are derived. The route engine proposes how you get from one
// destination to the next — a bus to the airport, a flight, a metro
// ride into town — and each of those hops arrives here as a GUESS.
// Nothing on screen is a stored object being edited; every field shows
// either what the engine proposed or what you said instead. So this
// form does not save a leg. It RECORDS A DISAGREEMENT: one
// `HopOverride` field at a time, keyed by the hop rather than by the
// row, so it survives the legs being thrown away and recomputed.
//
// THE PART THAT MAKES IT SAFE TO USE: every field can be handed back.
// An override with no way out is a one-way door — override a mode by
// mistake and the engine can never correct that hop again, however
// much the rest of the trip changes around it. So each field carries
// a reset, and each field says which side it is currently on: "From
// the route" or "Yours". Nobody should have to guess which of their
// details are their own.
//
// WHY EDITS APPLY IMMEDIATELY, with no Save button: a Save button
// would introduce a third state — a value that is neither the engine's
// nor yet yours — and the provenance markers, which are the point of
// this screen, would be lying for as long as the form stayed open.
// Every change is one dispatch, and the way to take one back is the
// reset next to it.
//
// FROM/TO ARE READ-ONLY, and that is not a simplification. The hop id
// IS its endpoints, so "editing" them would not edit this hop; it would
// silently address a different one and leave this hop's override
// stranded under the old key. Endpoints change by changing the
// destinations the route runs between.
// ============================================================

import { ChevronRight, MapPin, RotateCcw, Undo2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import type {
  CurrencyCode,
  HopOverride,
  Leg,
  Money,
  PlanStatus,
  RouteHop,
  TransportMode,
} from "../model/trip";
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
import type { HopOverrideAction, OverrideField } from "./hopOverrides";
import {
  OVERRIDE_FIELD_LABELS,
  baseHopId,
  hasOverrides,
  isRepeatOccurrence,
} from "./hopOverrides";
import { MODE_LABELS, STATUS_LABELS, formatMoney, placeSubtitle } from "./labels";

type TextField = "operator" | "bookingRef" | "bookingUrl" | "notes";
type TimeField = "departure" | "arrival";

interface HopEditorProps {
  /** The hop as it currently reads: the engine's proposal, override applied. */
  leg: Leg;
  /**
   * The engine's untouched proposal for this hop, when the caller has
   * it. Optional because the route engine (Unit 6) may have nothing to
   * say about a pair — and because a field can still be reset without
   * knowing what it will land on. Supplying it is what lets each reset
   * name the value it goes back to, which is most of what makes the
   * reset trustworthy.
   */
  hop?: RouteHop;
  /** What the user has already said. Absent means "purely the engine's". */
  override?: HopOverride;
  /**
   * How many times this hop happens on the trip — `occurrenceCount(legs,
   * leg.id)`. One override serves all of them, and the form says so
   * above two or more.
   *
   * Not inferred from the leg id: only the second and later occurrences
   * are suffixed, so inferring would hide the warning on the first card
   * — the one most likely to be opened.
   */
  occurrences?: number;
  /** Currencies already used in this trip, offered above the full ISO list. */
  tripCurrencies: CurrencyCode[];
  homeCurrency: CurrencyCode;
  /**
   * `HopOverrideAction` is `Extract<TripAction, ...>` (see
   * `hopOverrides.ts`), so the trip's own `Dispatch<TripAction>` is
   * passed straight in — no adapter, because there is nothing left for
   * one to bridge.
   */
  dispatch: (action: HopOverrideAction) => void;
  onClose: () => void;
}

export function HopEditor({
  leg,
  hop,
  override,
  // A caller that hasn't counted still gets the warning where the id
  // proves a repeat; it just can't be shown on the first occurrence.
  occurrences = isRepeatOccurrence(leg.id) ? 2 : 1,
  tripCurrencies,
  homeCurrency,
  dispatch,
  onClose,
}: HopEditorProps) {
  // THE ONE LINE EVERY WRITE IN THIS FILE DEPENDS ON. A leg id may
  // carry an occurrence suffix ("lisbon->porto#2"); the override it
  // belongs to never does. See hopOverrides.ts.
  const hopKey = baseHopId(leg.id);

  const set = (fields: HopOverride) =>
    dispatch({ type: "set-hop-override", hop: hopKey, patch: fields });
  // The reducer's `clear-hop-override` takes `fields` as an array so it
  // can drop several at once; this editor always clears one field (or,
  // via `resetEverything`, none — meaning "the whole override") at a
  // time, so the single `field` argument is wrapped here rather than
  // pushed out to every call site.
  const clear = (field?: OverrideField) =>
    dispatch({
      type: "clear-hop-override",
      hop: hopKey,
      fields: field ? [field] : undefined,
    });

  /**
   * What each field falls back to when handed back to the engine.
   *
   * Where the caller gave us the `RouteHop`, that's the answer. Where
   * it didn't, a field the user hasn't touched is *already* showing the
   * guess, so the leg itself is the source. A field that is overridden
   * with no `RouteHop` to compare against genuinely has an unknown
   * fallback — the reset still works, it just can't name the value.
   */
  const guess = {
    mode: hop?.mode ?? (override?.mode === undefined ? leg.mode : undefined),
    operator:
      hop?.operator ??
      (override?.operator === undefined ? leg.operator : undefined),
    cost: hop?.cost ?? (override?.cost === undefined ? leg.cost : undefined),
    // The engine never books anything and never invents a time, so
    // these three have exactly one honest fallback each.
    status: "idea" as PlanStatus,
  };

  // Kept as strings, not `Money`: a number can't represent the moment
  // the field is empty or mid-typing ("12."), and coercing early makes
  // the input fight the person using it.
  const [amount, setAmount] = useState(leg.cost ? String(leg.cost.amount) : "");
  const [currency, setCurrency] = useState<CurrencyCode>(
    leg.cost?.currency ?? homeCurrency,
  );

  // Re-seed when the form is pointed at a different hop without being
  // unmounted. Keyed on the hop, not on the cost: resyncing whenever
  // the cost changes would overwrite what is being typed with the
  // round-tripped version of itself.
  useEffect(() => {
    setAmount(leg.cost ? String(leg.cost.amount) : "");
    setCurrency(leg.cost?.currency ?? homeCurrency);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hopKey]);

  // Open the disclosure when there is something behind it, so a booking
  // reference is never hidden from the person who came to check it.
  const hasDetails = Boolean(
    leg.operator || leg.bookingRef || leg.bookingUrl || leg.notes,
  );
  const [showDetails, setShowDetails] = useState(hasDetails);

  // Also on the hop AFTER this one, for the same reason. Keyed on the
  // hop alone: re-running it whenever the fields change would slam the
  // section shut under someone who had just opened it.
  useEffect(() => {
    setShowDetails(hasDetails);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hopKey]);

  const modeOptions = useMemo(
    () => plausibleModes(leg.from, leg.to),
    [leg.from, leg.to],
  );

  // Opening the editor on a hop near the bottom of a long itinerary
  // otherwise leaves the form off-screen, and it looks like the click
  // did nothing.
  const formRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    formRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [hopKey]);

  // Default the currency to whatever the destination country uses — a
  // train in Portugal is priced in euros, and typing that every time is
  // exactly the kind of chore the app should absorb. Only while the
  // amount is blank, so it can never overwrite a currency that was
  // deliberately chosen, and it dispatches nothing: an empty amount is
  // no opinion at all.
  const destinationCountry = leg.to.country;
  const costIsBlank = amount.trim() === "";

  useEffect(() => {
    if (!costIsBlank) return;

    // An unknown country leaves the previous default in place; there's
    // nothing useful to tell the user about that.
    const local = currencyForCountry(destinationCountry);
    if (local) setCurrency(local);
  }, [destinationCountry, costIsBlank]);

  /**
   * Blank means "no opinion", which is a clear rather than a write —
   * emptying the operator box hands the operator back to the engine
   * rather than asserting the journey has no carrier.
   *
   * The cast is the narrow kind: `field` is a union of keys whose value
   * type is `string | undefined` in every case, so the only thing
   * TypeScript can't do on its own is turn a computed key back into a
   * known one.
   */
  function setText(field: TextField, value: string) {
    if (value.trim() === "") clear(field);
    else set({ [field]: value } as Pick<HopOverride, TextField>);
  }

  function setTime(field: TimeField, value: string) {
    // Local wall-clock straight from the input; no conversion, ever.
    const parsed = fromInputValue(value);
    if (parsed === undefined) clear(field);
    else set({ [field]: parsed } as Pick<HopOverride, TimeField>);
  }

  function setCost(nextAmount: string, nextCurrency: CurrencyCode) {
    const parsed = Number.parseFloat(nextAmount);
    // Store in the currency actually paid. Conversion is a display
    // concern and happens nowhere near this write.
    if (Number.isFinite(parsed) && parsed >= 0) {
      set({ cost: { amount: parsed, currency: nextCurrency } });
    } else if (nextAmount.trim() === "") {
      clear("cost");
    }
    // Anything else — "12." mid-typing, or a negative fare — writes
    // nothing and clears nothing: the last good value stands until the
    // box holds a number again. `min="0"` on the input used to be
    // enforced by the old form's submit; nothing submits here, so the
    // check has to live at the write.
  }

  /**
   * The amount box holds its own string, so anything that drops the
   * cost override has to put the engine's number back into it by hand.
   * Miss this and the field keeps showing what you typed while labelled
   * "From the route" and while the card behind it shows the engine's
   * price — three sources disagreeing about one number.
   */
  function syncCostToGuess() {
    setAmount(guess.cost ? String(guess.cost.amount) : "");
    setCurrency(guess.cost?.currency ?? homeCurrency);
  }

  function resetCost() {
    clear("cost");
    syncCostToGuess();
  }

  function resetEverything() {
    clear();
    syncCostToGuess();
  }

  /** Choosing the value the engine already proposed is a reset, not an
   * override: it keeps the record honest about who decided what. */
  function chooseMode(mode: TransportMode) {
    if (mode === guess.mode) clear("mode");
    else set({ mode });
  }

  function chooseStatus(status: PlanStatus) {
    if (status === guess.status) clear("status");
    else set({ status });
  }

  /** For fields the route engine can propose a value for. */
  const provenance = (field: OverrideField, routeValue?: string) => (
    <Provenance
      field={field}
      overridden={override?.[field] !== undefined}
      routeValue={routeValue}
      onReset={field === "cost" ? resetCost : () => clear(field)}
    />
  );

  /**
   * For fields the engine never proposes — times, bookings, and status.
   *
   * These get no "From the route" marker, because attributing them to
   * the route engine would be a lie: it does not book, it does not
   * invent times, and `deriveLegs` calls a hop an idea precisely
   * BECAUSE the engine has no way to know. `defaultValue` names what a
   * reset lands on when that isn't simply nothing.
   */
  const ownProvenance = (field: OverrideField, defaultValue?: string) => (
    <Provenance
      field={field}
      overridden={override?.[field] !== undefined}
      defaultValue={defaultValue}
      onReset={() => clear(field)}
    />
  );

  // A negative fare is not a refund, it's a typo, and the total it
  // would quietly subtract from is the whole point of the cost field.
  const typedAmount = Number.parseFloat(amount);
  const amountRejected = Number.isFinite(typedAmount) && typedAmount < 0;

  const bookingUrl = leg.bookingUrl ?? "";
  const bookingUrlOdd =
    bookingUrl.trim() !== "" && !/^https?:\/\//i.test(bookingUrl.trim());

  const anyOverrides = hasOverrides(override);

  return (
    <div
      ref={formRef}
      className="space-y-4 rounded-xl border border-moss-200 bg-moss-50/40 p-3"
    >
      <Endpoints leg={leg} occurrences={occurrences} />

      <FieldGroup
        label="Mode"
        action={provenance("mode", modeLabel(guess.mode))}
      >
        <ModePicker
          value={leg.mode}
          options={modeOptions}
          onChange={chooseMode}
        />
      </FieldGroup>

      <FieldGroup
        label="Status"
        action={ownProvenance("status", STATUS_LABELS[guess.status])}
      >
        <StatusPicker value={leg.status} onChange={chooseStatus} />
      </FieldGroup>

      <div className="grid grid-cols-2 gap-2">
        <Field label="Departure" action={ownProvenance("departure")}>
          <input
            type="datetime-local"
            value={toInputValue(leg.departure)}
            onChange={(e) => setTime("departure", e.target.value)}
            className={`${inputClasses} w-full`}
          />
        </Field>
        <Field label="Arrival" action={ownProvenance("arrival")}>
          <input
            type="datetime-local"
            value={toInputValue(leg.arrival)}
            onChange={(e) => setTime("arrival", e.target.value)}
            className={`${inputClasses} w-full`}
          />
        </Field>
      </div>

      <Field
        label="Cost, per person"
        action={provenance("cost", moneyLabel(guess.cost))}
      >
        <MoneyInput
          amount={amount}
          currency={currency}
          onAmountChange={(next) => {
            setAmount(next);
            setCost(next, currency);
          }}
          onCurrencyChange={(next) => {
            setCurrency(next);
            setCost(amount, next);
          }}
          tripCurrencies={tripCurrencies}
          homeCurrency={homeCurrency}
        />
        {amountRejected && (
          <p className="mt-1 text-micro text-rust-600">
            Not saved — a fare below zero is a typo, not a refund.
          </p>
        )}
      </Field>

      <div>
        <button
          type="button"
          onClick={() => setShowDetails((shown) => !shown)}
          aria-expanded={showDetails}
          className="flex items-center gap-1 text-label font-medium text-bark-600 transition hover:text-bark-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-moss-500"
        >
          <ChevronRight
            className={`size-3.5 transition-transform ${showDetails ? "rotate-90" : ""}`}
            aria-hidden
          />
          Operator, booking &amp; notes
        </button>

        {showDetails && (
          <div className="mt-2 space-y-2">
            <Field
              label="Operator"
              action={provenance("operator", guess.operator)}
            >
              <input
                value={leg.operator ?? ""}
                onChange={(e) => setText("operator", e.target.value)}
                placeholder="TAP Air Portugal, CP, ALSA…"
                className={`${inputClasses} w-full`}
              />
            </Field>
            <div className="grid grid-cols-2 gap-2">
              <Field
                label="Booking reference"
                action={ownProvenance("bookingRef")}
              >
                <input
                  value={leg.bookingRef ?? ""}
                  onChange={(e) => setText("bookingRef", e.target.value)}
                  className={`${inputClasses} w-full`}
                />
              </Field>
              <Field label="Booking link" action={ownProvenance("bookingUrl")}>
                <input
                  type="url"
                  value={bookingUrl}
                  onChange={(e) => setText("bookingUrl", e.target.value)}
                  placeholder="https://…"
                  className={`${inputClasses} w-full`}
                />
                {/* Kept rather than rejected: half a URL is a normal
                    state to be in mid-paste, and refusing the write
                    would refuse the keystroke. Whoever renders this as
                    a link is still responsible for the scheme. */}
                {bookingUrlOdd && (
                  <p className="mt-1 text-micro text-ochre-700">
                    Add https:// or this won't open as a link.
                  </p>
                )}
              </Field>
            </div>
            <Field label="Notes" action={ownProvenance("notes")}>
              <textarea
                value={leg.notes ?? ""}
                onChange={(e) => setText("notes", e.target.value)}
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
        details section is open — and a control you have to go looking
        for is a control people don't press. The negative margins let it
        span the form's padding so it reads as a bar rather than a
        floating row.
      */}
      <div className="sticky bottom-0 -mx-3 -mb-3 flex items-center gap-2 rounded-b-xl border-t border-moss-200/70 bg-moss-50 px-3 py-2.5">
        <button
          type="button"
          onClick={resetEverything}
          disabled={!anyOverrides}
          {...labelled("Reset the whole hop to the route engine's proposal")}
          className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-label font-medium text-bark-600 transition hover:bg-rust-50 hover:text-rust-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-rust-500 disabled:cursor-not-allowed disabled:text-bark-300 disabled:hover:bg-transparent disabled:hover:text-bark-300"
        >
          <RotateCcw className="size-3.5" aria-hidden />
          Reset all
        </button>
        <div className="flex-1" />
        <p className="hidden text-micro text-bark-600 sm:block">
          Saved as you type
        </p>
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg bg-moss-700 px-3 py-1.5 text-body font-medium text-white transition hover:bg-moss-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-moss-500"
        >
          Done
        </button>
      </div>
    </div>
  );
}

/**
 * Where the hop goes — context, not a control.
 *
 * Spelled out with both endpoint names rather than cities: the whole
 * reason a hop exists separately from a destination is that it runs
 * between an airport and a station, and "Lisbon → Lisbon" says nothing.
 */
function Endpoints({ leg, occurrences }: { leg: Leg; occurrences: number }) {
  return (
    <div className="rounded-lg border border-bark-200 bg-parchment px-3 py-2">
      <div className="flex items-start gap-2">
        <MapPin className="mt-0.5 size-4 shrink-0 text-bark-400" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-body font-medium text-bark-900">
            {leg.from.name} <span className="text-bark-400">→</span>{" "}
            {leg.to.name}
          </p>
          <p className="truncate text-caption text-bark-600">
            {placeSubtitle(leg.from)}
            {leg.from.iata ? ` · ${leg.from.iata}` : ""} →{" "}
            {placeSubtitle(leg.to)}
            {leg.to.iata ? ` · ${leg.to.iata}` : ""}
          </p>
        </div>
      </div>

      <p className="mt-1.5 text-micro text-bark-600">
        Fixed by the route between your destinations — change the
        destinations to change it.
      </p>

      {/* The shared-override rule, said out loud where it matters. Two
          occurrences of one hop are one journey and one booking, so an
          edit here lands on both — surprising only if nobody says so.
          Shown on EVERY occurrence, including the first: it is the one
          people open, and it is the one the leg id can't identify. */}
      {occurrences > 1 && (
        <p className="mt-1 text-micro text-ochre-700">
          This hop happens {occurrences} times on the trip · what you set
          here applies to every one of them.
        </p>
      )}
    </div>
  );
}

interface ProvenanceProps {
  field: OverrideField;
  overridden: boolean;
  /**
   * What the ROUTE ENGINE proposed for this field, when it proposed
   * anything. Its presence is what earns the "From the route" marker,
   * so only pass it for fields the engine can actually speak to.
   */
  routeValue?: string;
  /** What a reset lands on when the engine isn't the one it goes back to. */
  defaultValue?: string;
  onReset: () => void;
}

/**
 * Which side of the disagreement this field is currently on.
 *
 * Two channels, because either alone is ambiguous: the word says who
 * decided, and the presence of the reset button says there is something
 * to undo. Deliberately drawn in bark rather than in a status or mode
 * colour — provenance is a third fact about a hop, and borrowing either
 * of those palettes would make "Yours" look like a plan state.
 */
function Provenance({
  field,
  overridden,
  routeValue,
  defaultValue,
  onReset,
}: ProvenanceProps) {
  const name = OVERRIDE_FIELD_LABELS[field];

  if (!overridden) {
    // Nothing to say about a field nobody has an opinion on: an empty
    // booking reference is neither the engine's nor yours, and claiming
    // the engine chose it would be exactly the confusion this screen
    // exists to remove.
    if (!routeValue) return null;
    return <span className="text-micro text-bark-600">From the route</span>;
  }

  const resetTitle = routeValue
    ? `Reset ${name} to the route engine's ${routeValue}`
    : defaultValue
      ? `Reset ${name} to ${defaultValue}`
      : `Clear the ${name} you set`;

  return (
    <span className="flex items-center gap-1">
      <span className="rounded-full border border-bark-200 bg-bark-50 px-1.5 py-px text-micro text-bark-600">
        Yours
      </span>
      <button
        type="button"
        onClick={onReset}
        {...labelled(resetTitle)}
        className="rounded-md p-0.5 text-bark-400 transition hover:bg-bark-100 hover:text-bark-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-moss-500"
      >
        <Undo2 className="size-3.5" aria-hidden />
      </button>
    </span>
  );
}

function modeLabel(mode?: TransportMode): string | undefined {
  return mode ? MODE_LABELS[mode] : undefined;
}

function moneyLabel(money?: Money): string | undefined {
  return money ? formatMoney(money) : undefined;
}
