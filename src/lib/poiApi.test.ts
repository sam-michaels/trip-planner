import { describe, expect, it } from "vitest";

import type { Place } from "../model/trip";
import { coords } from "../model/trip";
import type { OverpassElement } from "./poiApi";
import { toActivitySuggestions, toStaySuggestions } from "./poiApi";

const lisbon: Place = {
  id: "lisbon",
  name: "Lisbon",
  city: "Lisbon",
  country: "PT",
  coords: coords(-9.1393, 38.7223),
};

describe("toStaySuggestions", () => {
  it("converts a node hotel, with coords in [lon, lat] order", () => {
    const el: OverpassElement = {
      type: "node",
      id: 1,
      lat: 38.71,
      lon: -9.14,
      tags: { name: "Hotel Lisboa", tourism: "hotel" },
    };

    const [suggestion] = toStaySuggestions([el], lisbon);

    expect(suggestion.type).toBe("hotel");
    expect(suggestion.place.name).toBe("Hotel Lisboa");
    expect(suggestion.place.id).toBe("osm-node-1");
    // Assert the actual numbers so a [lat, lon] swap fails this test.
    expect(suggestion.place.coords).toEqual([-9.14, 38.71]);
  });

  it("converts a way using `center` when there's no lat/lon", () => {
    const el: OverpassElement = {
      type: "way",
      id: 2,
      center: { lat: 38.72, lon: -9.15 },
      tags: { name: "Lisbon Hostel", tourism: "hostel" },
    };

    const [suggestion] = toStaySuggestions([el], lisbon);

    expect(suggestion.type).toBe("hostel");
    expect(suggestion.place.coords).toEqual([-9.15, 38.72]);
  });

  it("maps guest_house to the hotel StayType", () => {
    const el: OverpassElement = {
      type: "node",
      id: 3,
      lat: 38.71,
      lon: -9.14,
      tags: { name: "Casa Azul", tourism: "guest_house" },
    };

    expect(toStaySuggestions([el], lisbon)[0].type).toBe("hotel");
  });

  it("drops an element with no name", () => {
    const el: OverpassElement = {
      type: "node",
      id: 4,
      lat: 38.71,
      lon: -9.14,
      tags: { tourism: "hotel" },
    };

    expect(toStaySuggestions([el], lisbon)).toEqual([]);
  });

  it("drops an element with no resolvable coords", () => {
    const el: OverpassElement = {
      type: "way",
      id: 5,
      tags: { name: "Nowhere Inn", tourism: "hotel" },
    };

    expect(toStaySuggestions([el], lisbon)).toEqual([]);
  });

  it("drops an unmapped tourism tag", () => {
    const el: OverpassElement = {
      type: "node",
      id: 6,
      lat: 38.71,
      lon: -9.14,
      tags: { name: "Not A Stay", tourism: "zoo" },
    };

    expect(toStaySuggestions([el], lisbon)).toEqual([]);
  });

  it("inherits city and country from the passed city, never from the element", () => {
    const el: OverpassElement = {
      type: "node",
      id: 7,
      lat: 38.71,
      lon: -9.14,
      tags: { name: "Hotel Lisboa", tourism: "hotel" },
    };

    const [suggestion] = toStaySuggestions([el], lisbon);

    expect(suggestion.place.city).toBe("Lisbon");
    expect(suggestion.place.country).toBe("PT");
  });

  it("collapses duplicates by place id", () => {
    const el: OverpassElement = {
      type: "node",
      id: 8,
      lat: 38.71,
      lon: -9.14,
      tags: { name: "Hotel Lisboa", tourism: "hotel" },
    };

    expect(toStaySuggestions([el, el], lisbon)).toHaveLength(1);
  });

  it("orders results nearest to the city first", () => {
    const near: OverpassElement = {
      type: "node",
      id: 9,
      lat: 38.7224, // a hair from the city centre
      lon: -9.1394,
      tags: { name: "Near Hotel", tourism: "hotel" },
    };
    const far: OverpassElement = {
      type: "node",
      id: 10,
      lat: 39.5, // well north
      lon: -9.1393,
      tags: { name: "Far Hotel", tourism: "hotel" },
    };

    const results = toStaySuggestions([far, near], lisbon);

    expect(results.map((r) => r.place.name)).toEqual(["Near Hotel", "Far Hotel"]);
  });
});

