import { describe, expect, it } from "vitest";

import type { Destination, Place, RouteMap, Trip } from "../model/trip";
import { coords, deriveLegs, hopId } from "../model/trip";
import { legsByDestination } from "./legGroups";

const place = (id: string, city = id): Place => ({
  id,
  name: city,
  city,
  country: "XX",
  coords: coords(0, 0),
});

const HOME = place("home");
const LISBON = place("lisbon");
const PORTO = place("porto");
const PEARSON = place("yyz");
const LIS_AIRPORT = place("lis-airport", "Lisbon");

const destination = (id: string, p: Place): Destination => ({
  id,
  place: p,
  status: "idea",
});

const trip = (destinations: Destination[]): Trip => ({
  id: "t",
  title: "t",
  travellers: 1,
  homeCurrency: "CAD",
  origin: HOME,
  destinations,
  hopOverrides: {},
  stays: [],
  activities: [],
});

describe("legsByDestination", () => {
  it("gives every destination its own placeholder leg when there are no routes", () => {
    const t = trip([destination("d1", LISBON), destination("d2", PORTO)]);
    const groups = legsByDestination(t, deriveLegs(t, new Map()));

    expect(groups.get("d1")?.map((l) => l.id)).toEqual([hopId(HOME, LISBON)]);
    expect(groups.get("d2")?.map((l) => l.id)).toEqual([hopId(LISBON, PORTO)]);
  });

  it("keeps a multi-hop chain with the destination it arrives at", () => {
    const t = trip([destination("d1", LISBON), destination("d2", PORTO)]);
    const routes: RouteMap = new Map([
      [
        hopId(HOME, LISBON),
        [
          { from: HOME, to: PEARSON, mode: "car" as const },
          { from: PEARSON, to: LIS_AIRPORT, mode: "flight" as const },
          { from: LIS_AIRPORT, to: LISBON, mode: "train" as const },
        ],
      ],
    ]);

    const groups = legsByDestination(t, deriveLegs(t, routes));

    expect(groups.get("d1")?.map((l) => l.to.id)).toEqual([
      "yyz",
      "lis-airport",
      "lisbon",
    ]);
    expect(groups.get("d2")).toHaveLength(1);
  });

  it("gives a repeated place no legs of its own", () => {
    // "Lisbon, then Lisbon again" is not a journey — deriveLegs emits
    // nothing for it, and neither does this.
    const t = trip([destination("d1", LISBON), destination("d2", LISBON)]);
    const groups = legsByDestination(t, deriveLegs(t, new Map()));

    expect(groups.get("d1")).toHaveLength(1);
    expect(groups.get("d2")).toEqual([]);
  });

  it("has an entry for every destination even when the legs are empty", () => {
    const t = trip([destination("d1", LISBON)]);
    const groups = legsByDestination(t, []);

    expect(groups.get("d1")).toEqual([]);
  });

  it("attributes nothing rather than the wrong journey when the legs disagree", () => {
    // A leg array from a trip that starts somewhere else entirely —
    // the first chain doesn't begin at this trip's origin, so nothing
    // below it can be trusted either.
    const t = trip([destination("d1", LISBON), destination("d2", PORTO)]);
    const elsewhere = deriveLegs(
      { ...trip([destination("d1", LISBON), destination("d2", PORTO)]), origin: PEARSON },
      new Map(),
    );

    const groups = legsByDestination(t, elsewhere);

    expect(groups.get("d1")).toEqual([]);
    expect(groups.get("d2")).toEqual([]);
  });
});
