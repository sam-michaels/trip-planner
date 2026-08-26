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
 * MapLibre `match` expression: a feature's `status` property -> its
 * opacity, so the table above is the only place this is decided.
 *
 * WHY THE CAST: a `match` expression's tuple type requires a fixed
 * arity (input, then alternating label/output pairs, then a fallback)
 * that TypeScript can only verify against a literal tuple — not one
 * assembled by spreading `Object.entries(...).flat()`. The runtime
 * shape is correct; the cast just tells TS what a literal-written
 * version of this array would already prove.
 */
const statusOpacity = [
  "match",
  ["get", "status"],
  ...Object.entries(STATUS_OPACITY).flat(),
  1,
] as unknown as ExpressionSpecification;

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
