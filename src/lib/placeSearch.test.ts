import { describe, expect, it } from "vitest";

import type { Place } from "../model/trip";
import { coords } from "../model/trip";
import { alreadyListed, placeMatches, samePlace } from "./placeSearch";
import { POPULAR_DESTINATIONS, searchPopular } from "./popularDestinations";

const lisbon: Place = {
  id: "pop-lisbon",
  name: "Lisbon",
  city: "Lisbon",
  country: "PT",
  coords: coords(-9.1393, 38.7223),
};

/** Same city, different source: different id, different spelling. */
const lisboa: Place = {
  id: "osm-4521",
  name: "Lisboa",
  city: "Lisboa",
  country: "PT",
  coords: coords(-9.1427, 38.7167),
};

const lisbonAirport: Place = {
  id: "apt-lis",
  name: "Humberto Delgado Airport",
  city: "Lisbon",
  country: "PT",
  coords: coords(-9.1359, 38.7813),
  iata: "LIS",
};

const porto: Place = {
  id: "pop-porto",
  name: "Porto",
  city: "Porto",
  country: "PT",
  coords: coords(-8.6291, 41.1579),
};

describe("placeMatches", () => {
  it("matches on name, city and country, case-insensitively", () => {
    expect(placeMatches(lisbon, "lis")).toBe(true);
    expect(placeMatches(lisbonAirport, "LISBON")).toBe(true);
    expect(placeMatches(lisbon, "pt")).toBe(true);
    expect(placeMatches(lisbon, "berlin")).toBe(false);
  });

  it("ignores surrounding whitespace", () => {
    expect(placeMatches(lisbon, "  lisbon  ")).toBe(true);
  });

  it("treats an empty query as matching everything", () => {
    // Both callers rely on this: an unfiltered picker shows the whole
    // trip, an unfiltered browse shows the whole curated list.
    expect(placeMatches(lisbon, "")).toBe(true);
    expect(placeMatches(lisbon, "   ")).toBe(true);
  });

  it("matches an IATA code exactly, not as a substring", () => {
    expect(placeMatches(lisbonAirport, "lis")).toBe(true);
    // "IS" would substring-match "LIS"; an airport has no business
    // turning up in a search for Israel.
    expect(placeMatches(porto, "is")).toBe(false);
  });

  it("matches the country's name as well as its code", () => {
    // What's on screen is "Portugal"; a search that only knew "PT"
    // would hide the card whose own subtitle you just typed.
    expect(placeMatches(lisbon, "portugal")).toBe(true);
    expect(placeMatches(lisbon, "pt")).toBe(true);
  });

  it("searches extra fields when given them", () => {
    const hook = "Tram 28, tiled façades, and a river that looks like the sea.";
    expect(placeMatches(lisbon, "tram", [hook])).toBe(true);
    expect(placeMatches(lisbon, "tram")).toBe(false);
  });
});

describe("searchPopular", () => {
  it("returns everything for an empty query", () => {
    expect(searchPopular("")).toHaveLength(POPULAR_DESTINATIONS.length);
    expect(searchPopular("  ")).toHaveLength(POPULAR_DESTINATIONS.length);
  });

  it("finds a city by a fragment of its name", () => {
    expect(searchPopular("port").map((d) => d.place.name)).toContain("Porto");
  });

  it("finds a city by what its hook says about it", () => {
    // The whole reason the hook is searched: nobody types "Cape Town"
    // when what they want is penguins.
    expect(searchPopular("penguins").map((d) => d.place.name)).toEqual([
      "Cape Town",
    ]);
  });

  it("finds cities by the country name the cards display", () => {
    expect(searchPopular("portugal").map((d) => d.place.name)).toEqual([
      "Lisbon",
      "Porto",
    ]);
  });

  it("returns nothing for a query nothing matches", () => {
    expect(searchPopular("zzzzz")).toHaveLength(0);
  });
});

describe("samePlace", () => {
  it("treats two spellings of one city as the same place", () => {
    expect(samePlace(lisbon, lisboa)).toBe(true);
  });

  it("treats a city and its airport as the same destination", () => {
    expect(samePlace(lisbon, lisbonAirport)).toBe(true);
  });

  it("keeps genuinely separate cities separate", () => {
    expect(samePlace(lisbon, porto)).toBe(false);
  });

  it("keeps every curated destination distinct from every other", () => {
    // If two entries ever collided, one of them would be permanently
    // badged "in trip" the moment the other was added.
    const collisions = POPULAR_DESTINATIONS.flatMap((a, i) =>
      POPULAR_DESTINATIONS.slice(i + 1)
        .filter((b) => samePlace(a.place, b.place))
        .map((b) => `${a.place.name}/${b.place.name}`),
    );

    expect(collisions).toEqual([]);
  });
});

describe("alreadyListed", () => {
  it("is false against an empty list", () => {
    expect(alreadyListed(lisbon, [])).toBe(false);
  });

  it("finds a near-duplicate under a different id", () => {
    expect(alreadyListed(lisboa, [porto, lisbon])).toBe(true);
  });
});
