// ============================================================
// Somewhere to start when you don't have a "where" yet.
//
// The rest of the app assumes you already know your next place —
// a leg needs two endpoints before it means anything. This file is
// for the moment before that: an empty search box in front of
// someone who hasn't decided, which is the point where most trip
// planners quietly give up on you. A curated, browsable set of
// destinations gives them something to react to instead — "not
// that one, but something like it" is a much easier thought to have
// than "type a city name into a blank field."
//
// WHY STATIC AND CURATED, NOT AN API: "popular" is an editorial
// judgement, not a metric you can fetch — and a hand-picked list can
// be paired with a hand-written reason to go, which is the whole
// value of the browse. A places API gives you a name and a pin; it
// doesn't tell you why Split is worth the flight.
//
// WHY SPREAD ACROSS CONTINENTS ON PURPOSE: a browse that's forty
// European capitals just relocates the blank-box problem one level
// up. `region` exists so the UI can show a genuine spread rather than
// whatever came to mind first — see `byRegion` below.
// ============================================================

import type { Place } from "../model/trip";
import { coords } from "../model/trip";
import { continentOf, type Continent } from "./geo";

export interface PopularDestination {
  place: Place;
  /** One line of why you'd go. Shown on the inspiration card. */
  hook: string;
  /** Broad grouping so the browse UI can filter or section. */
  region: Continent;
}

/**
 * `region` isn't hand-typed per entry below: it's derived from
 * `continentOf(place.country)`, the same lookup `geo.ts` uses to
 * decide overland routing. Hand-maintaining a second copy next to
 * `country` would just be a mismatch waiting to happen — add a
 * destination, get the country right, typo the continent, and
 * `byRegion` quietly misfiles it with nothing to catch it.
 */
