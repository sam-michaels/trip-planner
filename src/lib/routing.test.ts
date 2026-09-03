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

import { describe, expect, it, vi } from "vitest";

import type { Place, RouteHop, Trip } from "../model/trip";
import {
  coords,
  deriveLegs,
  findGaps,
  hopId,
  sampleTrip,
} from "../model/trip";
import { defaultMode } from "../itinerary/plausibleModes";
import { distanceKm } from "./geo";
import {
  accessOptions,
  buildRouteMap,
  pickRoutes,
  proposeRoutes,
  proposeTripRoutes,
  type RouteOption,
} from "./routing";

// The trip the whole app is built against, taken from the model rather
// than retyped — a copy here would drift the day someone edits it.
// `sampleTrip.origin` is typed optional now that a trip can exist
// before anyone's said where they are, but this fixture always has
// one — this just asserts that without reaching for `!`.
function requireOrigin(trip: Trip): Place {
  if (!trip.origin) throw new Error("sampleTrip must have an origin");
  return trip.origin;
}
const LONDON_ON = requireOrigin(sampleTrip);
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
const GRANADA = place("granada", "Granada", "ES", -3.5986, 37.1773);
const MARRAKESH = place("marrakesh", "Marrakesh", "MA", -8.0083, 31.6295);
const TORONTO = place("toronto", "Toronto", "CA", -79.3832, 43.6532);
const NEW_YORK = place("new-york", "New York", "US", -74.006, 40.7128);
const MADRID = place("madrid", "Madrid", "ES", -3.7038, 40.4168);
const BERLIN = place("berlin", "Berlin", "DE", 13.405, 52.52);
// Deliberately somewhere the curated table doesn't reach: the nearest
// hub is Montreal, 1,500km away.
const IQALUIT = place("iqaluit", "Iqaluit", "CA", -68.517, 63.7467);

/**
 * The curated table has to carry the pair on its own. Some ends still
 * attempt the lookup — only a hub in the city itself skips it — so
 * this doubles as "the answer survives the network being down".
 */
const noNetworkNeeded = {
  findAirports: async (): Promise<Place[]> => {
    throw new Error("the curated hub table should have answered this");
  },
};

const airport = (
  iata: string,
  name: string,
  city: string,
  country: string,
  lng: number,
  lat: number,
): Place => ({
  id: `apt-${iata.toLowerCase()}`,
  name,
  city,
  country,
  coords: coords(lng, lat),
  iata,
});

/**
 * A stand-in for OurAirports: the airports below, nearest first,
 * within a range the real `nearestAirports` would plausibly return.
 * Every one of them is a `large_airport` in the real dataset.
 */
