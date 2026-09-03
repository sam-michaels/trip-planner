// ============================================================
// "How do you want to get to the airport?"
//
// The third question, and the only one the app can't ask until it has
// heard the first two — it exists when the trip starts by getting you
// to an airport in some other city. If you fly out of your own city
// there's no journey to choose a mode for, and this never renders.
//
// TWO KINDS OF ANSWER, WHICH IS WHY THIS ISN'T ONE MECHANISM:
//
//   * Car, bus, train — the same hop, travelled differently. That's a
//     `HopOverride` on the access hop, exactly what the hop editor
//     writes when you disagree with the engine anywhere else.
//   * Flight — a different SHAPE of trip: London → YXU → YYZ → LIS is
//     four hops where the bus version is three. An override can't add
//     a hop, so this picks a different `RouteOption` instead, by id,
//     which is what `pickRoutes` is built to consume.
//
// Both are existing mechanisms. The row's whole job is knowing which
// question each icon is answering.
//
// NO PRICES, DELIBERATELY. No free service quotes a bus fare, and an
// invented number is worse than a blank the traveller fills in from
// the booking site — `RouteHop.cost` is optional precisely so a blank
// is representable. Times are estimates from distance and a per-mode
// average speed, rounded to five minutes, because the honest precision
// here is "about two hours".
// ============================================================

import type { HopId, Place, TransportMode } from "../model/trip";
import { hopId } from "../model/trip";
import type { RouteOption } from "../lib/routing";
import { accessOptions, accessPair } from "../lib/routing";
import { MODE_ICONS, MODE_LABELS } from "../itinerary/labels";

/** One icon in the row: a mode, roughly how long, and what picking it does. */
interface Choice {
  mode: TransportMode;
  estimateMinutes?: number;
  /**
   * The route to select instead, when this choice changes the shape of
   * the trip rather than the mode of one hop. Absent for ground modes.
   */
  optionId?: string;
}

interface AccessRowProps {
  from: Place;
  /** Every option the engine proposed for this pair, in its own order. */
  options: readonly RouteOption[];
  /** The route currently in effect — the one the icons are compared against. */
  chosenId?: string;
  currentMode?: TransportMode;
  onPickMode: (hop: HopId, mode: TransportMode) => void;
  onPickRoute: (optionId: string) => void;
}

export function AccessRow({
  from,
  options,
  chosenId,
  currentMode,
  onPickMode,
  onPickRoute,
}: AccessRowProps) {
  const pair = accessPair(options);
  if (!pair) return null;

  // Where the access portion ends — the airport the traveller has to
  // reach before the trip proper starts.
  const hub = pair.overland.hops[0]?.to;
  if (!hub) return null;

  // The local airport the engine already found, handed back to
  // `accessOptions` so it doesn't have to look one up again — and so
  // the flight option here is the same flight the engine proposed,
  // not a second opinion about it.
  const via = pair.flown?.hops[0]?.to;

  const choices: Choice[] = accessOptions(
    from,
    hub,
    via ? [via] : [],
  ).flatMap<Choice>((option) => {
    if (option.mode !== "flight") {
      return [{ mode: option.mode, estimateMinutes: option.estimateMinutes }];
    }
    // An air access option with no chain to select is a claim the
    // itinerary can't represent, so it isn't offered.
    return pair.flown
      ? [
          {
            mode: "flight",
            estimateMinutes: option.estimateMinutes,
            optionId: pair.flown.id,
          },
        ]
      : [];
  });

  if (choices.length < 2) return null;

  const accessHop = hopId(from, hub);
  const flownIsChosen = Boolean(pair.flown && chosenId === pair.flown.id);

  return (
    <div>
      <p className="text-label font-medium text-bark-800">
        Getting to {hub.city}
      </p>
      <p className="mt-0.5 text-caption text-bark-600">
        The trip starts by getting you to {hub.name}.
      </p>

      {/*
        A radio group, not a row of buttons: these are one choice with
        several answers, and a screen reader should hear it that way.
        Arrow keys move between radios for free — PRODUCT.md makes WCAG
        2.2 AA binding, and keyboard parity is the part a row of
        buttons quietly fails.
      */}
      <div
        role="radiogroup"
        aria-label={`How to reach ${hub.city}`}
        className="mt-2 flex flex-wrap gap-2"
      >
        {choices.map((choice) => {
          const Icon = MODE_ICONS[choice.mode];
          const selected = choice.optionId
            ? flownIsChosen
            : !flownIsChosen && currentMode === choice.mode;

          return (
            <button
              key={choice.mode}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() =>
                choice.optionId
                  ? onPickRoute(choice.optionId)
                  : onPickMode(accessHop, choice.mode)
              }
              className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-label transition focus:outline-none focus-visible:ring-2 focus-visible:ring-moss-500 ${
                selected
                  ? "border-moss-500 bg-moss-50 font-semibold text-bark-900"
                  : // Weight is the hover channel, per the ask — the
                    // border and background stay put so the row doesn't
                    // shift under the cursor. `focus-visible` gets the
                    // same treatment: a keyboard user is hovering too.
                    "border-bark-200 bg-parchment font-medium text-bark-700 hover:font-semibold hover:text-bark-900 focus-visible:font-semibold"
              }`}
            >
              <Icon className="size-4 shrink-0" aria-hidden />
              {MODE_LABELS[choice.mode]}
              {choice.estimateMinutes !== undefined && (
                <span className="text-caption font-normal text-bark-600">
                  {formatDuration(choice.estimateMinutes)}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** "2h 40m", "45m" — the shape an estimate should read in. */
function formatDuration(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest}m`;
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
}
