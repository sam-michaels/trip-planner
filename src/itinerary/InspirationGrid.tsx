// ============================================================
// The browse half of "where do you want to go?"
//
// Everything else in this app assumes you already have an answer.
// This is the surface for the people who don't — and that is most
// people, most of the time. A search box asks you to already know;
// a grid of forty places with a reason attached to each one asks
// you only to react, which is a far easier thing to do. "Not that
// one, but something like it" is how deciding actually works.
//
// WHY THE HOOK IS THE POINT: the name of a city is not a reason to
// go to it. "Bungee jumping was invented here, which tells you
// something about the terrain" is. The hook is the largest block of
// text on the card on purpose — it is the content, and the name is
// its label.
//
// WHY REGIONS RATHER THAN A RANKING: any ordering of forty cities
// is a lie about which is best, and a list that opens on twelve
// European capitals just relocates the blank-box problem. Sections
// by continent make the spread visible at a glance and give the one
// filter people actually want ("somewhere warm and far away" is
// mostly a question about which continent).
//
// SELECTION IS DISTANCE-BASED, NOT ID-BASED: a trip that already
// holds Nominatim's "Lisboa" must not offer curated "Lisbon" as a
// fresh idea. See `alreadyListed` in lib/placeSearch.ts.
// ============================================================

import { Check, Plus } from "lucide-react";
import { useMemo, useState } from "react";
import type { ReactNode } from "react";

import type { Place } from "../model/trip";
import { countryName } from "../lib/countries";
import type { Continent } from "../lib/geo";
import { alreadyListed } from "../lib/placeSearch";
import type { PopularDestination } from "../lib/popularDestinations";
import { POPULAR_DESTINATIONS, searchPopular } from "../lib/popularDestinations";

/**
 * Continents as you'd say them out loud. `Continent` is a routing
 * concept in geo.ts ("can you get there overland?"); these are the
 * same six values wearing their browse-UI clothes.
 */
export const REGION_LABELS: Record<Continent, string> = {
  europe: "Europe",
  africa: "Africa",
  asia: "Asia",
  "north-america": "North America",
  "south-america": "South America",
  oceania: "Oceania",
};

/**
 * Section order follows the curated list's own order rather than a
 * hardcoded array: the file groups its entries by continent already,
 * and deriving means adding a seventh region — or reordering the
 * dataset — needs no edit here to show up correctly.
 */
const REGION_ORDER: Continent[] = [
  ...new Set(POPULAR_DESTINATIONS.map((d) => d.region)),
];

/** One shared empty array, so a defaulted prop keeps its identity. */
const NO_PLACES: readonly Place[] = [];

interface InspirationGridProps {
  /** Fires with the curated `Place`, ready to become a destination. */
  onSelect: (place: Place) => void;
  /**
   * Text filter, usually the query from a search box mounted above
   * this. Optional: the grid is perfectly useful with no filter at all.
   */
  query?: string;
  /**
   * Places already in the trip. Matched by distance, not id, so a
   * geocoded "Lisboa" still badges the curated "Lisbon" card.
   */
  knownPlaces?: readonly Place[];
  /** The line above the region chips. Pass `null` for none. */
  caption?: ReactNode;
  /** Region to open on. Omitted means "everywhere", sectioned. */
  initialRegion?: Continent;
}

