// ============================================================
// Choosing a leg endpoint.
//
// Three sources, in the order they're useful:
//
//   1. Places already in this trip. Almost every leg starts where the
//      previous one ended, so the most likely answer is one you've
//      already entered — instant, no network, no chance of picking a
//      near-duplicate of a place that's already there.
//   2. An IATA code, when the query looks like one. Airports are
//      exactly what a general geocoder is worst at.
//   3. Nominatim free-text search, for everything else.
//
// The list expands inline rather than floating over the form. A
// popover would need positioning, portalling and outside-click
// handling to behave in a scrolling sidebar; pushing the form down is
// the boring option that has none of those failure modes.
// ============================================================

import { Check, Loader2, MapPin, Plane, Search } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import type { KeyboardEvent, ReactNode } from "react";

import type { Place } from "../model/trip";
import { fetchAirport, searchPlaces } from "../lib/placesApi";
import { placeMatches } from "../lib/placeSearch";
import { placeSubtitle } from "./labels";

/**
 * Nominatim's usage policy is roughly one request per second. 400ms
 * after the last keystroke keeps a normal typing burst to a single
 * request while still feeling immediate.
 */
const DEBOUNCE_MS = 400;

/** Below this, a query matches so much that the results are noise. */
const MIN_QUERY_LENGTH = 3;

interface PlacePickerProps {
  label: string;
  value?: Place;
  /** Places already used elsewhere in the trip, offered first. */
  knownPlaces: Place[];
  onChange: (place: Place) => void;
}

interface Suggestion {
  place: Place;
  /** Whether this came from the trip itself, which is worth showing. */
  inTrip: boolean;
}

