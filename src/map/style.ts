// ============================================================
// mode/status -> paint. geometry.ts decides what shape a leg draws
// as; this file decides how it's painted.
//
// WHAT EACH CHANNEL CARRIES:
//
//   * MODE is the line's colour, read off the feature (`LEG_COLOR`
//     below, set from `MODE_COLORS` in geometry.ts), reinforced by
//     that mode's icon repeated along the line — the same icon the
//     editor and the leg card use (see modeSprites.ts);
//   * STATUS is dashed-versus-solid, plus opacity;
//   * SELECTION is a wide soft halo in the leg's own colour, so the
//     route lights up rather than a different route appearing under
//     it.
//
// Mode and status used to fight over colour — status was painted in
// the mode's swatch — so they were split: status has its own palette
// now (`STATUS_COLORS` in itinerary/labels.ts) and never borrows this
// one. The basemap was also switched to MapTiler's `landscape` for
// this to work, because a saturated navigation basemap leaves six
// muted route colours nowhere to sit.
//
// A white casing under every line is what makes them read as drawn
// *on* the map rather than lost in it — the same trick road atlases
// use, and the reason a thin dark line over green terrain suddenly
// becomes legible.
// ============================================================

import type {
  ExpressionSpecification,
  FilterSpecification,
  LayerSpecification,
} from "@maplibre/maplibre-gl-style-spec";

import type { PlanStatus } from "../model/trip";
import { STATUS_COLORS } from "../itinerary/labels";
import { MODE_ICON_EXPRESSION } from "./modeSprites";

/**
 * Every leg paints in its own colour, carried on the feature by
 * `geometry.ts` (see `LEG_PALETTE`). Reading it off the feature rather
 * than looking it up here keeps this file free of any knowledge about
 * how many legs there are or what order they're in.
 */
const LEG_COLOR = ["get", "color"] as unknown as ExpressionSpecification;
const CASING_COLOR = "#ffffff";

// Raised across the board from the old 0.45/0.75/1: an "idea" faded
// almost to nothing, which made a trip that is mostly ideas — i.e.
// every trip worth planning — look washed out and provisional.
const STATUS_OPACITY: Record<PlanStatus, number> = {
  idea: 0.72,
  planned: 0.86,
  booked: 1,
};

/**
 * Build a MapLibre `match` expression from a `Record<PlanStatus, T>`
 * table: a feature's `status` property -> whatever that table says,
 * so the table itself stays the only place the mapping is decided.
 * Shared by every per-status table below (`STATUS_OPACITY` here,
 * `STATUS_COLORS` for destination markers further down) so there's
 * one place that knows how to turn such a table into an expression.
 *
 * WHY THE CAST: a `match` expression's tuple type requires a fixed
 * arity (input, then alternating label/output pairs, then a fallback)
 * that TypeScript can only verify against a literal tuple — not one
 * assembled by spreading `Object.entries(...).flat()`. The runtime
 * shape is correct; the cast just tells TS what a literal-written
 * version of this array would already prove.
 */
function matchByStatus<T extends string | number>(
  table: Record<PlanStatus, T>,
  fallback: T,
): ExpressionSpecification {
  return [
    "match",
    ["get", "status"],
    ...Object.entries(table).flat(),
    fallback,
  ] as unknown as ExpressionSpecification;
}

const statusOpacity = matchByStatus(STATUS_OPACITY, 1);

/** Layer ids, derived from the source id so callers never spell them out. */
export function legLayerIds(sourceId: string) {
  return {
    hit: `${sourceId}-hit`,
    casing: `${sourceId}-casing`,
    highlight: `${sourceId}-highlight`,
    dashed: `${sourceId}-dashed`,
    solid: `${sourceId}-solid`,
    markers: `${sourceId}-markers`,
  };
}

/**
 * Which leg (if any) is currently selected.
 *
 * `""` is used for "none" rather than removing the filter: a match
 * against an id no feature has selects nothing, which is exactly the
 * wanted behaviour and avoids a second code path for the empty case.
 */
export function selectedLegFilter(legId?: string): FilterSpecification {
  return ["==", ["get", "legId"], legId ?? ""];
}

/**
 * Two layers for the line itself, split by status.
 *
 * WHY THE SPLIT: `line-color` and `line-opacity` support data-driven
 * (per-feature) expressions, but `line-dasharray` does not — MapLibre
 * bakes dash patterns into a shared texture atlas per layer, so a dash
 * pattern can only vary per *layer*, not per feature. Separating
 * "still tentative" (dashed) from "booked" (solid) via a filter is the
 * workaround that limitation forces.
 */
const DASHED_FILTER: FilterSpecification = ["!=", ["get", "status"], "booked"];
const SOLID_FILTER: FilterSpecification = ["==", ["get", "status"], "booked"];

