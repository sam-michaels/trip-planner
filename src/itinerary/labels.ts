// ============================================================
// The shared vocabulary of the itinerary UI: what each mode and
// status is called, what icon stands for it, and how money is
// rendered. One table per concept so a label is never invented
// twice in two components and drifts.
// ============================================================

import {
  Bus,
  Car,
  Footprints,
  Plane,
  Ship,
  TrainFront,
  type LucideIcon,
} from "lucide-react";

import type { Money, PlanStatus, TransportMode } from "../model/trip";

export const MODES: TransportMode[] = [
  "flight",
  "train",
  "bus",
  "car",
  "ferry",
  "walk",
];

export const MODE_LABELS: Record<TransportMode, string> = {
  flight: "Flight",
  train: "Train",
  bus: "Bus",
  car: "Car",
  ferry: "Ferry",
  walk: "Walk",
};

export const MODE_ICONS: Record<TransportMode, LucideIcon> = {
  flight: Plane,
  train: TrainFront,
  bus: Bus,
  car: Car,
  ferry: Ship,
  walk: Footprints,
};

/**
 * One colour per transport mode — and the ONLY thing in the UI that
 * varies per mode.
 *
 * Colour and icon both say "mode", which is deliberate reinforcement
 * rather than redundancy: the icon is what you read on a card at arm's
 * length, the colour is what you pick out of four crossing routes at
 * country zoom where a 22px glyph is too small to identify.
 *
 * Every one of these is a colour something outdoors actually is —
 * terracotta, pine, heather, rust, slate water, dry olive — held at a
 * common depth and spread around the wheel, so no mode looks more
 * important than another and none of them blur together. They are the
 * darkest things in the scheme on purpose: the rest of the app is
 * pastel, and these have to survive being drawn 3px wide over a
 * basemap under a white casing, where a pastel line disappears.
 */
export const MODE_COLORS: Record<TransportMode, string> = {
  flight: "#b5714f", // terracotta
  train: "#3f7d70", // pine-teal
  bus: "#7d6a94", // heather
  car: "#a85644", // rust
  ferry: "#5b7f9e", // slate water
  walk: "#7d8f4a", // dry olive
};

export const STATUSES: PlanStatus[] = ["idea", "planned", "booked"];

export const STATUS_LABELS: Record<PlanStatus, string> = {
  idea: "Idea",
  planned: "Planned",
  booked: "Booked",
};

/**
 * One colour per status, shared by every leg that has that status.
 *
 * WHY IT'S NOT THE MODE COLOUR: it used to be, and that meant "Idea"
 * was orange on the flight and teal on the train — so the pill that
 * exists precisely to let you sweep the list and count what's still
 * unbooked was a different colour on every row, and the count was
 * impossible to make. Status is a property of the *plan*, not of the
 * journey, so it gets a palette of its own and the same three colours
 * everywhere. Mode keeps `MODE_COLORS`; the two channels no longer
 * fight over the same swatch.
 *
 * WHY IDEA IS HEATHER AND NOT GREY: an idea is the most exciting
 * thing in the list — it's the part of the trip still full of
 * possibility — and greying it out made a half-sketched itinerary
 * look like a failure state rather than a trip taking shape. The
 * progression heather → ochre → moss also runs cool to warm to
 * settled, which is roughly what booking a trip feels like.
 */
export const STATUS_COLORS: Record<PlanStatus, string> = {
  idea: "#7d6a94", // heather-500
  planned: "#b0873a", // ochre-500
  booked: "#5c8752", // moss-500
};

/**
 * Status styling deliberately echoes the map: tentative things are
 * dashed and washed out, booked things are solid. Someone who has
 * looked at the map for ten seconds already knows how to read the list.
 */
export const STATUS_PILL_CLASSES: Record<PlanStatus, string> = {
  idea: "border border-dashed border-heather-300 bg-heather-50 text-heather-600",
  planned: "border border-dashed border-ochre-300 bg-ochre-50 text-ochre-700",
  booked: "border border-moss-300 bg-moss-100 text-moss-700",
};

/**
 * Format money in the currency it was actually recorded in — no
 * conversion. Converting here would need a live FX rate and would
 * quietly turn a true record into an estimate; see the README's "money
 * is never a bare number" rule. Display-time conversion is Step 4's job.
 */
export function formatMoney(money: Money): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: money.currency,
      // Whole amounts are the norm while estimating ("roughly €40"),
      // and trailing ".00" on every row is noise.
      maximumFractionDigits: Number.isInteger(money.amount) ? 0 : 2,
    }).format(money.amount);
  } catch {
    // Intl throws on a currency code it doesn't recognise. A rejected
    // code shouldn't blank out the row it appears on.
    return `${money.amount} ${money.currency}`;
  }
}

/** "Lisbon, PT" — a place's supporting line under its name. */
export function placeSubtitle(place: { city: string; country: string }): string {
  return `${place.city}, ${place.country}`;
}
