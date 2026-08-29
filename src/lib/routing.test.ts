// ============================================================
// What these tests are actually protecting.
//
// The route engine's output is a chain of places, and almost every
// way it can go wrong is silent: an airport on the wrong continent, a
// chain that doesn't join up, a flight proposed for a 270km train
// ride. None of those throw — they just produce an itinerary that
// looks plausible until you try to book it. So the assertions here
// are mostly about SHAPE (does the chain join end to end, does the
// key match what `deriveLegs` will ask for) and about the two
// judgement calls that would be embarrassing to get wrong: London
// Ontario to Lisbon must go through a real intercontinental hub, and
// Lisbon to Porto must stay on the ground.
//
// Every test injects `findAirports`, and most inject one that throws.
// That is not just for speed: it pins down a property worth keeping —
// the motivating trip routes entirely out of the curated hub table,
// with no network at all.
// ============================================================

import { describe, expect, it } from "vitest";

import type { Place, RouteHop, Trip } from "../model/trip";
import {
  coords,
  deriveLegs,
  findGaps,
  hopId,
  sampleTrip,
} from "../model/trip";
import { defaultMode } from "../itinerary/plausibleModes";
import {
  buildRouteMap,
  pickRoutes,
  proposeRoutes,
  proposeTripRoutes,
  type RouteOption,
} from "./routing";

// The trip the whole app is built against, taken from the model rather
// than retyped — a copy here would drift the day someone edits it.
const LONDON_ON = sampleTrip.origin;
const LISBON = sampleTrip.destinations[0].place;
const PORTO = sampleTrip.destinations[1].place;

const place = (
  id: string,
  city: string,
  country: string,
  lng: number,
  lat: number,
): Place => ({ id, name: city, city, country, coords: coords(lng, lat) });

const ALGECIRAS = place("algeciras", "Algeciras", "ES", -5.4526, 36.1408);
const TANGIER = place("tangier", "Tangier", "MA", -5.834, 35.7595);
const SEVILLE = place("seville", "Seville", "ES", -5.9845, 37.3891);
const MARRAKESH = place("marrakesh", "Marrakesh", "MA", -8.0083, 31.6295);
const MADRID = place("madrid", "Madrid", "ES", -3.7038, 40.4168);
const BERLIN = place("berlin", "Berlin", "DE", 13.405, 52.52);
// Deliberately somewhere the curated table doesn't reach: the nearest
// hub is Montreal, 1,500km away.
const IQALUIT = place("iqaluit", "Iqaluit", "CA", -68.517, 63.7467);

/** Asserts the engine never touched the network for this pair. */
const noNetworkNeeded = {
  findAirports: async (): Promise<Place[]> => {
    throw new Error("the curated hub table should have answered this");
  },
};

/** Berlin has no curated hub, so it only routes with the live dataset. */
const findsBrandenburg = {
  findAirports: async (near: [number, number]): Promise<Place[]> => {
    const ber: Place = {
      ...place("apt-ber", "Berlin", "DE", 13.5033, 52.3667),
      name: "Berlin Brandenburg",
      iata: "BER",
    };
    // Only near Berlin; Madrid is answered by the hub table.
    return Math.abs(near[0] - 13.5) < 1 ? [ber] : [];
  },
};

const modesOf = (hops: RouteHop[]) => hops.map((hop) => hop.mode);
const idsOf = (options: RouteOption[]) => options.map((option) => option.id);

/** The invariant every consumer depends on: the chain joins up. */
function expectJoinedChain(option: RouteOption, from: Place, to: Place) {
  expect(option.hops.length, option.id).toBeGreaterThan(0);
  expect(option.hops[0].from.id, option.id).toBe(from.id);
  expect(option.hops.at(-1)!.to.id, option.id).toBe(to.id);

  for (let i = 0; i < option.hops.length - 1; i++) {
    expect(option.hops[i].to.id, `${option.id} hop ${i}`).toBe(
      option.hops[i + 1].from.id,
    );
  }
}

