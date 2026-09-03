// ============================================================
// "Where would you stay?" and "What would you do there?" — steps 4
// and 5 of the popup, which are the same screen twice.
//
// ONE COMPONENT, BECAUSE IT IS ONE QUESTION. Both steps fetch a short
// list of places near the destination, let the traveller tick the ones
// that appeal, and move on. Only the query and the vocabulary differ.
// Two files would have drifted apart within a week, and the second one
// would have been the one missing the keyboard handling.
//
// A TICK IS NOT A BOOKING. Everything ticked lands on the trip as
// `status: "idea"`, and a stay lands with no dates at all — the
// question here is "does this interest you", asked months before
// anyone knows which night they'll be in town. `Stay.checkIn` is
// optional for exactly this moment.
//
// EMPTY IS AN ANSWER, NOT AN ERROR. The loaders resolve to `[]` when
// the network is gone or the city simply has nothing tagged, and the
// step says so plainly and still offers the way on. Onboarding is the
// worst place in the app to strand someone behind a failed fetch.
// ============================================================

import { Check, Loader2, Plus } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import type { Place } from "../model/trip";

interface SuggestionStepProps<T> {
  /** The city being searched around, and the key that re-runs the load. */
  city: Place;
  load: (city: Place, signal: AbortSignal) => Promise<readonly T[]>;
  /** The model's own word for this item — "Hotel", "Museum" — as a chip. */
  noteOf: (item: T) => string;
  /** Place ids already on the trip, so a re-entered step shows its ticks. */
  chosen: ReadonlySet<string>;
  onToggle: (item: T, add: boolean) => void;
  /** The one line shown when the search comes back with nothing. */
  emptyNote: string;
  groupLabel: string;
}

/**
 * `T` is pinned to things that carry a `Place` rather than being fully
 * free: the place is what the list renders and what the trip dedupes
 * on, so a caller that had no place would have nothing to show.
 */
export function SuggestionStep<T extends { place: Place }>({
  city,
  load,
  noteOf,
  chosen,
  onToggle,
  emptyNote,
  groupLabel,
}: SuggestionStepProps<T>) {
  const [items, setItems] = useState<readonly T[]>();

  // THE CITY IS THE ONLY THING WORTH REFETCHING FOR, so `load` is held
  // in a ref rather than watched. A caller passing an inline arrow —
  // which a test stubbing the network is very likely to do — would
  // otherwise hand this effect a new function on every render, and
  // since the effect sets state, that is an infinite refetch loop.
  // Making it impossible here beats documenting a rule every caller
  // has to remember.
  const loadRef = useRef(load);
  loadRef.current = load;

  // `undefined` is "still looking", `[]` is "looked, found nothing" —
  // two states the UI has to tell apart, and the reason this isn't a
  // plain array starting empty.
  useEffect(() => {
    const controller = new AbortController();
    setItems(undefined);

    loadRef.current(city, controller.signal)
      // `load` is a public prop, and the real loaders build their query
      // string before reaching the fetch that swallows failures — so a
      // `Place` with bad coords rejects out here. Without this the
      // rejection is unhandled and `setItems` never runs, which leaves
      // the step on its spinner for good. Empty is already this
      // component's word for "looked, found nothing"; a loader that
      // threw found nothing too.
      .catch(() => [])
      .then((next) => {
        if (!controller.signal.aborted) setItems(next);
      });

    // Aborts the request as well as ignoring it: leaving the popup
    // shouldn't leave a fetch running against a public API that asks
    // callers to be modest with it.
    return () => controller.abort();
    // Keyed on the id, not the object: `Place` is rebuilt on every
    // render of the step above, and the value is what matters.
  }, [city.id]);

  if (items === undefined) {
    return (
      <p className="flex items-center gap-1.5 text-caption text-bark-600">
        <Loader2 className="size-3.5 shrink-0 animate-spin" aria-hidden />
        Looking around {city.city}…
      </p>
    );
  }

  if (items.length === 0) {
    return <p className="text-caption text-bark-600">{emptyNote}</p>;
  }

  return (
    // A list of independent toggles, not a radiogroup: these are
    // several yes/no answers rather than one choice with several
    // answers, which is the distinction `aria-pressed` carries and a
    // radio would get wrong. PRODUCT.md makes WCAG 2.2 AA binding.
    <ul
      role="group"
      aria-label={groupLabel}
      className="max-h-64 space-y-1 overflow-y-auto"
    >
      {items.map((item) => {
        const added = chosen.has(item.place.id);

        return (
          <li key={item.place.id}>
            <button
              type="button"
              aria-pressed={added}
              onClick={() => onToggle(item, !added)}
              className={`flex w-full items-center gap-2 rounded-lg border px-2.5 py-1.5 text-left text-label transition focus:outline-none focus-visible:ring-2 focus-visible:ring-moss-500 ${
                added
                  ? "border-moss-500 bg-moss-50 font-semibold text-bark-900"
                  : // Weight is the hover channel, as everywhere else in
                    // the popup — the border and background stay put so
                    // a long list doesn't shift under the cursor.
                    "border-bark-200 bg-parchment font-medium text-bark-700 hover:font-semibold hover:text-bark-900 focus-visible:font-semibold"
              }`}
            >
              {added ? (
                <Check className="size-4 shrink-0 text-moss-700" aria-hidden />
              ) : (
                <Plus className="size-4 shrink-0 text-bark-500" aria-hidden />
              )}
              <span className="min-w-0 flex-1 truncate">{item.place.name}</span>
              <span className="shrink-0 text-caption font-normal text-bark-600">
                {noteOf(item)}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
