// ============================================================
// The space between two legs.
//
// This used to be a warning that only appeared when something was
// wrong. It's now the spine of the list, and it always says
// something — because the space between two legs isn't empty, it's
// where the trip actually happens. Three nights in Lisbon is the
// point of going to Lisbon; the flight is just how you got there.
//
// It carries, in order of urgency:
//
//   * a hard gap — the itinerary doesn't connect, you're departing
//     from a city you never arranged to reach;
//   * a soft gap — right city, wrong station, so you need a way
//     across town;
//   * otherwise, how long you're there.
//
// WHY THE SOFT CASE STOPPED LOOKING LIKE AN ERROR: arriving at an
// airport and leaving from a downtown station is not a mistake. It's
// the normal shape of a trip, and every single itinerary has several.
// Painting it as a warning meant the list was permanently full of
// alarms about nothing, which is exactly how people learn to ignore
// the hard gaps that do matter. Now it's an offer: here's the hop
// across town, want to add it?
//
// THE THREE LINES: headline (the true thing — "3h 40m in Toronto"),
// interlude (the recognisable thing — what an afternoon in an airport
// is actually like, see interludes.ts), detail (the route, when
// there's a gap to name). The middle one is the only part of the app
// with a sense of humour, and it's deliberately the quietest text on
// screen: it's there when you slow down and read the trip, and it
// gets out of the way when you're scanning it. Hard gaps don't get
// one — a joke under a warning is how a warning becomes wallpaper.
// ============================================================

import { Plus, TriangleAlert } from "lucide-react";

import type { ItineraryGap, Leg, Place } from "../model/trip";
import type { DescribedStop } from "./duration";
import { describeStop, dotCountForDuration, timeInPlace } from "./duration";
import { interludeFor } from "./interludes";
import { MODE_COLORS } from "./labels";

type Tone = "quiet" | "invite" | "alert";

interface LegConnectorProps {
  arriving: Leg;
  departing: Leg;
  gap?: ItineraryGap;
  onAddLeg: (options: {
    from: Place;
    to: Place;
    /** Seeded from the arriving leg so a transfer starts when you land. */
    departure?: string;
  }) => void;
}

export function LegConnector({
  arriving,
  departing,
  gap,
  onAddLeg,
}: LegConnectorProps) {
  // The spine flows out of the leg you arrived on, so a stop reads as
  // that journey pausing rather than as an unrelated strip of text.
  const color = MODE_COLORS[arriving.mode];
  const stopMs = timeInPlace(arriving, departing);
  const stop =
    stopMs === undefined || !arriving.arrival || !departing.departure
      ? undefined
      : describeStop(arriving.arrival, departing.departure, arriving.to);

  const tone: Tone = gap?.severity === "hard" ? "alert" : gap ? "invite" : "quiet";

  // A stay is a longer pause than a connection, and the spine should
  // show that. Gaps get a fixed short run so they stay compact — the
  // length of the hop across town isn't the point, the fact that it
  // isn't booked is.
  const dots = gap ? 4 : dotCountForDuration(stopMs);

  const { headline, note, detail, action } = describe(gap, stop, arriving, departing);

  const interlude =
    tone === "alert"
      ? undefined
      : interludeFor({
          arriving,
          departing,
          acrossTown: Boolean(gap),
          kind: stop?.kind,
        });

  return (
    <div className="flex gap-3 pl-3">
      <Dots count={dots} tone={tone} color={color} />

      <div className="flex min-w-0 flex-1 items-start gap-2 py-1.5">
        <div className="min-w-0 flex-1">
          <p
            className={`text-xs ${HEADLINE_CLASSES[tone]}`}
            style={tone === "quiet" ? { color } : undefined}
          >
            {headline}
          </p>

          {/* How long you're here, when the headline was busy saying
              something else. Above the interlude and never truncated:
              three nights in a city is the single most plannable fact
              on this strip and it isn't allowed to fall off the end
              of a line. */}
          {note && (
            <p className="mt-0.5 text-[11px] font-medium text-bark-500">
              {note}
            </p>
          )}

          {/* Allowed to wrap, unlike everything else in this strip:
              it's a sentence, and a truncated joke is just litter. */}
          {interlude && (
            <p className="mt-0.5 text-[11px] leading-snug text-bark-400 italic">
              {interlude}
            </p>
          )}

          {detail && (
            <p className="mt-0.5 truncate text-[11px] text-bark-400">
              {detail}
            </p>
          )}
        </div>

        {action && (
          <button
            type="button"
            onClick={() =>
              onAddLeg({
                from: action.from,
                to: action.to,
                // Without this the new leg lands between two dated
                // neighbours with no date of its own, and `moveLeg`
                // invents a midpoint — a station transfer dated a day
                // and a half after you landed.
                departure: arriving.arrival,
              })
            }
            className={`flex shrink-0 items-center gap-1 rounded-md border px-1.5 py-1 text-[11px] font-medium transition focus:outline-none focus-visible:ring-2 ${ACTION_CLASSES[tone]}`}
          >
            <Plus className="size-3" aria-hidden />
            {action.label}
          </button>
        )}
      </div>
    </div>
  );
}