export function PlacePicker({
  label,
  value,
  knownPlaces,
  onChange,
}: PlacePickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [remote, setRemote] = useState<Place[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string>();
  const [activeIndex, setActiveIndex] = useState(0);

  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  useEffect(() => {
    const trimmed = query.trim();

    if (!open || trimmed.length < MIN_QUERY_LENGTH) {
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
        // A three-letter query is ambiguous — "LIS" is an airport code,
        // "Rio" is a city. Ask both and let the list show both.
        const [airport, matches] = await Promise.all([
          isIataCode(trimmed)
            ? fetchAirport(trimmed).catch(() => undefined)
            : undefined,
          searchPlaces(trimmed, 6, controller.signal),
        ]);

        if (controller.signal.aborted) return;
        setRemote(airport ? [airport, ...matches] : matches);
        setSearching(false);
      } catch (cause) {
        if (controller.signal.aborted) return;
        setSearching(false);
        setError(cause instanceof Error ? cause.message : "Search failed");
      }
    }, DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, open]);

  const suggestions = buildSuggestions(knownPlaces, remote, query);

  // The list shrinks as results arrive; a stale index would highlight
  // the wrong row or nothing at all.
  const active = Math.min(activeIndex, Math.max(0, suggestions.length - 1));

  function choose(place: Place) {
    onChange(place);
    setOpen(false);
    setQuery("");
    setActiveIndex(0);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, suggestions.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      const chosen = suggestions[active];
      if (chosen) choose(chosen.place);
    } else if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
      setQuery("");
    }
  }

  if (!open) {
    return (
      <div>
        <FieldLabel>{label}</FieldLabel>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="flex w-full items-center gap-2 rounded-lg border border-bark-200 bg-parchment px-3 py-2 text-left transition hover:border-bark-300 hover:bg-bark-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-moss-500"
        >
          <MapPin className="size-4 shrink-0 text-bark-500" aria-hidden />
          {value ? (
            <span className="min-w-0 flex-1">
              <span className="block truncate text-body font-medium text-bark-900">
                {value.name}
              </span>
              <span className="block truncate text-caption text-bark-600">
                {placeSubtitle(value)}
                {value.iata ? ` · ${value.iata}` : ""}
              </span>
            </span>
          ) : (
            <span className="flex-1 text-body text-bark-600">
              Search for a place…
            </span>
          )}
        </button>
      </div>
    );
  }

  return (
    <div>
      <FieldLabel>{label}</FieldLabel>
      <div className="rounded-lg border border-ochre-400 bg-parchment ring-2 ring-ochre-100">
        <div className="flex items-center gap-2 px-3 py-2">
          <Search className="size-4 shrink-0 text-bark-500" aria-hidden />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActiveIndex(0);
            }}
            onKeyDown={handleKeyDown}
            onBlur={() => setOpen(false)}
            placeholder="City, station, or airport code"
            role="combobox"
            aria-expanded
            aria-controls={listId}
            aria-autocomplete="list"
            className="w-full bg-transparent text-body text-bark-900 placeholder:text-bark-600 focus:outline-none"
          />
          {searching && (
            <Loader2
              className="size-4 shrink-0 animate-spin text-bark-500"
              aria-label="Searching"
            />
          )}
        </div>

        <ul id={listId} role="listbox" className="scroll-quiet max-h-64 overflow-y-auto border-t border-bark-100">
          {suggestions.map((suggestion, index) => (
            <li key={suggestion.place.id}>
              <button
                type="button"
                role="option"
                aria-selected={index === active}
                // onMouseDown, not onClick: the input's onBlur fires
                // first on click and would close the list before the
                // selection landed.
                onMouseDown={(e) => {
                  e.preventDefault();
                  choose(suggestion.place);
                }}
                onMouseEnter={() => setActiveIndex(index)}
                className={`flex w-full items-center gap-2 px-3 py-2 text-left ${
                  index === active ? "bg-moss-50" : "bg-parchment"
                }`}
              >
                {suggestion.place.iata ? (
                  <Plane className="size-4 shrink-0 text-bark-500" aria-hidden />
                ) : (
                  <MapPin className="size-4 shrink-0 text-bark-500" aria-hidden />
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-body text-bark-900">
                    {suggestion.place.name}
                  </span>
                  <span className="block truncate text-caption text-bark-600">
                    {placeSubtitle(suggestion.place)}
                    {suggestion.place.iata ? ` · ${suggestion.place.iata}` : ""}
                  </span>
                </span>
                {suggestion.inTrip && (
                  <span className="shrink-0 rounded bg-bark-100 px-1.5 py-0.5 text-micro text-bark-700 uppercase">
                    In trip
                  </span>
                )}
                {value?.id === suggestion.place.id && (
                  <Check className="size-4 shrink-0 text-moss-600" aria-hidden />
                )}
              </button>
            </li>
          ))}

          {suggestions.length === 0 && (
            <li className="px-3 py-3 text-caption text-bark-600">
              {error
                ? error
                : searching
                  ? "Searching…"
                  : query.trim().length < MIN_QUERY_LENGTH
                    ? "Type at least three characters."
                    : "No matches. Try adding the city or country."}
            </li>
          )}
        </ul>
      </div>
    </div>
  );
}

function FieldLabel({ children }: { children: ReactNode }) {
  return (
    <span className="mb-1 block text-label font-medium text-bark-700">
      {children}
    </span>
  );
}

function isIataCode(query: string): boolean {
  return /^[a-z]{3}$/i.test(query);
}

/**
 * Trip places first, then remote hits, with anything already offered
 * from the trip filtered out of the remote list — the same station
 * appearing twice under two ids is how you end up with a "gap" between
 * a place and itself.
 */
function buildSuggestions(
  knownPlaces: Place[],
  remote: Place[],
  query: string,
): Suggestion[] {
  const known = knownPlaces
    // `placeMatches` treats an empty query as "everything", which is
    // what an unfiltered list of the trip's own places should be.
    .filter((place) => placeMatches(place, query))
    .slice(0, 5)
    .map((place) => ({ place, inTrip: true }));

  const seen = new Set(known.map((s) => s.place.id));

  const found = remote
    .filter((place) => !seen.has(place.id))
    .map((place) => ({ place, inTrip: false }));

  return [...known, ...found];
}