describe("proposeRoutes — the motivating trip", () => {
  it("routes London Ontario to Lisbon through a real intercontinental hub", async () => {
    const [best, ...rest] = await proposeRoutes(
      LONDON_ON,
      LISBON,
      noNetworkNeeded,
    );

    // city → origin airport → destination airport → city
    expect(modesOf(best.hops)).toEqual(["train", "flight", "train"]);
    expectJoinedChain(best, LONDON_ON, LISBON);

    const [toAirport, flight, fromAirport] = best.hops;
    expect(flight.from.iata).toBe("YYZ");
    expect(flight.to.iata).toBe("LIS");

    // The two ends are the parts people forget to plan, and they are
    // ground transfers, not more flying.
    expect(toAirport.to.id).toBe("apt-yyz");
    expect(fromAirport.from.id).toBe("apt-lis");

    // Nothing nearer London ON is a competitive alternative — Chicago
    // and Montreal are both 600km+ away — so one option is the honest
    // answer here.
    expect(rest).toEqual([]);
  });

  it("keeps Lisbon to Porto on the ground", async () => {
    const options = await proposeRoutes(LISBON, PORTO, noNetworkNeeded);

    expect(options[0].hops).toHaveLength(1);
    expect(options[0].hops[0].mode).toBe("train");
    expectJoinedChain(options[0], LISBON, PORTO);

    // 274km in one country: a three-hop air chain here would be a bug,
    // not an option, and it should not appear anywhere in the list.
    for (const option of options) {
      expect(modesOf(option.hops), option.id).not.toContain("flight");
    }

    // The alternative worth offering is the bus, not a flight.
    expect(idsOf(options)).toEqual(["ground-train", "ground-bus"]);
  });

  it("labels a curated hub by its city and a fetched airport by its name", async () => {
    const [hubRoute] = await proposeRoutes(LONDON_ON, LISBON, noNetworkNeeded);
    expect(hubRoute.label).toBe("Fly Toronto (YYZ) → Lisbon (LIS)");

    // OurAirports would call Berlin Brandenburg's municipality
    // something local; the airport's own name is the recognisable half.
    const [fetchedRoute] = await proposeRoutes(MADRID, BERLIN, {
      findAirports: async (near) =>
        Math.abs(near[0] - 13.5) < 1
          ? [
              {
                ...place("apt-ber", "Schönefeld", "DE", 13.5033, 52.3667),
                name: "Berlin Brandenburg Airport",
                iata: "BER",
              },
            ]
          : [],
    });
    expect(fetchedRoute.label).toBe(
      "Fly Madrid (MAD) → Berlin Brandenburg Airport (BER)",
    );
  });

  it("invents no cost and no operator", async () => {
    const options = await proposeRoutes(LONDON_ON, LISBON, noNetworkNeeded);

    for (const hop of options.flatMap((option) => option.hops)) {
      expect(hop.cost).toBeUndefined();
      expect(hop.operator).toBeUndefined();
    }
  });
});

