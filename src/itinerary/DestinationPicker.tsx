// ============================================================
// "Where do you want to go?" — the whole question, in one place.
//
// There are two kinds of person at this point in a trip. One of them
// already knows: they want Lisbon, and anything other than a field
// they can type "Lisbon" into is in their way. The other doesn't
// know, and for them a search box is a closed door — an empty input
// is a terrible answer to "where do you want to go?", because it
// only accepts answers you already have.
//
// So this is ONE field with TWO states rather than two features
// behind a toggle. Empty, it's the browse (see InspirationGrid) —
// forty places and a reason for each. Typed into, it's a search.
// Nobody has to choose a mode; you either start typing or you don't,
// and the surface follows.
//
// DERIVED FROM PlacePicker, NOT REPLACING IT. That one picks a leg
// ENDPOINT — a station, a terminal, an IATA code, and its best guess
// is usually a place already in the trip because legs chain. This
// one picks a DESTINATION, which is always a city and is by
// definition somewhere you haven't been yet. Same debounce, same
// abort-on-unmount, same four empty states; different sources and a
// different notion of a good first guess.
//
// TWO SOURCES, IN THE ORDER THEY ARRIVE:
//
//   1. The curated list, matched locally. Free, instant, and
//      typing "lis" surfaces Lisbon before the network has been
//      asked anything. It also carries the hook, which is the only
//      result text here that's worth reading.
//   2. Nominatim, debounced, for the other eight million places.
//
// The remote list is filtered against the local one by DISTANCE
// (lib/placeSearch.ts): the geocoder's "Lisboa" and the curated
// "Lisbon" are the same city under two ids and two spellings, and
// offering both is how you end up with a trip that flies from a
// place to itself.
// ============================================================

import { Compass, Loader2, MapPin, Search, X } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { KeyboardEvent } from "react";

import type { Place } from "../model/trip";
import { countryName } from "../lib/countries";
import { searchPlaces } from "../lib/placesApi";
import { alreadyListed, normalizeQuery } from "../lib/placeSearch";
import { searchPopular } from "../lib/popularDestinations";
import { InspirationGrid } from "./InspirationGrid";

/**
 * Nominatim's usage policy is roughly one request per second. 400ms
 * after the last keystroke keeps a normal typing burst to a single
 * request while still feeling immediate. Same figure as PlacePicker,
 * for the same reason.
 */
const DEBOUNCE_MS = 400;

/** Below this, a remote query matches so much the results are noise. */
const MIN_QUERY_LENGTH = 3;

/**
 * The curated list is a shortlist, not the answer. Four of it is
 * enough to show "we know this one" without pushing the geocoder's
 * results — which are the point once you've typed a real name — off
 * the bottom of a short list.
 */
const MAX_CURATED_SUGGESTIONS = 4;

/** One shared empty array, so a defaulted prop keeps its identity. */
const NO_PLACES: readonly Place[] = [];

interface Suggestion {
  place: Place;
  /** The curated reason to go, when this came from the shortlist. */
  hook?: string;
  /** Already somewhere in this trip. Worth saying; not a blocker. */
  inTrip: boolean;
}

interface DestinationPickerProps {
  /**
   * Fires with the chosen city. Turning it into a `Destination` (an
   * id, a status, a night count) is the reducer's job, not this
   * component's — it has no opinion about where in the trip it goes.
   */
  onSelect: (place: Place) => void;
  /**
   * Destinations already in the trip. Used only to badge results, by
   * distance rather than id — never to hide them, because going back
   * to a city later in the same trip is a normal shape for a trip.
   */
  knownPlaces?: readonly Place[];
  /** The question above the field. */
  label?: string;
  /**
   * Show the browse when the field is empty. Default on — it's half
   * the point. Turn it off where there genuinely isn't room.
   */
  browse?: boolean;
  autoFocus?: boolean;
}

