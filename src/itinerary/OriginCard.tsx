// ============================================================
// Where the trip starts from.
//
// It sits at the top of the list, above the first destination,
// because that is what it is: the place the first journey leaves
// from. Everything below it is a consequence of it — change home from
// London, Ontario to Lisbon and every leg in the trip is a different
// journey.
//
// WHY THE PERMISSION PROMPT IS NEVER FIRED ON MOUNT: a geolocation
// prompt you didn't ask for is the web at its worst, and — worse for
// this app specifically — a denial is close to permanent. Chrome
// remembers it, and the user has to go into site settings to undo it.
// Spending that one-shot prompt on page load, before anyone has said
// they want it, risks burning the feature forever for a user who was
// only looking. So it fires on a click, and only on a click.
//
// WHY THE FAILURE MODES ARE NOT ONE ERROR MESSAGE:
// `detectHomeLocation()` returns a tagged result precisely so this
// card can tell the difference between "try that again" and "that is
// never going to work". Offering a retry button for a denied
// permission is a lie: the browser will not re-prompt, so the button
// does nothing, twice, and then the user assumes the whole app is
// broken. Denied and unavailable go straight to the search box with
// no retry; no-fix and timeout — which are weather, not decisions —
// get one.
// ============================================================

import { Home, Loader2, LocateFixed, RotateCw } from "lucide-react";
import { useState } from "react";

import type { Place } from "../model/trip";
import type { HomeLocationResult } from "../lib/homeLocation";
import { detectHomeLocation } from "../lib/homeLocation";
import { placeSubtitle } from "./labels";
import { PlacePicker } from "./PlacePicker";

interface OriginCardProps {
  origin: Place;
  /** Places already in the trip, offered above a network search. */
  knownPlaces: Place[];
  onChange: (place: Place) => void;
}

type Detection =
  | { kind: "idle" }
  | { kind: "locating" }
  | { kind: "failed"; result: Exclude<HomeLocationResult, { kind: "found" }> };

/**
 * What each failure says, and whether trying again could possibly
 * help. The `retry` flag is a copy of the contract documented on
 * `HomeLocationResult` — the two must agree, and the doc comments
 * there are the source of truth.
 */
const FAILURES: Record<
  Exclude<HomeLocationResult, { kind: "found" }>["kind"],
  { message: string; retry: boolean }
> = {
  denied: {
    message:
      "Your browser is blocking location for this page, and it won't ask again. Search for your city instead.",
    retry: false,
  },
  unavailable: {
    message:
      "This browser can't share a location at all. Search for your city instead.",
    retry: false,
  },
  "no-match": {
    message:
      "Found your coordinates, but there's no town at them to name. Search for the nearest city.",
    retry: false,
  },
  "no-fix": {
    message:
      "Couldn't get a fix — usually a weak signal indoors rather than anything you did.",
    retry: true,
  },
  timeout: {
    message: "Locating took too long.",
    retry: true,
  },
  error: {
    message: "Couldn't reach the place lookup.",
    retry: true,
  },
};

export function OriginCard({ origin, knownPlaces, onChange }: OriginCardProps) {
  const [editing, setEditing] = useState(false);
  const [detection, setDetection] = useState<Detection>({ kind: "idle" });

  async function detect() {
    setDetection({ kind: "locating" });
    const result = await detectHomeLocation();

    if (result.kind === "found") {
      onChange(result.place);
      setDetection({ kind: "idle" });
      setEditing(false);
      return;
    }

    setDetection({ kind: "failed", result });
  }

  const failure =
    detection.kind === "failed" ? FAILURES[detection.result.kind] : undefined;

  return (
    <div className="rounded-xl border border-bark-200 bg-parchment">
      <div className="flex items-start gap-2 px-2.5 py-2">
        <span
          aria-hidden
          className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-moss-100 text-moss-700"
        >
          <Home className="size-3.5" />
        </span>

        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-medium tracking-wide text-bark-500 uppercase">
            Trip starts from
          </p>
          <p className="truncate text-sm font-semibold text-bark-900">
            {origin.name}
          </p>
          <p className="truncate text-xs text-bark-500">
            {placeSubtitle(origin)}
          </p>
        </div>

        <button
          type="button"
          onClick={() => {
            setEditing((open) => !open);
            setDetection({ kind: "idle" });
          }}
          aria-expanded={editing}
          className="shrink-0 rounded-md px-2 py-1 text-xs font-medium text-bark-500 transition hover:bg-bark-50 hover:text-bark-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-moss-500"
        >
          {editing ? "Done" : "Change"}
        </button>
      </div>

      {editing && (
        <div className="space-y-2 border-t border-bark-100 px-2.5 py-2">
          <PlacePicker
            label="Home city"
            value={origin}
            knownPlaces={knownPlaces}
            onChange={(place) => {
              onChange(place);
              setDetection({ kind: "idle" });
              setEditing(false);
            }}
          />

          {/* The prompt fires from here and nowhere else. */}
          {(detection.kind !== "failed" || failure?.retry) && (
            <button
              type="button"
              onClick={detect}
              disabled={detection.kind === "locating"}
              className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-bark-200 px-3 py-1.5 text-xs font-medium text-bark-600 transition hover:border-bark-300 hover:bg-bark-50 hover:text-bark-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-moss-500 disabled:opacity-60"
            >
              {detection.kind === "locating" ? (
                <>
                  <Loader2 className="size-3.5 animate-spin" aria-hidden />
                  Locating…
                </>
              ) : detection.kind === "failed" ? (
                <>
                  <RotateCw className="size-3.5" aria-hidden />
                  Try again
                </>
              ) : (
                <>
                  <LocateFixed className="size-3.5" aria-hidden />
                  Use my location
                </>
              )}
            </button>
          )}

          {detection.kind === "failed" && failure && (
            <p
              role="status"
              className="text-[11px] leading-snug text-bark-500"
            >
              {failure.message}
              {/* The underlying message only for the catch-all case,
                  where the tag alone doesn't say what went wrong. */}
              {detection.result.kind === "error" &&
                ` (${detection.result.message})`}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
