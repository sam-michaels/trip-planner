// ============================================================
// Time handling for leg departures and arrivals.
//
// THE FORMAT DECISION, because everything here depends on it:
// times are stored as local wall-clock ISO 8601 with NO timezone
// offset — "2026-09-12T14:00".
//
// WHY NO OFFSET / NO "Z":
//
//   1. These strings compare correctly as plain strings — chronological
//      order and lexicographic order coincide — but ONLY if every
//      timestamp in the trip shares one format. Mixing
//      "2026-09-12T14:00" with "2026-09-12T14:00:00Z" compares them by
//      punctuation rather than by time. Itinerary order no longer
//      depends on this (it's array position now, see the banner on
//      `Trip.destinations`), but "is this hop before that one?" still
//      does, and one format removes the whole failure mode.
//
//   2. `<input type="datetime-local">` both produces and consumes
//      exactly this string, so the form boundary needs no conversion —
//      and conversion is where timezone bugs are born.
//
//   3. It is what a ticket actually says. A boarding pass reading
//      "14:05" means 14:05 where you are standing, not an instant on
//      a UTC line. Storing the wall-clock time keeps the record true
//      to the document it came from.
//
// THE COST, so it isn't discovered the hard way later: subtracting two
// of these across timezones does NOT give a real duration. Toronto
// 20:15 → Lisbon 08:30 is a 7h flight that arithmetic here will call
// 12h15m. Nothing in this step displays durations, so that's fine for
// now — but a duration feature must resolve each endpoint's timezone
// from `Place.coords` first, not just subtract.
// ============================================================

/** "YYYY-MM-DDTHH:mm" — what `<input type="datetime-local">` speaks. */
const LOCAL_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** Milliseconds since epoch, interpreting the string as local time. */
export function toMillis(value: string): number {
  return new Date(value).getTime();
}

/** Milliseconds -> the storage format above. */
export function fromMillis(ms: number): string {
  const d = new Date(ms);
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}`
  );
}

/**
 * Coerce whatever is on a leg into the exact string the datetime-local
 * input wants. Legs created before this format was settled (or typed
 * in by hand) may carry seconds or an offset; rather than rejecting
 * them, round-trip through Date so the input still shows something
 * editable. Returns "" for absent or unparseable values, which is what
 * an empty datetime-local input reads as.
 */
export function toInputValue(value: string | undefined): string {
  if (!value) return "";
  if (LOCAL_DATETIME.test(value)) return value;

  const ms = toMillis(value);
  return Number.isNaN(ms) ? "" : fromMillis(ms);
}

/** Empty input -> `undefined`, so an unset time stays genuinely absent. */
export function fromInputValue(value: string): string | undefined {
  return value.trim() === "" ? undefined : value;
}

/**
 * Offset a time by a number of hours, e.g. an arrival from a departure
 * plus a journey length.
 *
 * (`midpoint` used to live beside this. It existed only to slot a
 * dragged leg between its two neighbours' departures, and it went with
 * the drag code — destinations carry explicit order now, so nothing
 * ever needs a time chosen for it to hold a position.)
 */
export function shiftHours(value: string, hours: number): string {
  return fromMillis(toMillis(value) + hours * 3_600_000);
}

/**
 * Human-readable form: "Sat 12 Sep, 14:00".
 *
 * The year is appended only when it isn't the current one — trips are
 * usually planned within a year, and a repeated "2026" on every row is
 * noise that makes the genuinely varying part harder to scan.
 */
export function formatDateTime(value: string): string {
  const ms = toMillis(value);
  if (Number.isNaN(ms)) return value;

  const date = new Date(ms);
  const showYear = date.getFullYear() !== new Date().getFullYear();

  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: showYear ? "numeric" : undefined,
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}