export function DestinationPicker({
  onSelect,
  knownPlaces = NO_PLACES,
  label = "Where to next?",
  browse = true,
  autoFocus = false,
}: DestinationPickerProps) {
  const [query, setQuery] = useState("");
  const [remote, setRemote] = useState<Place[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string>();
  const [activeIndex, setActiveIndex] = useState(0);

  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();
  const optionId = (index: number) => `${listId}-option-${index}`;

  const trimmed = query.trim();
  const searchable = trimmed.length >= MIN_QUERY_LENGTH;

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus();
  }, [autoFocus]);

  useEffect(() => {
    if (!searchable) {
      setRemote([]);
      setSearching(false);
      setError(undefined);
      return;
    }

    const controller = new AbortController();
    setSearching(true);
    setError(undefined);

    const timer = setTimeout(async () => {
      try {
        const matches = await searchPlaces(trimmed, 6, controller.signal);
        if (controller.signal.aborted) return;
        setRemote(matches);
        setSearching(false);
      } catch (cause) {
        // An aborted fetch is the normal path on unmount and on the
        // next keystroke, not a failure worth showing anyone.
        if (controller.signal.aborted) return;
        setSearching(false);
        // The previous query's hits have to go with it. Nominatim
        // rate-limits hard, so a failure here is routine — and rows
        // for "lisbon" sitting under the word "brussels", with the
        // error drawn nowhere because the list isn't empty, is how
        // you add the wrong city to your trip.
        setRemote([]);
        setError(cause instanceof Error ? cause.message : "Search failed");
      }
    }, DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [trimmed, searchable]);

  const suggestions = useMemo(
    () => buildSuggestions(query, remote, knownPlaces),
    [query, remote, knownPlaces],
  );

  // The list shrinks as results arrive; a stale index would highlight
  // the wrong row or nothing at all.
  const active = Math.min(activeIndex, Math.max(0, suggestions.length - 1));

  const browsing = trimmed.length === 0;

  function choose(place: Place) {
    onSelect(place);
    setQuery("");
    setRemote([]);
    setActiveIndex(0);
    // Focus stays in the field: adding one destination is very often
    // the moment you think of the next one.
    inputRef.current?.focus();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      // `Math.max(0, ...)` because an empty list would otherwise
      // clamp to -1 and stay there: results arrive, nothing is
      // highlighted, and Enter does nothing until you press Down
      // a second time.
      setActiveIndex((i) =>
        Math.min(i + 1, Math.max(0, suggestions.length - 1)),
      );
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      const chosen = suggestions[active];
      if (chosen) choose(chosen.place);
    } else if (event.key === "Escape") {
      event.preventDefault();
      setQuery("");
      setActiveIndex(0);
    }
  }

  return (
    <section aria-label="Add a destination" className="space-y-2">
      <div className="rounded-xl border border-bark-200 bg-parchment focus-within:border-ochre-400 focus-within:ring-2 focus-within:ring-ochre-100">
        <label
          htmlFor={`${listId}-input`}
          className="block px-3 pt-2 text-xs font-medium text-bark-500"
        >
          {label}
        </label>

        <div className="flex items-center gap-2 px-3 pt-0.5 pb-2">
          <Search className="size-4 shrink-0 text-bark-400" aria-hidden />
          <input
            id={`${listId}-input`}
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActiveIndex(0);
            }}
            onKeyDown={handleKeyDown}
            placeholder="A city — or leave it empty and browse"
            role="combobox"
            aria-expanded={!browsing}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={
              !browsing && suggestions.length > 0 ? optionId(active) : undefined
            }
            className="w-full bg-transparent text-sm text-bark-900 placeholder:text-bark-400 focus:outline-none"
          />
          {searching && (
            <Loader2
              className="size-4 shrink-0 animate-spin text-bark-400"
              aria-label="Searching"
            />
          )}
          {!browsing && !searching && (
            <button
              type="button"
              onClick={() => {
                setQuery("");
                setActiveIndex(0);
                inputRef.current?.focus();
              }}
              aria-label="Clear the search and browse instead"
              className="shrink-0 rounded text-bark-400 transition hover:text-bark-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-moss-500"
            >
              <X className="size-4" aria-hidden />
            </button>
          )}
        </div>

        {/*
          The listbox exists only while there's a query. When the
          field is empty there is nothing to be the active descendant
          of, and an empty listbox announced as "0 results" is a worse
          answer to "where do you want to go?" than the grid below.
        */}
        {!browsing && (
          <ul
            id={listId}
            role="listbox"
            aria-label="Matching destinations"
            className="max-h-72 overflow-y-auto border-t border-bark-100"
          >
            {suggestions.map((suggestion, index) => (
              <li
                key={suggestion.place.id}
                id={optionId(index)}
                role="option"
                aria-selected={index === active}
                // onMouseDown, not onClick: a click elsewhere can blur
                // the field first, and the row should commit on the
                // press regardless of what focus does afterwards.
                onMouseDown={(e) => {
                  e.preventDefault();
                  choose(suggestion.place);
                }}
                onMouseEnter={() => setActiveIndex(index)}
                className={`flex cursor-pointer items-start gap-2 px-3 py-2 ${
                  index === active ? "bg-moss-50" : "bg-parchment"
                }`}
              >
                {suggestion.hook ? (
                  <Compass
                    className="mt-0.5 size-4 shrink-0 text-ochre-500"
                    aria-hidden
                  />
                ) : (
                  <MapPin
                    className="mt-0.5 size-4 shrink-0 text-bark-400"
                    aria-hidden
                  />
                )}

                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline gap-2">
                    <span className="min-w-0 truncate text-sm text-bark-900">
                      {suggestion.place.name}
                    </span>
                    {suggestion.inTrip && (
                      <span className="shrink-0 rounded bg-bark-100 px-1.5 py-0.5 text-[10px] font-medium tracking-wide text-bark-500 uppercase">
                        In trip
                      </span>
                    )}
                  </span>
                  <span className="block truncate text-xs text-bark-500">
                    {subtitleFor(suggestion.place)}
                  </span>
                  {suggestion.hook && (
                    <span className="mt-0.5 block text-xs leading-relaxed text-bark-600">
                      {suggestion.hook}
                    </span>
                  )}
                </span>
              </li>
            ))}

            {suggestions.length === 0 && (
              <li className="px-3 py-3 text-xs text-bark-500">
                {error ? (
                  <span className="text-rust-600">{error}</span>
                ) : searching ? (
                  "Searching…"
                ) : searchable ? (
                  "No matches. Try the city, or the country it's in."
                ) : (
                  "Nothing on the shortlist yet — three letters and the search goes wider."
                )}
              </li>
            )}
          </ul>
        )}
      </div>

      {/*
        Results are announced rather than only drawn: this list
        repopulates ~400ms after you stop typing, long after a screen
        reader has finished reading the keystroke, so nothing would
        otherwise tell you it happened.
      */}
      <p role="status" aria-live="polite" className="sr-only">
        {browsing
          ? ""
          : error
            ? error
            : searching
              ? "Searching…"
              : `${suggestions.length} ${
                  suggestions.length === 1 ? "destination" : "destinations"
                } for “${trimmed}”`}
      </p>

      {browse && browsing && (
        <InspirationGrid
          onSelect={choose}
          knownPlaces={knownPlaces}
          caption="No idea yet? Pick one of these and the route works itself out."
        />
      )}
    </section>
  );
}

