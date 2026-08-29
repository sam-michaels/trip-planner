// ============================================================
// One derived hop, collapsed.
//
// The card is a summary, not a form: it shows what you'd want when
// scanning the whole trip — where, how, how firm, when, how much —
// and everything else waits behind the edit button.
//
// THREE FACTS, THREE CHANNELS, AND NO TWO OF THEM SHARE A PALETTE:
//
//   * MODE — what kind of journey this is — is the icon chip on the
//     left, in that mode's colour. Same colour the map draws the
//     route in, so a row and a line find each other.
//   * STATUS — how firm the plan is — is the pill on the right, in
//     that status's colour, which is the SAME on every card.
//   * PROVENANCE — whether this hop is still the route engine's guess
//     or carries something you said — is the plain bark chip on the
//     meta line. Every leg is derived now, so "did I touch this?" is a
//     question you can genuinely no longer answer from the values
//     alone: an operator on a card is just as likely to be the
//     engine's proposal as your booking. Bark rather than a mode or
//     status colour, because provenance is a third fact and borrowing
//     either palette would make "Yours" read as a plan state.
//
// Mode and status used to share one swatch: the status pill was
// painted in the mode colour, so "Idea" was terracotta on the flight
// and pine on the train. That made the pill useless for the one job it
// has — letting you sweep the list and see how much of the trip is
// still a sketch — because you were comparing three different colours
// all called Idea.
// ============================================================

import { GripVertical, Pencil, StickyNote } from "lucide-react";
import type { DragEvent, KeyboardEvent } from "react";

import type { HopOverride, Leg } from "../model/trip";
import { formatDateTime } from "./datetime";
import { crossesTimezones, formatDuration, travelDuration } from "./duration";
import { describeOverrides } from "./hopOverrides";
import {
  MODE_COLORS,
  MODE_ICONS,
  MODE_LABELS,
  STATUS_LABELS,
  STATUS_PILL_CLASSES,
  formatMoney,
} from "./labels";

interface LegCardProps {
  leg: Leg;
  /**
   * What the user said about this hop, if anything — found through
   * `overrideForLeg(trip.hopOverrides, leg.id)`, never by indexing
   * `hopOverrides` with the leg id directly: a repeated hop's leg id
   * carries an occurrence suffix its override does not. See
   * hopOverrides.ts.
   */
  override?: HopOverride;
  /**
   * True when this row is a hop the route engine proposed, which is
   * what licenses the card to say "From the route" about an empty one.
   *
   * NOT inferred from `override` being absent: a hand-assembled leg
   * also has no override, and telling someone the engine proposed the
   * leg they just typed in by hand is worse than saying nothing.
   * Defaults to false so the legacy list keeps its old wording.
   */
  derived?: boolean;
  selected: boolean;
  onSelect: () => void;
  onEdit: () => void;
  /**
   * Reordering is OPTIONAL, and absent for derived hops. You reorder a
   * trip by reordering its destinations; dragging a hop would be asking
   * to move a consequence independently of its cause. The props survive
   * for the legacy hand-assembled list only, and the grip only appears
   * when a caller actually supplies them.
   */
  dragging?: boolean;
  onDragStart?: () => void;
  onDragEnd?: () => void;
  /** Pointer moved over this card: `after` says which half it's in. */
  onDragOverHalf?: (after: boolean) => void;
  /** Keyboard reordering, in list positions (-1 = up, +1 = down). */
  onNudge?: (delta: number) => void;
}

