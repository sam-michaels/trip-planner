// ============================================================
// mode/status -> paint. geometry.ts decides what shape a leg draws
// as; this file decides how it's colored, faded, and dashed.
// ============================================================

import type {
  ExpressionSpecification,
  FilterSpecification,
  LineLayerSpecification,
} from "@maplibre/maplibre-gl-style-spec";

import type { PlanStatus, TransportMode } from "../model/trip";

export const MODE_COLORS: Record<TransportMode, string> = {
  flight: "#2563eb", // blue
  train: "#16a34a", // green
  bus: "#f59e0b", // amber
  car: "#78716c", // stone
  ferry: "#0891b2", // cyan
  walk: "#a855f7", // purple
};

const STATUS_OPACITY: Record<PlanStatus, number> = {
  idea: 0.45,
  planned: 0.75,
  booked: 1,
};

/**
 * MapLibre `match` expression: a feature's `mode` property -> its
 * color. Built from `MODE_COLORS` so the table above is the only
 * place a mode's color is decided.
 *
 * WHY THE CAST: a `match` expression's tuple type requires a fixed
 * arity (input, then alternating label/output pairs, then a
 * fallback) that TypeScript can only verify against a literal tuple
 * -- not one assembled by spreading `Object.entries(...).flat()`.
 * The runtime shape is correct; the cast just tells TS what a
 * literal-written version of this array would already prove.
 */
const lineColorExpression = [
  "match",
  ["get", "mode"],
  ...Object.entries(MODE_COLORS).flat(),
  "#6b7280", // fallback for a mode not in the table above
] as unknown as ExpressionSpecification;

/** Same idea, keyed by `status` instead. */
const lineOpacityExpression = [
  "match",
  ["get", "status"],
  ...Object.entries(STATUS_OPACITY).flat(),
  1,
] as unknown as ExpressionSpecification;

/**
 * Two layers, both reading the same `legs` source, split by status.
 *
 * WHY TWO LAYERS AND NOT ONE: `line-color` and `line-opacity` support
 * data-driven (per-feature) expressions, but `line-dasharray` does
 * not — MapLibre bakes dash patterns into a shared texture atlas per
 * layer, so a dash pattern can only vary per *layer*, not per
 * feature. Splitting "still tentative" (idea/planned, dashed) from
 * "booked" (solid) via a `filter` is the workaround forced by that
 * limitation. Everything else — color by mode, fade by status — stays
 * expression-driven and shared between the two layers, so this is
 * still one piece of styling logic, not six (one per mode).
 */
const DASHED_FILTER: FilterSpecification = ["!=", ["get", "status"], "booked"];
const SOLID_FILTER: FilterSpecification = ["==", ["get", "status"], "booked"];

export function legLineLayers(sourceId: string): LineLayerSpecification[] {
  const base = {
    type: "line" as const,
    source: sourceId,
    layout: {
      "line-cap": "round" as const,
      "line-join": "round" as const,
    },
  };

  return [
    {
      ...base,
      id: `${sourceId}-dashed`,
      filter: DASHED_FILTER,
      paint: {
        "line-color": lineColorExpression,
        "line-opacity": lineOpacityExpression,
        "line-width": 3,
        "line-dasharray": [2, 2],
      },
    },
    {
      ...base,
      id: `${sourceId}-solid`,
      filter: SOLID_FILTER,
      paint: {
        "line-color": lineColorExpression,
        "line-opacity": lineOpacityExpression,
        "line-width": 3,
      },
    },
  ];
}