/**
 * Curated matches first, then the geocoder's.
 *
 * The order is a claim about usefulness, not about quality: a curated
 * row comes with a reason to go, which is the thing you're actually
 * choosing between at this point in planning. A geocoder row is a
 * name and a pin.
 *
 * Remote hits that land on top of something already listed are
 * dropped — see `alreadyListed` for why that's distance and not id.
 */
function buildSuggestions(
  query: string,
  remote: readonly Place[],
  knownPlaces: readonly Place[],
): Suggestion[] {
  if (!normalizeQuery(query)) return [];

  const curated = searchPopular(query).slice(0, MAX_CURATED_SUGGESTIONS);

  const suggestions: Suggestion[] = curated.map(({ place, hook }) => ({
    place,
    hook,
    inTrip: alreadyListed(place, knownPlaces),
  }));

  // Kept alongside rather than derived per iteration, so the
  // duplicate check sees rows added earlier in this same loop —
  // Nominatim will happily return "Lisboa" and "Lisboa, Portugal"
  // as two hits.
  const listed: Place[] = suggestions.map((s) => s.place);
  const drawn = new Set(listed.map(displayKey));

  for (const place of remote) {
    // Two filters, for two different duplicates. The distance one
    // catches the same city under two names; this one catches rows
    // that are genuinely different places but would DRAW the same —
    // "Lisbon" returns four towns in the United States, and four
    // identical rows aren't a choice, they're noise. Nominatim ranks
    // by importance, so the first is the one anyone meant.
    const key = displayKey(place);
    if (drawn.has(key) || alreadyListed(place, listed)) continue;

    drawn.add(key);
    listed.push(place);
    suggestions.push({ place, inTrip: alreadyListed(place, knownPlaces) });
  }

  return suggestions;
}

/** Everything a row shows. Two rows with the same key are unpickable. */
function displayKey(place: Place): string {
  return `${place.name}|${place.city}|${place.country}|${place.iata ?? ""}`.toLowerCase();
}

/**
 * The line under a result's name. A curated row's name is already
 * the city, so repeating it ("Lisbon — Lisbon, PT") says nothing;
 * a geocoder row's name is often a station or a district, where the
 * city is the part that tells you where you'd actually be.
 */
function subtitleFor(place: Place): string {
  const country = countryName(place.country);
  const parts =
    place.city && place.city !== place.name
      ? [place.city, country]
      : [country];

  if (place.iata) parts.push(place.iata);
  return parts.join(" · ");
}