describe("proposeRoutes — choosing between ground and air", () => {
  it("offers a short sea crossing as a ferry, with no air chain", async () => {
    const options = await proposeRoutes(ALGECIRAS, TANGIER, noNetworkNeeded);

    expect(options[0].hops).toHaveLength(1);
    expect(options[0].hops[0].mode).toBe("ferry");
    // 55km: no airport is anywhere near the transfer budget for a hop
    // that short, so flying is not on the table.
    expect(idsOf(options)).toEqual(["ground-ferry"]);
  });

  it("leads with the flight when the strait is in the way", async () => {
    // 670km — under the distance that would justify an air chain
    // overland, but the ferry lands 300km from Marrakesh.
    const options = await proposeRoutes(SEVILLE, MARRAKESH, noNetworkNeeded);

    expect(modesOf(options[0].hops)).toEqual(["train", "flight", "train"]);
    expect(options[0].hops[1].from.iata).toBe("SVQ");
    expect(options[0].hops[1].to.iata).toBe("RAK");
    // The ferry survives as an alternative rather than being ruled out.
    expect(idsOf(options)).toContain("ground-ferry");
  });

  it("proposes no air chain for a short overland pair", async () => {
    // ~500km, one land border: a train, and nothing else worth saying.
    const options = await proposeRoutes(LISBON, MADRID, noNetworkNeeded);

    for (const option of options) {
      expect(option.hops, option.id).toHaveLength(1);
    }
    expect(idsOf(options)).toEqual(["ground-train", "ground-bus"]);
  });

  it("leads with the flight on a long overland pair, keeping the train", async () => {
    // Madrid to Berlin is 1,870km. The train exists; almost nobody
    // takes it.
    const options = await proposeRoutes(MADRID, BERLIN, findsBrandenburg);

    expect(modesOf(options[0].hops)).toEqual(["train", "flight", "train"]);
    expect(options[0].hops[1].from.iata).toBe("MAD");
    expect(options[0].hops[1].to.iata).toBe("BER");
    expect(idsOf(options)).toContain("ground-train");
  });

  it("returns nothing for a place repeated back to back", async () => {
    expect(await proposeRoutes(LISBON, LISBON, noNetworkNeeded)).toEqual([]);
  });

  it("joins every option end to end, whichever pair it is asked for", async () => {
    const pairs: [Place, Place][] = [
      [LONDON_ON, LISBON],
      [LISBON, PORTO],
      [SEVILLE, MARRAKESH],
      [ALGECIRAS, TANGIER],
      [MADRID, BERLIN],
    ];

    for (const [from, to] of pairs) {
      for (const option of await proposeRoutes(from, to, findsBrandenburg)) {
        expectJoinedChain(option, from, to);
      }
    }
  });
});

describe("proposeRoutes — degrading rather than throwing", () => {
  const failing = {
    findAirports: async (): Promise<Place[]> => {
      throw new Error("network down");
    },
  };

  it("falls back to a placeholder when it cannot resolve any airport", async () => {
    const options = await proposeRoutes(IQALUIT, LISBON, failing);

    expect(options).toHaveLength(1);
    expect(options[0].provisional).toBe(true);
    expect(options[0].hops).toHaveLength(1);
    // Still moded by geography, so the map great-circles it rather
    // than drawing a car across the Atlantic.
    expect(options[0].hops[0].mode).toBe("flight");
  });

  it("refuses an airport nobody could reach overland", async () => {
    // Found live, and the reason `MAX_TRANSFER_KM` is a hard ceiling:
    // Nuuk is the nearest big airport to Iqaluit, 1,000km away across
    // the Davis Strait — and the continent table puts both on the same
    // landmass, so the transfer to it came out as a TRAIN. Better to
    // admit the route is unknown.
    const nuuk: Place = {
      ...place("apt-goh", "Nuuk", "GL", -51.6781, 64.1909),
      name: "Nuuk International Airport",
      iata: "GOH",
    };

    const options = await proposeRoutes(IQALUIT, LISBON, {
      findAirports: async () => [nuuk],
    });

    expect(options).toHaveLength(1);
    expect(options[0].provisional).toBe(true);
    expect(
      options.flatMap((option) => option.hops).map((hop) => hop.to.id),
    ).not.toContain("apt-goh");
  });

  it("still finds the ground route when the airport lookup fails", async () => {
    const options = await proposeRoutes(MADRID, BERLIN, failing);

    expect(options.length).toBeGreaterThan(0);
    expect(idsOf(options)).toContain("ground-train");
    for (const option of options) {
      expect(modesOf(option.hops), option.id).not.toContain("flight");
    }
  });

  it("leaves an unroutable pair out of the map so findGaps sees it", async () => {
    const trip: Trip = {
      ...sampleTrip,
      origin: IQALUIT,
      destinations: [sampleTrip.destinations[0]],
    };

    const routes = await buildRouteMap(trip, failing);

    expect(routes.size).toBe(0);
    expect(findGaps(trip, routes).map((gap) => gap.hop)).toEqual([
      hopId(IQALUIT, LISBON),
    ]);
  });
});

