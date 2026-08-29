// ============================================================
// One destination: somewhere you want to BE.
//
// This is the card the whole app is about. Everything on it is
// optional except the place itself, and it has to look right — not
// merely not-crash — when nothing but the name is known, because that
// is the state every trip starts in and spends most of its life in.
//
// THE NIGHTS STEPPER, AND WHY "I DON'T KNOW YET" IS A VALUE:
// an unset night count is not an empty field waiting to be filled in,
// it's an honest answer, so it renders as one — plain text in the
// same place a number would go, no red, no asterisk, no "required".
// The cycle runs
//
//     unknown --(+)--> 1 --(-)--> 0 ("day trip") --(-)--> unknown
//
// so there is a way BACK to not knowing without a third button. You
// learn things about a trip and you also un-learn them; a stepper
// that can only ever count up quietly insists you've decided.
//
// TWO CHANNELS, TWO PALETTES, as everywhere else in this app: the
// status pill carries how firm the plan is (heather → ochre → moss)
// and nothing else on the card competes with it. The order badge is
// bark, deliberately colourless — position is a fact about the list,
// not about the plan.
// ============================================================

import { GripVertical, Minus, Plus, StickyNote, X } from "lucide-react";
import type { DragEvent, KeyboardEvent } from "react";

import type { Destination, PlanStatus } from "../model/trip";
import { formatDateTime } from "./datetime";
import { STATUS_LABELS, STATUS_PILL_CLASSES, placeSubtitle } from "./labels";

/** Cycled by the pill, in the order a plan actually firms up. */
const STATUS_CYCLE: Record<PlanStatus, PlanStatus> = {
  idea: "planned",
  planned: "booked",
  booked: "idea",
};

interface DestinationCardProps {
  destination: Destination;
  /** Position in the list, zero-based — shown as 1-based. */
  index: number;
  total: number;
  /** True while this card is the one being dragged, so it can fade out. */
  dragging: boolean;
  onNights: (nights: number | undefined) => void;
  onStatus: (status: PlanStatus) => void;
  onRemove: () => void;
  onDragStart: () => void;
  onDragEnd: () => void;
  /** Pointer moved over this card: `after` says which half it's in. */
  onDragOverHalf: (after: boolean) => void;
  /** Keyboard reordering, in list positions (-1 = up, +1 = down). */
  onNudge: (delta: number) => void;
}