describe("toActivitySuggestions", () => {
  const at = (id: number, tags: Record<string, string>): OverpassElement => ({
    type: "node",
    id,
    lat: 38.71,
    lon: -9.14,
    tags,
  });

  it("maps tourism=museum to the museum category", () => {
    const el = at(20, { name: "Museu Nacional", tourism: "museum" });
    expect(toActivitySuggestions([el], lisbon)[0].category).toBe("museum");
  });

  it("maps attraction/viewpoint/artwork/historic to the sight category", () => {
    const attraction = at(21, { name: "Belem Tower", tourism: "attraction" });
    const viewpoint = at(22, { name: "Miradouro", tourism: "viewpoint" });
    const artwork = at(23, { name: "Street Mural", tourism: "artwork" });
    const historic = at(24, { name: "Castelo", historic: "castle" });

    const results = toActivitySuggestions([attraction, viewpoint, artwork, historic], lisbon);

    expect(results.every((r) => r.category === "sight")).toBe(true);
    expect(results).toHaveLength(4);
  });

  it("maps restaurant/cafe to the food category", () => {
    const restaurant = at(25, { name: "Cervejaria", amenity: "restaurant" });
    const cafe = at(26, { name: "Cafe Central", amenity: "cafe" });

    const results = toActivitySuggestions([restaurant, cafe], lisbon);

    expect(results.every((r) => r.category === "food")).toBe(true);
    expect(results).toHaveLength(2);
  });

  it("maps leisure=park/natural=* to the outdoor category", () => {
    const park = at(27, { name: "Parque Eduardo VII", leisure: "park" });
    const beach = at(28, { name: "Praia", natural: "beach" });

    const results = toActivitySuggestions([park, beach], lisbon);

    expect(results.every((r) => r.category === "outdoor")).toBe(true);
    expect(results).toHaveLength(2);
  });

  it("drops an unmapped tag combination", () => {
    const el = at(29, { name: "Random Shop", shop: "convenience" });
    expect(toActivitySuggestions([el], lisbon)).toEqual([]);
  });
});

describe("tag lookup is not a prototype walk", () => {
  // OSM tag values are arbitrary strings from a public, editable
  // database, so the lookup table is indexed with untrusted input.
  // `STAY_TAGS` was a plain object, and every one of these names
  // resolves on `Object.prototype` to something truthy — which sailed
  // past the "unmapped, drop it" guard and produced a row whose `type`
  // was a function, rendering a blank chip.
  for (const value of ["constructor", "toString", "valueOf", "hasOwnProperty"]) {
    it(`drops tourism=${value} rather than inheriting it`, () => {
      const el: OverpassElement = {
        type: "node",
        id: 99,
        lat: 38.71,
        lon: -9.14,
        tags: { name: "Not A Hotel", tourism: value },
      };

      expect(toStaySuggestions([el], lisbon)).toEqual([]);
    });
  }
});

describe("relations", () => {
  // The converters are type-agnostic and must stay that way even though
  // the query builders currently ask for nodes and ways only — asking
  // for relations too costs half again as many index lookups per clause
  // (see poiApi.ts's measurement table), and that trade could reverse
  // on a faster Overpass instance. The conversion side should not have
  // to change if it does.
  it("converts a relation via its center, like a way", () => {
    const el: OverpassElement = {
      type: "relation",
      id: 7,
      center: { lat: 38.73, lon: -9.16 },
      tags: { name: "Parque Eduardo VII", leisure: "park" },
    };

    const [suggestion] = toActivitySuggestions([el], lisbon);

    expect(suggestion.category).toBe("outdoor");
    expect(suggestion.place.id).toBe("osm-relation-7");
    expect(suggestion.place.coords).toEqual([-9.16, 38.73]);
  });
});
