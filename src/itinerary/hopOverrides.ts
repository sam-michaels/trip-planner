// ============================================================
// From a leg on screen back to the override it writes to.
//
// THE TRAP THIS MODULE EXISTS TO CLOSE: a leg id is not always a hop
// id. `deriveLegs` gives the second and later occurrences of the same
// physical hop a suffix — "lisbon->porto#2" — because React keys and
// MapLibre feature ids have to be unique. The OVERRIDE is deliberately
// not suffixed: Lisbon → Porto is one journey with one booking, however
// many times the trip passes along it, so both occurrences read and
// write `trip.hopOverrides["lisbon->porto"]`.
//
// Write an override under the suffixed id and it lands in a key
// `deriveLegs` never looks at: the form appears to accept the edit and
// the leg silently keeps the engine's guess. Every path from a leg to
// an override goes through `baseHopId` for that reason.
// ============================================================

import type { HopId, HopOverride } from "../model/trip";

/**
 * The occurrence suffix `deriveLegs` appends: `#2`, `#3`, …
 *
 * Anchored at the end and digits-only so it can't eat a place id that
 * happens to contain a "#" — only the exact shape the model produces.
 */
const OCCURRENCE_SUFFIX = /#\d+$/;

/**
 * The hop id a leg's override lives under.
 *
 * TODO(unit-7): Unit 7 exports this same helper alongside the reducer.
 * Import theirs and delete this one the moment their branch lands —
 * two implementations of this rule would drift, and the failure mode
 * of a drifted one is an edit that silently does nothing.
 */
export function baseHopId(legId: string): HopId {
  return legId.replace(OCCURRENCE_SUFFIX, "");
}

/** True when this leg id carries an occurrence suffix. */
export function isRepeatOccurrence(legId: string): boolean {
  return OCCURRENCE_SUFFIX.test(legId);
}

/**
 * How many of these legs are the same journey as this one.
 *
 * WHY THE SUFFIX ISN'T ENOUGH: only the SECOND and later occurrences
 * carry `#n`, so `isRepeatOccurrence` is false for the first one — and
 * the first one is the one a user is most likely to open. Warning
 * "this applies to every occurrence" on the fourth card but not the
 * first would tell the person who needs it least. Counting the derived
 * legs is the only way to know, and only the caller has them.
 */
export function occurrenceCount(
  legs: readonly { id: string }[],
  legId: string,
): number {
  const key = baseHopId(legId);
  return legs.filter((leg) => baseHopId(leg.id) === key).length;
}

/** The override for a leg, found through `baseHopId` rather than by leg id. */
export function overrideForLeg(
  overrides: Record<HopId, HopOverride>,
  legId: string,
): HopOverride | undefined {
  return overrides[baseHopId(legId)];
}

export type OverrideField = keyof HopOverride;

/**
 * How each overridable field is named in prose, in the order the editor
 * shows them — so anything listing what a user changed reads in the
 * same sequence they typed.
 *
 * `Record<OverrideField, string>` is doing real work: add a field to
 * `HopOverride` and this stops compiling until it is named here, which
 * is what keeps `OVERRIDE_FIELDS` below exhaustive. A hand-maintained
 * list would go quietly stale, and the symptom would be a field the
 * user can set but never see marked as theirs or hand back.
 */
export const OVERRIDE_FIELD_LABELS: Record<OverrideField, string> = {
  mode: "mode",
  status: "status",
  departure: "departure",
  arrival: "arrival",
  cost: "cost",
  operator: "operator",
  bookingRef: "booking reference",
  bookingUrl: "booking link",
  notes: "notes",
};

/** Every overridable field, in editor order. Derived, never retyped. */
export const OVERRIDE_FIELDS = Object.keys(
  OVERRIDE_FIELD_LABELS,
) as OverrideField[];

/**
 * Which fields the user has an opinion about.
 *
 * An explicit `undefined` sitting in the record is not an opinion —
 * `{ mode: undefined }` means the same as `{}`, per the model's note
 * that an absent field means "keep whatever the engine proposed".
 */
export function overriddenFields(override?: HopOverride): OverrideField[] {
  if (!override) return [];
  return OVERRIDE_FIELDS.filter((field) => override[field] !== undefined);
}

export function hasOverrides(override?: HopOverride): boolean {
  return overriddenFields(override).length > 0;
}

/** "mode and cost are yours" / "mode, cost and notes are yours" */
export function describeOverrides(override?: HopOverride): string | undefined {
  const fields = overriddenFields(override).map(
    (field) => OVERRIDE_FIELD_LABELS[field],
  );
  if (fields.length === 0) return undefined;

  const list =
    fields.length === 1
      ? fields[0]
      : `${fields.slice(0, -1).join(", ")} and ${fields.at(-1)}`;

  return `You set the ${list} on this hop`;
}

/**
 * The two writes the hop editor makes.
 *
 * TODO(unit-7): these belong in `TripAction` and Unit 7 owns that file,
 * so they are declared here and the editor takes a dispatch function
 * typed against them. When Unit 7 lands, this union should be deleted
 * and the editor retyped against `TripAction` — the shapes are chosen
 * to match the names the batch agreed on.
 *
 * SEMANTICS THE REDUCER MUST HONOUR, because the editor depends on
 * both and neither is inferable from the name:
 *
 *   * `set-hop-override` MERGES. Only the fields present in `override`
 *     change; everything else the user already said about this hop
 *     stays. The editor sends one field at a time.
 *   * `clear-hop-override` with a `field` removes THAT field, handing
 *     it back to the route engine. With no `field` it drops the whole
 *     override, so the hop is purely the engine's proposal again — and
 *     an override with no fields left should not linger in the record.
 */
export type HopOverrideAction =
  | { type: "set-hop-override"; hop: HopId; override: HopOverride }
  | { type: "clear-hop-override"; hop: HopId; field?: OverrideField };