const HEADLINE_CLASSES: Record<Tone, string> = {
  quiet: "font-medium",
  invite: "font-medium text-ochre-700",
  alert: "flex items-center gap-1 font-medium text-rust-700",
};

const ACTION_CLASSES: Record<Tone, string> = {
  quiet:
    "border-transparent text-moss-600/70 hover:border-moss-200 hover:bg-moss-50 hover:text-moss-700 focus-visible:ring-moss-500",
  invite:
    "border-ochre-200 bg-ochre-50 text-ochre-700 hover:bg-ochre-100 focus-visible:ring-ochre-500",
  alert:
    "border-rust-200 bg-rust-50 text-rust-700 hover:bg-rust-100 focus-visible:ring-rust-500",
};

interface Described {
  headline: React.ReactNode;
  /** How long you're here, when the headline is saying something else. */
  note?: string;
  detail?: string;
  action?: { label: string; from: Place; to: Place };
}

function describe(
  gap: ItineraryGap | undefined,
  stop: DescribedStop | undefined,
  arriving: Leg,
  departing: Leg,
): Described {
  if (gap?.severity === "hard") {
    return {
      headline: (
        <>
          <TriangleAlert className="size-3.5 shrink-0" aria-hidden />
          Nothing connects these
        </>
      ),
      detail: `${gap.from.name} → ${gap.to.name}`,
      action: { label: "Add leg", from: gap.from, to: gap.to },
    };
  }

  if (gap) {
    // Same city, two different stations. "Getting across Lisbon" is
    // the whole story in three words, and it's what the button beside
    // it does — so it leads even when the times are known. The stay
    // drops to its own line rather than elbowing the headline aside,
    // and uses the short form, because the headline just said Lisbon.
    return {
      headline: `Getting across ${gap.from.city}`,
      note: stop?.short,
      detail: `${gap.from.name} → ${gap.to.name}`,
      action: { label: "Add transfer", from: gap.from, to: gap.to },
    };
  }

  if (stop) {
    return {
      headline: stop.headline,
      // Offering to fill a long stay with something is only meaningful
      // once it IS a stay — nobody plans an afternoon around a 40
      // minute connection.
      action:
        stop.kind === "stay"
          ? { label: "Add a leg here", from: arriving.to, to: departing.from }
          : undefined,
    };
  }

  // No dates yet — the common state early on. Stay quiet rather than
  // nagging: name the place so the spine still reads as a journey.
  // The interlude underneath still says what you'll be doing here,
  // which is the part that doesn't need a date to be true.
  return { headline: arriving.to.city };
}

const DOT_CLASSES: Record<Tone, string> = {
  quiet: "",
  invite: "bg-ochre-500/60",
  alert: "bg-rust-400/70",
};

/**
 * The translucent run of dots. Deliberately not a solid line: a line
 * reads as "these are joined", and the whole point of this strip is
 * that the two legs are *not* joined — there's time, and sometimes a
 * missing journey, in between.
 *
 * The run swells in the middle — bigger, more opaque dots in the
 * centre, fading at both ends. It's the shape a stitched seam makes,
 * and it does two things at once: it reads as travel rather than as a
 * ruler, and the taper points the eye out of the leg above and into
 * the leg below instead of stopping dead at both ends.
 */
function Dots({
  count,
  tone,
  color,
}: {
  count: number;
  tone: Tone;
  color: string;
}) {
  return (
    <div
      aria-hidden
      className="flex w-4 shrink-0 flex-col items-center justify-center gap-1 py-1"
    >
      {Array.from({ length: count }, (_, index) => {
        // 0 at either end, 1 in the middle. A two-dot run has no
        // middle, so it stays flat rather than dividing by zero.
        const swell =
          count < 3 ? 1 : 1 - Math.abs(index - (count - 1) / 2) / ((count - 1) / 2);

        return (
          <span
            key={index}
            className={`shrink-0 rounded-full ${DOT_CLASSES[tone]}`}
            style={{
              width: `${3 + swell * 2}px`,
              height: `${3 + swell * 2}px`,
              // Gaps override the mode colour, because a problem
              // shouldn't be colour-coded by whichever journey happens
              // to precede it — so they take opacity from the class
              // above and only the quiet case is painted here.
              ...(tone === "quiet"
                ? { backgroundColor: color, opacity: 0.3 + swell * 0.45 }
                : { opacity: 0.55 + swell * 0.45 }),
            }}
          />
        );
      })}
    </div>
  );
}