const datasetOf = (pool: Place[]) => ({
  findAirports: async (near: [number, number]): Promise<Place[]> =>
    pool
      .map((a) => ({ a, km: distanceKm(near, a.coords) }))
      .filter(({ km }) => km < 600)
      .sort((x, y) => x.km - y.km)
      .slice(0, 5)
      .map(({ a }) => a),
});

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
    // Gibraltar is a large_airport 20km from Algeciras, and without a
    // floor on the flight itself the engine proposed a FORTY-kilometre
    // flight out of it — reached by an international border crossing —
    // in preference to the ferry that has run for a century.
    const options = await proposeRoutes(
      ALGECIRAS,
      TANGIER,
      datasetOf([
        airport("GIB", "Gibraltar Airport", "Gibraltar", "GI", -5.3467, 36.1512),
      ]),
    );

    expect(options[0].hops).toHaveLength(1);
    expect(options[0].hops[0].mode).toBe("ferry");
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

  it("offers the local airport when it genuinely serves the route", async () => {
    // Birmingham is 150km from Heathrow and 10km from BHX. Both fly to
    // Newark, so both are real answers and the nearer one wins: this is
    // "connectivity filters, distance ranks what survives" in one case.
    const bhx = airport(
      "BHX",
      "Birmingham Airport",
      "Birmingham",
      "GB",
      -1.748,
      52.4539,
    );
    const bham = place("bham", "Birmingham", "GB", -1.8904, 52.4862);

    const options = await proposeRoutes(bham, NEW_YORK, datasetOf([bhx]));

    expect(options[0].hops[1].from.iata).toBe("BHX");
    expect(options.map((o) => o.hops[1]?.from.iata)).toContain("LHR");
  });

  it("drops the local airport when no such flight exists", async () => {
    // The other half of the same rule, and the reason it is a rule. BHX
    // has 133 departures in the dataset and Toronto is not among them,
    // while Heathrow flies there daily. Proximity would offer BHX — it
    // is fifteen times closer — and proximity would be proposing a
    // flight nobody sells.
    const bhx = airport(
      "BHX",
      "Birmingham Airport",
      "Birmingham",
      "GB",
      -1.748,
      52.4539,
    );
    const bham = place("bham", "Birmingham", "GB", -1.8904, 52.4862);

    const options = await proposeRoutes(bham, TORONTO, datasetOf([bhx]));

    expect(options[0].hops[1].from.iata).toBe("LHR");
    expect(options.map((o) => o.hops[1]?.from.iata)).not.toContain("BHX");
  });

  it("reaches past the local airport to a hub that flies the route", async () => {
    // Lyon's nearest curated hubs are Milan (303km) and Zurich (341km),
    // both across a border; LYS is 20km away. The engine used to take
    // LYS on those grounds and propose a Lyon → Toronto flight, which
    // does not exist and never has — you go via Paris, and so does this
    // now. LYS is in the dataset with 275 routes, so its silence about
    // Toronto is an answer rather than missing data.
    const lys = airport(
      "LYS",
      "Lyon Saint-Exupéry Airport",
      "Colombier-Saugnieu",
      "FR",
      5.0811,
      45.7256,
    );
    const options = await proposeRoutes(
      place("lyon", "Lyon", "FR", 4.8357, 45.764),
      TORONTO,
      datasetOf([lys]),
    );

    expect(options[0].hops.at(-2)!.from.iata).toBe("CDG");

    // LYS may still appear — flying Lyon → Frankfurt → Toronto is a real
    // itinerary, and the gateway search offers it. What must never appear
    // is the transatlantic hop the old engine invented.
    for (const option of options) {
      for (const hop of option.hops) {
        expect(`${hop.from.iata}->${hop.to.iata}`, option.id).not.toBe(
          "LYS->YYZ",
        );
      }
    }

    // Still nobody's idea of a trip through another country.
    for (const option of options) {
      expect(option.hops[0].to.country, option.id).toBe("FR");
    }
  });

  it("offers both ways to reach a gateway you could also travel to", async () => {
    // Paris is ~390km from Lyon: close enough to take a train to, and
    // also somewhere LYS flies several times a day. Those are two
    // genuinely different mornings — three hours on a train, or an
    // hour in the air plus the airport either side — and the engine
    // used to pick for you, because it asked "can I reach this hub
    // overland?" and stopped asking as soon as the answer was yes.
    //
    // This is what the onboarding popup's transport row is choosing
    // between, so both have to exist as options with DISTINCT IDS —
    // `pickRoutes` records the traveller's choice by id, and two
    // chains sharing one would make the choice unrepresentable.
    const lys = airport(
      "LYS",
      "Lyon Saint-Exupéry Airport",
      "Colombier-Saugnieu",
      "FR",
      5.0811,
      45.7256,
    );
    const options = await proposeRoutes(
      place("lyon", "Lyon", "FR", 4.8357, 45.764),
      TORONTO,
      datasetOf([lys]),
    );

    const ids = idsOf(options);
    expect(ids).toContain("gateway-cdg-yyz");
    expect(ids).toContain("gateway-cdg-yyz-via-lys");

    // The simpler trip leads: reaching a gateway without a second
    // airport in the way is the one to beat, not the fallback.
    expect(ids.indexOf("gateway-cdg-yyz")).toBeLessThan(
      ids.indexOf("gateway-cdg-yyz-via-lys"),
    );

    const flown = options.find((o) => o.id === "gateway-cdg-yyz-via-lys")!;
    expect(
      flown.hops.map((hop) => [
        hop.from.iata ?? hop.from.city,
        hop.to.iata ?? hop.to.city,
        hop.mode,
      ]),
    ).toEqual([
      ["Lyon", "LYS", "train"],
      ["LYS", "CDG", "flight"],
      ["CDG", "YYZ", "flight"],
      ["YYZ", "Toronto", "train"],
    ]);
  });

  it("flies an inland pair across the strait instead of ferrying it", async () => {
    // Granada and Marrakesh are both inland and 737km apart with the
    // Strait of Gibraltar between them. A transfer budget of 12% of
    // that excluded every airport that serves the route, leaving a
    // ferry hop between two cities neither of which has a port — and
    // `pickRoutes` stored it, so `findGaps` stayed quiet about it.
    const agp = airport(
      "AGP",
      "Málaga Airport",
      "Málaga",
      "ES",
      -4.4991,
      36.6749,
    );
    const options = await proposeRoutes(GRANADA, MARRAKESH, datasetOf([agp]));

    expect(modesOf(options[0].hops)).toEqual(["train", "flight", "train"]);
    // Málaga is nearest and has no Marrakesh service; Seville does.
    // The old engine picked on distance and proposed the Málaga flight.
    expect(options.map((o) => o.hops[1]?.from.iata)).toContain("SVQ");
    expect(options.map((o) => o.hops[1]?.from.iata)).not.toContain("AGP");
    // The ferry is still offered — it is a real way to make the
    // crossing — just not the recommendation.
    expect(idsOf(options).at(-1)).toBe("ground-ferry");
  });

  it("will not put a ground transfer across open water", async () => {
    // `isLandConnected` works on continents, so Cuba and the United
    // States come back land-bridged and the transfer to Miami was
    // proposed as a 365km TRAIN across the Florida Straits.
    const options = await proposeRoutes(
      place("havana", "Havana", "CU", -82.3666, 23.1136),
      LISBON,
      datasetOf([
        airport("MIA", "Miami International", "Miami", "US", -80.287, 25.7959),
        airport(
          "HAV",
          "José Martí International Airport",
          "Havana",
          "CU",
          -82.4091,
          22.9892,
        ),
      ]),
    );

    expect(options[0].hops[1].from.iata).toBe("HAV");
    for (const hop of options.flatMap((option) => option.hops)) {
      expect(hop.to.iata, `${hop.from.name} -> ${hop.to.name}`).not.toBe("MIA");
    }
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

  it("gives up on a lookup that never settles", async () => {
    // `loadAirports` fetches without a signal, so a stalled connection
    // neither resolves nor rejects. An engine that promises never to
    // reject would then simply never return, which is worse than an
    // error because nothing upstream can even see it happening.
    vi.useFakeTimers();
    try {
      const pending = proposeRoutes(IQALUIT, LISBON, {
        findAirports: () => new Promise<Place[]>(() => {}),
      });
      await vi.advanceTimersByTimeAsync(30_000);

      const options = await pending;
      expect(options[0].provisional).toBe(true);
    } finally {
      vi.useRealTimers();
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

describe("accessOptions — how long the transfer takes", () => {
  // Two points about 11km apart, which is an ordinary run to a city's
  // own airport rather than a journey to the next city.
  const CITY = place("est-city", "Estimateville", "PT", -9.13, 38.72);
  const NEARBY = place("est-airport", "Estimateville", "PT", -9.0, 38.72);

  it("does not round a short hop up to 25 minutes", () => {
    // The floor used to sit INSIDE the ×5 — `Math.max(5, blocks) * 5` —
    // so every transfer under about 35km came back as exactly 25m
    // regardless of distance, and the row claimed a half-hour drive to
    // an airport eleven kilometres away.
    const car = accessOptions(CITY, NEARBY).find((o) => o.mode === "car");

    expect(car?.estimateMinutes).toBeDefined();
    expect(car!.estimateMinutes!).toBeLessThan(25);
    expect(car!.estimateMinutes!).toBeGreaterThanOrEqual(5);
  });

  it("still rounds to five minutes, and never returns zero", () => {
    const samePlace = place("est-same", "Estimateville", "PT", -9.13, 38.72);

    // Only the modes that HAVE a speed: `estimateMinutes` returns
    // undefined for anything missing from `MODE_KMH`, which is the
    // honest answer for a mode this engine can't time, and asserting
    // over it would be testing the wrong thing.
    const timed = (from: Place, to: Place) =>
      accessOptions(from, to)
        .map((option) => option.estimateMinutes)
        .filter((minutes): minutes is number => minutes !== undefined);

    const zeroDistance = timed(CITY, samePlace);
    expect(zeroDistance.length).toBeGreaterThan(0);
    for (const minutes of zeroDistance) {
      // A zero-distance transfer is still floored at the smallest
      // honest answer rather than claiming to be instantaneous.
      expect(minutes).toBe(5);
    }

    for (const minutes of timed(CITY, NEARBY)) {
      expect(minutes % 5).toBe(0);
    }
  });
});