export function LegCard({
  leg,
  override,
  derived = false,
  selected,
  dragging = false,
  onSelect,
  onEdit,
  onDragStart,
  onDragEnd,
  onDragOverHalf,
  onNudge,
}: LegCardProps) {
  const Icon = MODE_ICONS[leg.mode];
  const color = MODE_COLORS[leg.mode];
  const booked = leg.status === "booked";
  const duration = travelDuration(leg);
  const withinOneCity =
    leg.from.city === leg.to.city && leg.from.country === leg.to.country;
  const reorderable = onDragStart !== undefined;
  const overrideNote = describeOverrides(override);

  function handleDragOver(event: DragEvent<HTMLDivElement>) {
    if (!onDragOverHalf) return;
    // Without preventDefault the browser refuses the drop outright —
    // the default for most elements is "not a drop target".
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    onDragOverHalf(event.clientY > rect.top + rect.height / 2);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    // Alt+arrows, because drag-and-drop is unreachable by keyboard and
    // an itinerary you can't rearrange without a mouse is only half
    // usable. Alt keeps plain arrows free for scrolling the list.
    if (!onNudge || !event.altKey) return;

    if (event.key === "ArrowUp") {
      event.preventDefault();
      onNudge(-1);
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      onNudge(1);
    }
  }

  // The meta line collapses whatever is known into one readable run.
  // Early on that's often nothing, and an empty row reads as broken —
  // so naming the missing piece turns a blank into an invitation.
  const meta = [
    leg.departure ? formatDateTime(leg.departure) : undefined,
    duration ? formatDuration(duration) : undefined,
    !duration && crossesTimezones(leg) ? "crosses time zones" : undefined,
    leg.operator,
  ]
    .filter(Boolean)
    .join(" · ");

  const endpoints = withinOneCity
    ? `${leg.from.name} to ${leg.to.name}`
    : `${leg.from.city} to ${leg.to.city}`;

  return (
    <div
      draggable={reorderable}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragOver={handleDragOver}
      className={`group relative flex rounded-xl border bg-parchment transition ${
        selected ? "shadow-sm" : "border-bark-200 hover:border-bark-300"
      } ${dragging ? "opacity-40" : ""}`}
      style={
        selected
          ? { borderColor: color, boxShadow: `0 0 0 3px ${color}26` }
          : undefined
      }
    >
      <button
        type="button"
        onClick={onSelect}
        onKeyDown={handleKeyDown}
        aria-pressed={selected}
        className={`min-w-0 flex-1 rounded-l-xl py-2 pr-1 pl-1.5 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-moss-500 ${
          reorderable ? "cursor-grab active:cursor-grabbing" : ""
        }`}
      >
        <div className="flex items-center gap-1.5">
          {reorderable && (
            <GripVertical
              className="size-3.5 shrink-0 text-bark-300 group-hover:text-bark-400"
              aria-hidden
            />
          )}

          {/* Colour and glyph both say what kind of journey this is;
              filled-versus-dashed says how firm it is. */}
          <span
            className="flex size-6 shrink-0 items-center justify-center rounded-full border"
            style={
              booked
                ? { backgroundColor: color, borderColor: color, color: "#fdfcf6" }
                : {
                    borderColor: color,
                    borderStyle: "dashed",
                    backgroundColor: `${color}14`,
                    color,
                  }
            }
          >
            <Icon className="size-3.5" aria-label={MODE_LABELS[leg.mode]} />
          </span>

          {/* A transfer within one city would otherwise read
              "Lisbon → Lisbon", which says nothing. Naming the two
              stations is the only informative version of that row. */}
          <span className="min-w-0 flex-1 truncate text-sm font-medium text-bark-900">
            {withinOneCity ? leg.from.name : leg.from.city}{" "}
            <span className="text-bark-400">→</span>{" "}
            {withinOneCity ? leg.to.name : leg.to.city}
          </span>

          {/* Status is a property of the plan, not of the journey, so
              it is the SAME colour on every card — that's what makes
              "how much of this is still an idea?" answerable by
              sweeping the list rather than reading it. */}
          <span
            className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${STATUS_PILL_CLASSES[leg.status]}`}
          >
            {STATUS_LABELS[leg.status]}
          </span>
        </div>

        <p
          className={`mt-1 truncate text-xs text-bark-500 ${reorderable ? "ml-11" : "ml-6"}`}
        >
          {withinOneCity
            ? `Across ${leg.from.city}`
            : `${leg.from.name} → ${leg.to.name}`}
        </p>

        <div
          className={`mt-0.5 flex items-baseline gap-2 ${reorderable ? "ml-11" : "ml-6"}`}
        >
          <span className="min-w-0 flex-1 truncate text-xs text-bark-400">
            {meta ||
              (derived && !overrideNote
                ? "From the route — nothing set yet"
                : "No date or operator yet")}
          </span>

          {overrideNote && (
            <span
              title={overrideNote}
              className="shrink-0 rounded-full border border-bark-200 bg-bark-50 px-1.5 py-px text-[10px] font-medium text-bark-600"
            >
              <span aria-hidden>Yours</span>
              <span className="sr-only">{overrideNote}</span>
            </span>
          )}

          {leg.notes && (
            <StickyNote
              className="size-3 shrink-0 text-bark-300"
              aria-label="Has notes"
            />
          )}

          {leg.cost && (
            <span className="shrink-0 text-xs font-medium text-bark-700 tabular-nums">
              {formatMoney(leg.cost)}
            </span>
          )}
        </div>
      </button>

      <button
        type="button"
        onClick={onEdit}
        aria-label={`Edit ${endpoints}`}
        className="shrink-0 self-stretch rounded-r-xl px-2 text-bark-300 transition hover:bg-bark-50 hover:text-bark-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-moss-500"
      >
        <Pencil className="size-3.5" aria-hidden />
      </button>
    </div>
  );
}