const RAW_DESTINATIONS: Array<{ place: Place; hook: string }> = [
  // ---------- Europe ----------
  {
    place: {
      id: "pop-lisbon",
      name: "Lisbon",
      city: "Lisbon",
      country: "PT",
      coords: coords(-9.1393, 38.7223),
    },
    hook: "Tram 28, tiled façades, and a river that looks like the sea.",
  },
  {
    place: {
      id: "pop-porto",
      name: "Porto",
      city: "Porto",
      country: "PT",
      coords: coords(-8.6291, 41.1579),
    },
    hook: "Port wine cellars across the river, and a bridge Eiffel's office actually built.",
  },
  {
    place: {
      id: "pop-seville",
      name: "Seville",
      city: "Seville",
      country: "ES",
      coords: coords(-5.9845, 37.3891),
    },
    hook: "Orange trees on every street and a cathedral tower you can ride a horse up.",
  },
  {
    place: {
      id: "pop-madrid",
      name: "Madrid",
      city: "Madrid",
      country: "ES",
      coords: coords(-3.7038, 40.4168),
    },
    hook: "Dinner starts at eleven and the museums still beat you to the queue.",
  },
  {
    place: {
      id: "pop-barcelona",
      name: "Barcelona",
      city: "Barcelona",
      country: "ES",
      coords: coords(2.1686, 41.3874),
    },
    hook: "Gaudí left the city unfinished on purpose, and it's still being built.",
  },
  {
    place: {
      id: "pop-rome",
      name: "Rome",
      city: "Rome",
      country: "IT",
      coords: coords(12.4964, 41.9028),
    },
    hook: "Ruins you'd fence off anywhere else are just the traffic island here.",
  },
  {
    place: {
      id: "pop-paris",
      name: "Paris",
      city: "Paris",
      country: "FR",
      coords: coords(2.3522, 48.8566),
    },
    hook: "Every arrondissement insists it's the real Paris. They're all right.",
  },
  {
    place: {
      id: "pop-amsterdam",
      name: "Amsterdam",
      city: "Amsterdam",
      country: "NL",
      coords: coords(4.9041, 52.3676),
    },
    hook: "Bicycles have the right of way, and everyone else learns that quickly.",
  },
  {
    place: {
      id: "pop-prague",
      name: "Prague",
      city: "Prague",
      country: "CZ",
      coords: coords(14.4378, 50.0755),
    },
    hook: "A castle on the hill and a clock tower that still draws a crowd on the hour.",
  },
  {
    place: {
      id: "pop-athens",
      name: "Athens",
      city: "Athens",
      country: "GR",
      coords: coords(23.7275, 37.9838),
    },
    hook: "The Acropolis is visible from most rooftop bars, which is either convenient or showing off.",
  },
  {
    place: {
      id: "pop-split",
      name: "Split",
      city: "Split",
      country: "HR",
      coords: coords(16.4402, 43.5081),
    },
    hook: "A Roman emperor's retirement palace, and people still live inside its walls.",
  },
  {
    place: {
      id: "pop-reykjavik",
      name: "Reykjavik",
      city: "Reykjavik",
      country: "IS",
      coords: coords(-21.9426, 64.1466),
    },
    hook: "A small city that treats the northern lights as a scheduling problem.",
  },

  // ---------- Africa ----------
  {
    place: {
      id: "pop-marrakesh",
      name: "Marrakesh",
      city: "Marrakesh",
      country: "MA",
      coords: coords(-7.9811, 31.6295),
    },
    hook: "The Jemaa el-Fnaa is a different market at dusk than it was at noon.",
  },
  {
    place: {
      id: "pop-tangier",
      name: "Tangier",
      city: "Tangier",
      country: "MA",
      coords: coords(-5.834, 35.7595),
    },
    hook: "Two continents close enough to see, a ferry ride away from either.",
  },
  {
    place: {
      id: "pop-casablanca",
      name: "Casablanca",
      city: "Casablanca",
      country: "MA",
      coords: coords(-7.5898, 33.5731),
    },
    hook: "Not the movie — a working port city that never asked to be famous.",
  },
  {
    place: {
      id: "pop-essaouira",
      name: "Essaouira",
      city: "Essaouira",
      country: "MA",
      coords: coords(-9.7595, 31.5085),
    },
    hook: "Fishing boats, sea ramparts, and wind steady enough to have its own surf shops.",
  },
  {
    place: {
      id: "pop-cairo",
      name: "Cairo",
      city: "Cairo",
      country: "EG",
      coords: coords(31.2357, 30.0444),
    },
    hook: "Traffic that defies description, and pyramids at the edge of the suburbs.",
  },
  {
    place: {
      id: "pop-cape-town",
      name: "Cape Town",
      city: "Cape Town",
      country: "ZA",
      coords: coords(18.4241, -33.9249),
    },
    hook: "A mountain in the middle of the city, and penguins twenty minutes down the coast.",
  },
  {
    place: {
      id: "pop-nairobi",
      name: "Nairobi",
      city: "Nairobi",
      country: "KE",
      coords: coords(36.8219, -1.2921),
    },
    hook: "A national park with lions borders the airport's approach path.",
  },
  {
    place: {
      id: "pop-zanzibar-city",
      name: "Zanzibar City",
      city: "Zanzibar City",
      country: "TZ",
      coords: coords(39.2026, -6.1659),
    },
    hook: "Stone Town's alleys were laid out to confuse anyone who wasn't already a local.",
  },

  // ---------- Asia ----------
  {
    place: {
      id: "pop-tokyo",
      name: "Tokyo",
      city: "Tokyo",
      country: "JP",
      coords: coords(139.6503, 35.6762),
    },
    hook: "Centuries-old shrines wedged between vending machines and a train map that takes a week to parse.",
  },
  {
    place: {
      id: "pop-kyoto",
      name: "Kyoto",
      city: "Kyoto",
      country: "JP",
      coords: coords(135.7681, 35.0116),
    },
    hook: "A thousand temples and the quiet realisation you won't see them all.",
  },
  {
    place: {
      id: "pop-bangkok",
      name: "Bangkok",
      city: "Bangkok",
      country: "TH",
      coords: coords(100.5018, 13.7563),
    },
    hook: "Street food that outclasses the restaurant three doors down, at a third the price.",
  },
  {
    place: {
      id: "pop-singapore",
      name: "Singapore",
      city: "Singapore",
      country: "SG",
      coords: coords(103.8198, 1.3521),
    },
    hook: "A rainforest, a financial district, and a hawker centre, all one MRT ride apart.",
  },
  {
    place: {
      id: "pop-istanbul",
      name: "Istanbul",
      city: "Istanbul",
      country: "TR",
      coords: coords(28.9784, 41.0082),
    },
    hook: "Breakfast on one continent, ferry across, dinner on another.",
  },
  {
    place: {
      id: "pop-hanoi",
      name: "Hanoi",
      city: "Hanoi",
      country: "VN",
      coords: coords(105.8542, 21.0285),
    },
    hook: "Motorbikes outnumber people, and somehow everyone still gets where they're going.",
  },
  {
    place: {
      id: "pop-seoul",
      name: "Seoul",
      city: "Seoul",
      country: "KR",
      coords: coords(126.978, 37.5665),
    },
    hook: "Palaces, PC bangs, and a subway map with more lines than most visitors ever memorise.",
  },
  {
    place: {
      id: "pop-jaipur",
      name: "Jaipur",
      city: "Jaipur",
      country: "IN",
      coords: coords(75.7873, 26.9124),
    },
    hook: "The Pink City, a fort on every ridge, and a palace that floats on a lake nearby.",
  },
  {
    place: {
      id: "pop-ubud",
      name: "Ubud",
      city: "Ubud",
      country: "ID",
      coords: coords(115.2625, -8.5069),
    },
    hook: "Rice terraces, a monkey forest, and a slower clock than the rest of Bali runs on.",
  },

  // ---------- North America ----------
  {
    place: {
      id: "pop-mexico-city",
      name: "Mexico City",
      city: "Mexico City",
      country: "MX",
      coords: coords(-99.1332, 19.4326),
    },
    hook: "More museums than you'll get through, and tacos better than any of them.",
  },
  {
    place: {
      id: "pop-new-york",
      name: "New York",
      city: "New York",
      country: "US",
      coords: coords(-74.006, 40.7128),
    },
    hook: "Whatever you came for, there's a subway line that gets you closer.",
  },
  {
    place: {
      id: "pop-new-orleans",
      name: "New Orleans",
      city: "New Orleans",
      country: "US",
      coords: coords(-90.0715, 29.9511),
    },
    hook: "A brass band on one corner and a funeral procession on the next, and sometimes it's the same thing.",
  },
  {
    place: {
      id: "pop-vancouver",
      name: "Vancouver",
      city: "Vancouver",
      country: "CA",
      coords: coords(-123.1207, 49.2827),
    },
    hook: "Ski slope and ocean, visible from the same downtown block.",
  },

  // ---------- South America ----------
  {
    place: {
      id: "pop-rio-de-janeiro",
      name: "Rio de Janeiro",
      city: "Rio de Janeiro",
      country: "BR",
      coords: coords(-43.1729, -22.9068),
    },
    hook: "A statue on one mountain, a favela view from another, and the beach in between.",
  },
  {
    place: {
      id: "pop-buenos-aires",
      name: "Buenos Aires",
      city: "Buenos Aires",
      country: "AR",
      coords: coords(-58.3816, -34.6037),
    },
    hook: "Steak, tango on the pavement, and a bookstore that used to be a theatre.",
  },
  {
    place: {
      id: "pop-lima",
      name: "Lima",
      city: "Lima",
      country: "PE",
      coords: coords(-77.0428, -12.0464),
    },
    hook: "Grey coastal fog and a food scene serious enough to have its own pilgrims.",
  },
  {
    place: {
      id: "pop-cartagena",
      name: "Cartagena",
      city: "Cartagena",
      country: "CO",
      coords: coords(-75.4794, 10.391),
    },
    hook: "A walled old town, Caribbean heat, and balconies dripping with bougainvillea.",
  },

  // ---------- Oceania ----------
  {
    place: {
      id: "pop-sydney",
      name: "Sydney",
      city: "Sydney",
      country: "AU",
      coords: coords(151.2093, -33.8688),
    },
    hook: "A harbour that photographs better than any postcard admits.",
  },
  {
    place: {
      id: "pop-queenstown",
      name: "Queenstown",
      city: "Queenstown",
      country: "NZ",
      coords: coords(168.6626, -45.0312),
    },
    hook: "Bungee jumping was invented here, which tells you something about the terrain.",
  },
  {
    place: {
      id: "pop-nadi",
      name: "Nadi",
      city: "Nadi",
      country: "FJ",
      coords: coords(177.4356, -17.7765),
    },
    hook: "A gateway to islands where the ferry schedule is a suggestion, not a promise.",
  },
];