export function legLineLayers(sourceId: string): LayerSpecification[] {
  const ids = legLayerIds(sourceId);
  const line = {
    type: "line" as const,
    source: sourceId,
    layout: {
      "line-cap": "round" as const,
      "line-join": "round" as const,
    },
  };

  return [
    {
      // A 3px line is a hard target for a mouse and an impossible one
      // for a finger. This invisible 20px line exists purely so
      // `queryRenderedFeatures` has something generous to hit — fully
      // transparent features still register as rendered, which is what
      // makes the trick work.
      ...line,
      id: ids.hit,
      paint: {
        "line-color": "#000000",
        "line-opacity": 0,
        "line-width": 20,
      },
    },
    {
      // White casing: separates the route from whatever it crosses.
      ...line,
      id: ids.casing,
      paint: {
        "line-color": CASING_COLOR,
        "line-opacity": ["*", statusOpacity, 0.9] as ExpressionSpecification,
        "line-width": 7,
      },
    },
    {
      // Selection glow, above the casing so it reads as a halo around
      // the whole route rather than a line beside it.
      ...line,
      id: ids.highlight,
      filter: selectedLegFilter(),
      paint: {
        // The leg's own colour, wide and soft: selection reads as that
        // route lighting up rather than as a different route appearing
        // underneath it.
        "line-color": LEG_COLOR,
        "line-opacity": 0.5,
        "line-width": 16,
        "line-blur": 3,
      },
    },
    {
      ...line,
      id: ids.dashed,
      filter: DASHED_FILTER,
      paint: {
        "line-color": LEG_COLOR,
        "line-opacity": statusOpacity,
        "line-width": 2.5,
        // Longer dashes than before: at country zoom a 2,2 pattern
        // dissolved into a grey smear rather than reading as "dashed".
        "line-dasharray": [3, 2.5],
      },
    },
    {
      ...line,
      id: ids.solid,
      filter: SOLID_FILTER,
      paint: {
        "line-color": LEG_COLOR,
        "line-opacity": statusOpacity,
        "line-width": 3,
      },
    },
    {
      // The mode icons, repeated along each route.
      id: ids.markers,
      type: "symbol",
      source: sourceId,
      layout: {
        "symbol-placement": "line",
        // Far enough apart to punctuate a long flight arc without
        // turning it into a dotted line of planes.
        "symbol-spacing": 130,
        "icon-image": MODE_ICON_EXPRESSION as unknown as ExpressionSpecification,
        // Upright regardless of the line's bearing: a plane rotated to
        // follow a great circle reads as a crash, not a heading.
        "icon-rotation-alignment": "viewport",
        "icon-allow-overlap": false,
        "icon-padding": 6,
      },
      paint: {
        "icon-opacity": statusOpacity,
      },
    },
  ];
}

// ============================================================
// Destination markers.
//
// A destination (Lisbon, four nights) has to read as a different KIND
// of thing from an ordinary hop endpoint (LIS airport, a bus transfer)
// — that distinction is the whole point of the destination-first
// model, and the map is where it has to be legible at a glance. Two
// channels do the work, and per the file banner they stay separate
// from mode:
//
//   * SIZE carries `nights` — a week in Lisbon is a bigger deal on the
//     map than a one-night stopover, and an undecided night count
//     still draws at a small, deliberate minimum rather than vanishing.
//   * FILL carries `status`, from the SAME `STATUS_COLORS` table the
//     itinerary list uses for its status pills — never `MODE_COLORS`,
//     which belongs to legs and has nothing to do with a place you
//     simply stop at.
//
// A plain hop endpoint gets no marker at all: it's just where a line
// starts or stops. That absence is itself the contrast — the only
// dots on the map are places the traveller actually chose to be.
// ============================================================

/** Layer ids for the destination markers, derived from their own source id. */
export function destinationLayerIds(sourceId: string) {
  return {
    circle: `${sourceId}-circle`,
    label: `${sourceId}-label`,
  };
}

/**
 * Marker radius by night count. `interpolate` clamps outside its
 * stops, so a two-week stay doesn't need its own entry to stop
 * growing forever.
 *
 * The `-1` stop is `geometry.ts`'s sentinel for "undecided" — see
 * `DestinationProperties.nights` there. It gets the smallest radius,
 * one notch below an explicit `0` (a deliberate day trip), so the two
 * stay visually distinguishable rather than the map silently forgetting
 * which one the traveller actually meant.
 */
const NIGHTS_RADIUS = [
  "interpolate",
  ["linear"],
  ["get", "nights"],
  -1, 7,
  0, 8,
  1, 10,
  7, 15,
  21, 22,
] as unknown as ExpressionSpecification;

/**
 * `STATUS_COLORS` is the same table `STATUS_PILL_CLASSES` reads for
 * the itinerary list's status pills — a destination has no "mode" to
 * clash with, so nothing stops it sharing status's palette exactly.
 */
const statusFill = matchByStatus(STATUS_COLORS, STATUS_COLORS.idea);

export function destinationLayers(sourceId: string): LayerSpecification[] {
  const ids = destinationLayerIds(sourceId);

  return [
    {
      id: ids.circle,
      type: "circle",
      source: sourceId,
      paint: {
        "circle-radius": NIGHTS_RADIUS,
        "circle-color": statusFill,
        "circle-opacity": statusOpacity,
        // Same white casing trick as the lines: separates the marker
        // from whatever terrain sits under it.
        "circle-stroke-color": CASING_COLOR,
        "circle-stroke-width": 2.5,
      },
    },
    {
      // The place name, so a marker reads as "Lisbon" without a
      // separate lookup back to the itinerary list.
      id: ids.label,
      type: "symbol",
      source: sourceId,
      layout: {
        "text-field": ["get", "name"],
        "text-size": 12,
        "text-offset": [0, 1.6],
        "text-anchor": "top",
        // Never let a label eclipse another marker's circle by hiding
        // it — a missing label is a minor loss, a hidden destination
        // is not.
        "text-optional": true,
      },
      paint: {
        "text-color": "#363b30", // bark-800, see index.css
        "text-halo-color": CASING_COLOR,
        "text-halo-width": 1.4,
      },
    },
  ];
}