describe("buildRouteMap", () => {
  it("keys routes by consecutive destination pairs", async () => {
    const routes = await buildRouteMap(sampleTrip, noNetworkNeeded);

    expect([...routes.keys()]).toEqual([
      hopId(LONDON_ON, LISBON),
      hopId(LISBON, PORTO),
    ]);
    expect(findGaps(sampleTrip, routes)).toEqual([]);
  });

  it("feeds deriveLegs the itinerary the trip is actually about", async () => {
    const routes = await buildRouteMap(sampleTrip, noNetworkNeeded);
    const legs = deriveLegs(sampleTrip, routes, defaultMode);

    expect(
      legs.map((leg) => [leg.from.id, leg.to.id, leg.mode]),
    ).toEqual([
      ["yxu-city", "apt-yyz", "train"],
      ["apt-yyz", "apt-lis", "flight"],
      ["apt-lis", "lisbon", "train"],
      ["lisbon", "porto", "train"],
    ]);

    // The individual hop ids are the second key space: an override on
    // the airport transfer must not touch the transatlantic flight.
    expect(legs.map((leg) => leg.id)).toEqual([
      "yxu-city->apt-yyz",
      "apt-yyz->apt-lis",
      "apt-lis->lisbon",
      "lisbon->porto",
    ]);
    expect(legs.every((leg) => leg.status === "idea")).toBe(true);
  });

  it("honours a hop override laid on one hop of a derived chain", async () => {
    const trip: Trip = {
      ...sampleTrip,
      hopOverrides: {
        [hopId(LONDON_ON, { ...LONDON_ON, id: "apt-yyz" })]: {
          mode: "bus",
          operator: "Robert Q",
        },
      },
    };

    const legs = deriveLegs(
      trip,
      await buildRouteMap(trip, noNetworkNeeded),
      defaultMode,
    );

    expect(legs[0].mode).toBe("bus");
    expect(legs[0].operator).toBe("Robert Q");
    // ...and the flight it connects to is untouched.
    expect(legs[1].mode).toBe("flight");
    expect(legs[1].operator).toBeUndefined();
  });

  it("routes a repeated pair once", async () => {
    const trip: Trip = {
      ...sampleTrip,
      destinations: [
        ...sampleTrip.destinations,
        { id: "dest-lisbon-2", place: LISBON, status: "idea" },
        { id: "dest-porto-2", place: PORTO, status: "idea" },
      ],
    };

    const routes = await buildRouteMap(trip, noNetworkNeeded);

    // origin→Lisbon, Lisbon→Porto, Porto→Lisbon — the second
    // Lisbon→Porto is the same journey and keys to the same entry.
    expect(routes.size).toBe(3);
    expect(routes.has(hopId(PORTO, LISBON))).toBe(true);
  });

  it("skips a destination repeated back to back", async () => {
    const trip: Trip = {
      ...sampleTrip,
      destinations: [
        sampleTrip.destinations[0],
        { id: "dest-lisbon-again", place: LISBON, status: "idea" },
      ],
    };

    const routes = await buildRouteMap(trip, noNetworkNeeded);
    expect([...routes.keys()]).toEqual([hopId(LONDON_ON, LISBON)]);
  });

  it("returns an empty map for a trip with no destinations", async () => {
    const trip: Trip = { ...sampleTrip, destinations: [] };
    expect((await buildRouteMap(trip, noNetworkNeeded)).size).toBe(0);
  });
});

describe("pickRoutes", () => {
  it("takes the engine's first option by default", async () => {
    const options = await proposeTripRoutes(sampleTrip, noNetworkNeeded);
    const routes = pickRoutes(options);

    expect(routes.get(hopId(LISBON, PORTO))?.[0].mode).toBe("train");
  });

  it("takes the option the traveller named instead", async () => {
    const options = await proposeTripRoutes(sampleTrip, noNetworkNeeded);
    const routes = pickRoutes(options, {
      [hopId(LISBON, PORTO)]: "ground-bus",
    });

    expect(routes.get(hopId(LISBON, PORTO))?.[0].mode).toBe("bus");
    // An unnamed pair is unaffected.
    expect(routes.get(hopId(LONDON_ON, LISBON))).toHaveLength(3);
  });

  it("ignores a named option that no longer exists", async () => {
    const options = await proposeTripRoutes(sampleTrip, noNetworkNeeded);
    const routes = pickRoutes(options, {
      [hopId(LISBON, PORTO)]: "ground-hovercraft",
    });

    expect(routes.get(hopId(LISBON, PORTO))?.[0].mode).toBe("train");
  });
});