export function DestinationCard({
  destination,
  index,
  total,
  dragging,
  onNights,
  onStatus,
  onRemove,
  onDragStart,
  onDragEnd,
  onDragOverHalf,
  onNudge,
}: DestinationCardProps) {
  const { place, nights, status } = destination;

  function handleDragStart(event: DragEvent<HTMLDivElement>) {
    // Firefox refuses to start a drag whose `dataTransfer` carries
    // nothing at all — the card would simply not lift. The payload
    // itself is unused (the panel tracks what's in flight in state);
    // it exists so the drag is legal in every browser.
    event.dataTransfer.setData("text/plain", destination.id);
    event.dataTransfer.effectAllowed = "move";
    onDragStart();
  }

  function handleDragOver(event: DragEvent<HTMLDivElement>) {
    // Without preventDefault the browser refuses the drop outright —
    // the default for most elements is "not a drop target".
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    onDragOverHalf(event.clientY > rect.top + rect.height / 2);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLElement>) {
    // Alt+arrows, because HTML5 drag-and-drop is unreachable by
    // keyboard and an itinerary you can't rearrange without a mouse is
    // only half usable. Alt keeps plain arrows free for scrolling.
    if (!event.altKey) return;

    if (event.key === "ArrowUp" && index > 0) {
      event.preventDefault();
      onNudge(-1);
    } else if (event.key === "ArrowDown" && index < total - 1) {
      event.preventDefault();
      onNudge(1);
    }
  }

  return (
    <div
      draggable
      onDragStart={handleDragStart}
      onDragEnd={onDragEnd}
      onDragOver={handleDragOver}
      className={`rounded-xl border border-bark-200 bg-parchment transition hover:border-bark-300 ${
        dragging ? "opacity-40" : ""
      }`}
    >
      <div className="flex items-start gap-1.5 px-1.5 py-2">
        {/*
          The handle is a real button, not a decorative glyph: it's the
          keyboard's way into reordering, and its label is where the
          Alt+arrow shortcut is announced. Everything the mouse can do
          by dragging the card, the keyboard can do from here.
        */}
        <button
          type="button"
          onKeyDown={handleKeyDown}
          aria-label={`Move ${place.city}, stop ${index + 1} of ${total}. Hold Alt and press the up or down arrow to reorder.`}
          className="mt-0.5 shrink-0 cursor-grab rounded-md p-0.5 text-bark-300 transition hover:bg-bark-50 hover:text-bark-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-moss-500 active:cursor-grabbing"
        >
          <GripVertical className="size-3.5" aria-hidden />
        </button>

        <span
          aria-hidden
          className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-bark-100 text-[11px] font-semibold text-bark-600 tabular-nums"
        >
          {index + 1}
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-bark-900">
                {place.city}
              </p>
              <p className="truncate text-xs text-bark-500">
                {place.name === place.city
                  ? placeSubtitle(place)
                  : `${place.name} · ${placeSubtitle(place)}`}
              </p>
            </div>

            <button
              type="button"
              onClick={() => onStatus(STATUS_CYCLE[status])}
              aria-label={`Status: ${STATUS_LABELS[status]}. Change to ${STATUS_LABELS[STATUS_CYCLE[status]]}.`}
              className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium transition hover:brightness-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-moss-500 ${STATUS_PILL_CLASSES[status]}`}
            >
              {STATUS_LABELS[status]}
            </button>

            <button
              type="button"
              onClick={onRemove}
              aria-label={`Remove ${place.city} from the trip`}
              className="shrink-0 rounded-md p-1 text-bark-300 transition hover:bg-rust-50 hover:text-rust-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-moss-500"
            >
              <X className="size-3.5" aria-hidden />
            </button>
          </div>

          <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
            <NightsStepper
              city={place.city}
              nights={nights}
              onNights={onNights}
            />

            {/* Decoration, never the ordering key — see the note on
                `Destination.arrival`. Shown only when it's known. */}
            {destination.arrival && (
              <span className="text-[11px] text-bark-400">
                arrive {formatDateTime(destination.arrival)}
              </span>
            )}
          </div>

          {destination.notes && (
            <p className="mt-1.5 flex items-start gap-1 text-[11px] leading-snug text-bark-500">
              <StickyNote
                className="mt-px size-3 shrink-0 text-bark-300"
                aria-hidden
              />
              {destination.notes}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * How long you're staying, including "no idea".
 *
 * The label is the same size and in the same place in all three
 * states, so the row doesn't reflow as a trip firms up — and so the
 * unknown state reads as one of the answers rather than as a hole
 * where an answer should be.
 */
function NightsStepper({
  city,
  nights,
  onNights,
}: {
  city: string;
  nights: number | undefined;
  onNights: (nights: number | undefined) => void;
}) {
  const known = nights !== undefined;

  const label = !known
    ? "Nights?"
    : nights === 0
      ? "Day trip"
      : `${nights} ${nights === 1 ? "night" : "nights"}`;

  return (
    <div
      role="group"
      aria-label={`Nights in ${city}`}
      className={`flex items-center rounded-lg border ${
        known ? "border-bark-200 bg-bark-50" : "border-dashed border-bark-300"
      }`}
    >
      <button
        type="button"
        // Down from 1 is a day trip; down from a day trip is back to
        // not knowing. There is no fourth step below that.
        onClick={() => onNights(nights === 0 ? undefined : (nights ?? 1) - 1)}
        disabled={!known}
        aria-label={
          nights === 0 ? `Clear nights in ${city}` : `One night fewer in ${city}`
        }
        className="rounded-l-lg px-1.5 py-1 text-bark-500 transition hover:bg-bark-100 hover:text-bark-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-moss-500 disabled:cursor-default disabled:opacity-30 disabled:hover:bg-transparent"
      >
        <Minus className="size-3" aria-hidden />
      </button>

      <span
        className={`min-w-16 px-1 text-center text-[11px] font-medium tabular-nums ${
          known ? "text-bark-700" : "text-bark-400"
        }`}
      >
        {label}
      </span>

      <button
        type="button"
        // From "no idea" the useful first guess is one night, not zero.
        onClick={() => onNights(known ? nights + 1 : 1)}
        aria-label={`One night more in ${city}`}
        className="rounded-r-lg px-1.5 py-1 text-bark-500 transition hover:bg-bark-100 hover:text-bark-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-moss-500"
      >
        <Plus className="size-3" aria-hidden />
      </button>
    </div>
  );
}