export function InspirationGrid({
  onSelect,
  query = "",
  knownPlaces = NO_PLACES,
  caption,
  initialRegion,
}: InspirationGridProps) {
  const [region, setRegion] = useState<Continent | undefined>(initialRegion);

  // Filtering forty rows is cheap, but it runs on every keystroke of
  // a search box that isn't ours, so it isn't free either.
  const matching = useMemo(() => searchPopular(query), [query]);

  const counts = useMemo(() => countByRegion(matching), [matching]);

  const shown = region ? matching.filter((d) => d.region === region) : matching;

  // Sections only when browsing everywhere. Inside one region the
  // heading would just repeat the chip you already pressed.
  const sections: Array<{ region?: Continent; items: PopularDestination[] }> =
    region
      ? [{ region: undefined, items: shown }]
      : REGION_ORDER.map((r) => ({
          region: r,
          items: shown.filter((d) => d.region === r),
        })).filter((section) => section.items.length > 0);

  return (
    <div className="@container">
      {caption !== null && (
        <p className="mb-2 text-caption text-bark-600">
          {caption ?? (
            <>
              {POPULAR_DESTINATIONS.length} places, and a reason for each.
            </>
          )}
        </p>
      )}

      <div
        role="group"
        aria-label="Filter destinations by region"
        className="mb-3 flex flex-wrap gap-1"
      >
        <RegionChip
          label="Everywhere"
          count={matching.length}
          selected={region === undefined}
          onClick={() => setRegion(undefined)}
        />
        {REGION_ORDER.map((r) => (
          <RegionChip
            key={r}
            label={REGION_LABELS[r]}
            count={counts.get(r) ?? 0}
            selected={region === r}
            onClick={() => setRegion(region === r ? undefined : r)}
          />
        ))}
      </div>

      {shown.length === 0 ? (
        <p className="rounded-lg border border-dashed border-bark-200 bg-bark-50 px-3 py-4 text-caption text-bark-600">
          Nothing here matches that. {POPULAR_DESTINATIONS.length} places is a
          shortlist, not an atlas.
        </p>
      ) : (
        sections.map((section) => (
          <section key={section.region ?? "all"} className="mb-4 last:mb-0">
            {section.region && (
              <h3 className="mb-1.5 flex items-baseline gap-2 text-micro text-bark-600 uppercase">
                <span>{REGION_LABELS[section.region]}</span>
                <span className="h-px flex-1 bg-bark-200" aria-hidden />
                <span className="text-bark-600">{section.items.length}</span>
              </h3>
            )}

            <ul className="grid grid-cols-1 gap-2 @md:grid-cols-2 @4xl:grid-cols-3">
              {section.items.map((destination) => (
                <li key={destination.place.id}>
                  <DestinationCard
                    destination={destination}
                    inTrip={alreadyListed(destination.place, knownPlaces)}
                    onSelect={onSelect}
                  />
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}

interface DestinationCardProps {
  destination: PopularDestination;
  inTrip: boolean;
  onSelect: (place: Place) => void;
}

/**
 * One card. The whole thing is the button — a card with a separate
 * "add" button inside it makes you aim at a 24px target when the
 * only thing you can do with the card is add it.
 *
 * Cards stay clickable when they're already in the trip: going back
 * to a city later in the same trip is a normal shape, not a mistake,
 * so the badge is information rather than a lock.
 */
function DestinationCard({
  destination,
  inTrip,
  onSelect,
}: DestinationCardProps) {
  const { place, hook } = destination;

  return (
    <button
      type="button"
      onClick={() => onSelect(place)}
      aria-label={`Add ${place.name}, ${countryName(place.country)}, to the trip`}
      className="group flex h-full w-full flex-col gap-1 rounded-xl border border-bark-200 bg-parchment p-3 text-left transition hover:border-ochre-300 hover:bg-ochre-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-moss-500"
    >
      <span className="flex items-baseline gap-2">
        <span className="min-w-0 flex-1 truncate text-body font-medium text-bark-900">
          {place.name}
        </span>
        {inTrip ? (
          <Check
            className="size-3.5 shrink-0 text-moss-600"
            aria-label="Already in trip"
          />
        ) : (
          <Plus
            className="size-3.5 shrink-0 text-bark-300 transition group-hover:text-ochre-600"
            aria-hidden
          />
        )}
      </span>

      {/*
        Country, not country plus region: the section heading above
        already said "Europe", and a card that repeats its own
        section is two words of noise on every row.
      */}
      <span className="truncate text-micro text-bark-600 uppercase">
        {countryName(place.country)}
        {inTrip ? " · In trip" : ""}
      </span>

      <span className="text-caption text-bark-600">{hook}</span>
    </button>
  );
}

interface RegionChipProps {
  label: string;
  count: number;
  selected: boolean;
  onClick: () => void;
}

function RegionChip({ label, count, selected, onClick }: RegionChipProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      // Disabled rather than hidden when a query empties a region:
      // chips that appear and vanish under your cursor as you type
      // are how you click the wrong one. Never the selected chip,
      // though — disabling it would trap you inside an empty region
      // with no way back to "Everywhere".
      disabled={count === 0 && !selected}
      className={`rounded-full border px-2.5 py-1 text-label transition focus:outline-none focus-visible:ring-2 focus-visible:ring-moss-500 disabled:cursor-not-allowed disabled:opacity-40 ${
        selected
          ? "border-moss-300 bg-moss-100 text-moss-700"
          : "border-bark-200 bg-parchment text-bark-600 hover:border-bark-300 hover:bg-bark-50"
      }`}
    >
      {label}
      <span className={selected ? "text-moss-600" : "text-bark-600"}>
        {" "}
        {count}
      </span>
    </button>
  );
}

function countByRegion(
  destinations: readonly PopularDestination[],
): Map<Continent, number> {
  const counts = new Map<Continent, number>();
  for (const { region } of destinations) {
    counts.set(region, (counts.get(region) ?? 0) + 1);
  }
  return counts;
}
