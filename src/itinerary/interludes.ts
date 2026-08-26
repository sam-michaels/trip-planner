// ============================================================
// What you're actually doing in the space between two legs.
//
// The connector already says the true thing — "3h 40m in Toronto",
// "2 nights in Lisbon". This file says the *recognisable* thing
// underneath it, because "3h 40m in Toronto" is a measurement and
// what you're really being told is that you have an afternoon to
// kill in an airport, and everybody knows exactly what that feels
// like.
//
// THE ONE RULE: the line is keyed on the mode you are about to
// BOARD, not the one you just got off. Where you're standing is
// decided by what you're waiting for — three hours before a flight
// puts you in an airport, three hours before a train puts you in a
// station, and those are completely different afternoons. The
// arriving leg has already had its say on the card above.
//
// Hard gaps get nothing. A missing connection is the one thing in
// this list that's actually wrong, and a joke sitting under it is
// how a warning turns into decoration.
//
// Picked deterministically from the two leg ids (see `pick`) rather
// than at random: a line that reshuffles on every keystroke while
// you're editing the leg above it is maddening, and one that changes
// when you drag a card somewhere else is worse — you notice the
// text move and think you broke something.
// ============================================================

import type { Leg, TransportMode } from "../model/trip";

/**
 * Waiting to board. Keyed by the mode you're catching, and written
 * about the *place that mode makes you wait in* — an airport
 * concourse, a platform, a kerb — because that's the part everyone
 * recognises.
 */
const BOARDING: Record<TransportMode, string[]> = {
  flight: [
    "Shopping? Eating? Waiting? Whatever it is people do at an airport.",
    "Long enough to watch the departure board rearrange itself twice.",
    "Duty-free you won't buy, a coffee you'll overpay for, a gate that moves.",
    "Somewhere between the security queue and the boarding call.",
    "An airport afternoon: no clocks, no windows that open, infinite pretzels.",
  ],
  train: [
    "Platform coffee and one eye on the board, like everyone else here.",
    "The platform number goes up eight minutes before it leaves. It always does.",
    "A bench, a pastry, and the slow shuffle when the board finally flips.",
    "Enough time to find the right end of the platform. Only just.",
    "Station time: nothing happens, then everything does, all at once.",
  ],
  bus: [
    "A bus station is a room where time moves differently.",
    "Kerb, coffee, and a driver who will materialise exactly on schedule.",
    "Nowhere good to sit, nothing much to do, and it does turn up eventually.",
    "Bag between your feet, eyes on the road. That's the whole activity.",
    "Long enough to regret not going to the bathroom first.",
  ],
  ferry: [
    "Salt air, a queue of cars, and gulls with strong opinions.",
    "Watching the boat get gradually bigger. That's it. That's the wait.",
    "Harbour time — chips, wind, and the smell of diesel and seaweed.",
    "Everyone stands up forty minutes early. Nobody knows why.",
  ],
  car: [
    "Keys, coffee, and a short negotiation about who drives first.",
    "Load the boot, argue about the playlist, go.",
    "Enough time to find the car, and then to find it again properly.",
    "Snacks acquired, seat adjusted, one last look at the map.",
  ],
  walk: [
    "Boots on. This next bit is on foot.",
    "Stretch, re-tie the laces, and head off.",
    "Nothing to catch — you just start walking when you feel like it.",
  ],
};

/**
 * A soft gap: right city, wrong station. Keyed on the mode you
 * arrived by, because that's what decides where you're standing
 * when the problem becomes yours — an airport on the wrong side of
 * town is a different errand from a station two stops away.
 */
const ACROSS_TOWN: Record<TransportMode, string[]> = {
  flight: [
    "Off the plane and straight into figuring out {city}'s transit map.",
    "The airport is never in the city. The airport is never in the city.",
    "Baggage claim, then a decision about trains versus a taxi you'll regret.",
  ],
  train: [
    "Two stations, one city, and a bit of {city} in between.",
    "The kind of hop that's fifteen minutes or fifty, depending on {city}.",
    "Out one station, across town, into another.",
  ],
  bus: [
    "Coach drops you here; the next thing leaves from over there.",
    "A short, unglamorous, entirely necessary crossing of {city}.",
    "Off the bus, across {city}, and on with the trip.",
  ],
  car: [
    "Park it, or don't — either way you're crossing {city}.",
    "The last few kilometres are somehow always the fiddly ones.",
  ],
  ferry: [
    "Off the boat, and the terminal is nowhere near the middle of {city}.",
    "Ports are never central. Budget for the crossing.",
  ],
  walk: [
    "You're already on foot — this is just more of {city}.",
    "Keep walking. It's the same city, just the other end of it.",
  ],
};

/**
 * A stay: you sleep here. Nothing to do with transport at all, so
 * it isn't keyed on a mode — the whole point of a stay is that the
 * getting-there is over.
 */
const STAY = [
  "Long enough to develop a favourite café in {city}.",
  "Unpack properly. {city} has you for a while.",
  "Enough time to get lost in {city} on purpose.",
  "You'll know one street in {city} by heart by the end of this.",
  "Time to be a temporary local rather than a tourist.",
  "Somewhere in here is the day you don't plan anything.",
  "This is the part of the trip you'll actually remember.",
];

/** Under ten minutes — you land and keep moving. No wait to joke about. */
const STRAIGHT_THROUGH = [
  "No sitting down. Off one, onto the next.",
  "A change, not a stop. Keep your bag on your shoulder.",
  "Barely touches the ground here.",
];

interface InterludeInput {
  arriving: Leg;
  departing: Leg;
  /** True for a same-city, different-station hop. */
  acrossTown: boolean;
  /** What `describeStop` made of the pause, if the dates are known yet. */
  kind?: "connection" | "stay" | "straight-through";
}

/**
 * The flavour line for one connector, or `undefined` when there
 * shouldn't be one.
 */
export function interludeFor({
  arriving,
  departing,
  acrossTown,
  kind,
}: InterludeInput): string | undefined {
  const seed = `${arriving.id}|${departing.id}`;

  // A stay outranks a gap. If you're in Lisbon for three nights, the
  // metro ride from the airport to Oriente is an errand, not the
  // story — the headline above is already offering to book it, and
  // the line down here should be about the three nights.
  const line =
    kind === "stay"
      ? pick(STAY, seed)
      : acrossTown
        ? pick(ACROSS_TOWN[arriving.mode], seed)
        : kind === "straight-through"
          ? pick(STRAIGHT_THROUGH, seed)
          : // Either a real connection, or no dates yet — which is the
            // normal state of a trip you're still sketching. Both are
            // "you are waiting to board the next thing", so both get
            // the boarding line rather than a blank.
            pick(BOARDING[departing.mode], seed);

  return line?.replaceAll("{city}", arriving.to.city);
}

/**
 * Stable index into a list from a string.
 *
 * FNV-1a, because it's four lines and its avalanche is good enough
 * that two ids differing by one character land on different phrases —
 * which matters, since consecutive legs are routinely `leg-1` and
 * `leg-2` and adjacent connectors repeating the same joke is exactly
 * the failure this is trying to avoid.
 */
function pick<T>(options: T[], seed: string): T | undefined {
  if (options.length === 0) return undefined;

  let hash = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }

  return options[Math.abs(hash) % options.length];
}