/**
 * ~40 destinations, picked for a genuine global spread rather than
 * ranked by any real popularity metric. Includes the places that
 * anchor the app's own motivating trip (Iberia, Morocco) alongside
 * cities across every inhabited continent.
 */
export const POPULAR_DESTINATIONS: PopularDestination[] = RAW_DESTINATIONS.map(
  (destination) => {
    const region = continentOf(destination.place.country);

    // Every entry above is real, so an unmapped country code means
    // the entry or `CONTINENT_MEMBERS` in geo.ts has a typo — better
    // to fail loudly at import time than to silently drop a
    // destination from every `byRegion` section.
    if (!region) {
      throw new Error(
        `popularDestinations: no continent for country "${destination.place.country}" (${destination.place.name})`,
      );
    }

    return { ...destination, region };
  },
);

/** All entries in one continent, in list order. */
export function byRegion(region: Continent): PopularDestination[] {
  return POPULAR_DESTINATIONS.filter((d) => d.region === region);
}

/**
 * Loose text match over name/city/country/hook, for a browse search
 * box. Not fuzzy — this is ~40 rows, not a search index, and a
 * simple substring match is enough to let someone type "port" and
 * get Porto without them noticing there's no ranking underneath it.
 */
export function searchPopular(query: string): PopularDestination[] {
  const q = query.trim().toLowerCase();
  if (!q) return POPULAR_DESTINATIONS;

  return POPULAR_DESTINATIONS.filter(({ place, hook }) =>
    [place.name, place.city, place.country, hook].some((field) =>
      field.toLowerCase().includes(q),
    ),
  );
}
