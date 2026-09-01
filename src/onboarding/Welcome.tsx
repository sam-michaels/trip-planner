// ============================================================
// The first-run popup: two questions before the shell means
// anything — where you're starting from, and where you want to go.
// See DESIGN.md's "Navigation" section (The One Modal Rule / The
// Modal Contract Rule) for why this is the app's only dialog and
// what it owes WCAG 2.2 AA.
//
// A native <dialog> opened with showModal() gives focus containment,
// Escape-to-close and a ::backdrop scrim for free — see
// src/test/setup.ts for what its jsdom shim does and doesn't emulate.
// ============================================================

import { Loader2, LocateFixed, RotateCcw } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

import type { Place } from "../model/trip";
import {
  detectHomeLocation as detectHomeLocationReal,
  type HomeLocationResult,
} from "../lib/homeLocation";
import { DestinationPicker } from "../itinerary/DestinationPicker";
import { PlacePicker } from "../itinerary/PlacePicker";

/** PlacePicker's `knownPlaces` — there's no trip yet to draw from. */
const NO_PLACES: Place[] = [];

/**
 * The three `HomeLocationResult` kinds worth an explicit "try again"
 * — see that type's own doc comments, which are the actual contract
 * this reads. `denied`, `unavailable` and `no-match` are left out on
 * purpose: retrying with the same permission, the same browser, or
 * the same coordinates changes nothing.
 */
const RETRYABLE_KINDS: ReadonlySet<HomeLocationResult["kind"]> = new Set([
  "no-fix",
  "timeout",
  "error",
]);

type Detection = { kind: "idle" } | { kind: "detecting" } | HomeLocationResult;

interface WelcomeProps {
  open: boolean;
  onOrigin: (place: Place) => void;
  onDestination: (place: Place) => void;
  onDone: () => void;
  /** Injected so tests never touch real geolocation. Defaults to the real one. */
  detectLocation?: () => Promise<HomeLocationResult>;
}

export function Welcome({
  open,
  onOrigin,
  onDestination,
  onDone,
  detectLocation = detectHomeLocationReal,
}: WelcomeProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  // Set right before WE call dialog.close(), so the `close` handler
  // below can tell "the caller flipped `open` to false" apart from
  // "the user hit Escape" — only the second one is news to `onDone`.
  const suppressCloseRef = useRef(false);
  const headingId = useId();

  const [step, setStep] = useState<1 | 2>(1);
  const [origin, setOrigin] = useState<Place>();
  const [detection, setDetection] = useState<Detection>({ kind: "idle" });

  function chooseOrigin(place: Place) {
    setOrigin(place);
    onOrigin(place);
    setStep(2);
  }

  function chooseDestination(place: Place) {
    onDestination(place);
    // SEAM FOR STEP 3: the parent agent's transport-mode row belongs
    // here — shown only when the route engine had to route through a
    // gateway (see src/lib/routing.ts) — before the dialog ends. That
    // step doesn't exist yet, so choosing a destination is currently
    // the whole flow and ends it directly.
    onDone();
  }

  // Only ever reached from the button below — never from an effect.
  // Advancing on a hit is safe precisely because the user asked: this
  // is the answer to a question they pressed, not a guess made for
  // them while they were reading.
  function runDetection() {
    setDetection({ kind: "detecting" });
    detectLocation().then((result) => {
      setDetection(result);
      if (result.kind === "found") chooseOrigin(result.place);
    });
  }

  // Open or close the element itself, and reset to a fresh run each
  // time it opens. `showModal()` / `close()`, not the `open`
  // attribute — that renders a non-modal dialog with no backdrop and
  // no focus trap.
  //
  // DETECTION IS NOT STARTED HERE, DELIBERATELY. `detectHomeLocation`'s
  // own doc is explicit that callers must "gate it behind an explicit
  // 'use my location' action rather than surprising the user with a
  // prompt on page load" — and this dialog opens ON page load, so
  // running it here would be precisely that surprise. A permission
  // prompt nobody asked for is also the fastest way to get a
  // permanent "denied" out of a browser, which would break the
  // feature for good rather than for one session.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (open) {
      if (!dialog.open) dialog.showModal();
      setStep(1);
      setOrigin(undefined);
      setDetection({ kind: "idle" });
    } else if (dialog.open) {
      suppressCloseRef.current = true;
      dialog.close();
    }
  }, [open]);

  // The dialog's own `close` event fires on Escape independently of
  // this component's `open` prop. Without handling it, Escape leaves
  // the element closed while React still believes it's open.
  function handleDialogClose() {
    if (suppressCloseRef.current) {
      suppressCloseRef.current = false;
      return;
    }
    onDone();
  }

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={headingId}
      onClose={handleDialogClose}
      // `m-auto` is load-bearing, not decoration: the UA stylesheet
      // centres a modal dialog with `margin: auto`, and Tailwind's
      // preflight resets every element's margin to 0 — which silently
      // pins the dialog to the top-left corner, over the itinerary it
      // is supposed to be sitting in front of.
      className="m-auto w-full max-w-md rounded-xl border border-bark-200 bg-parchment p-4 text-bark-900 shadow-lg backdrop:bg-bark-900/50"
    >
      <p className="text-micro uppercase text-bark-600">Step {step} of 2</p>
      <h2 id={headingId} className="mt-0.5 text-title font-semibold text-bark-900">
        {step === 1 ? "Where are you starting from?" : "Where do you want to go?"}
      </h2>
      <p className="mt-1 text-caption text-bark-600">
        {step === 1
          ? "We'll use this as the trip's starting point."
          : "Pick a city, or browse the list below."}
      </p>

      {/*
        Announced separately from the visible copy above: the step
        changes, and detection resolves, well after a screen reader
        has finished reading whatever triggered them — nothing else
        here says that out loud. Same pattern as DestinationPicker's
        own result-count region.
      */}
      <p role="status" aria-live="polite" className="sr-only">
        {statusFor(step, detection)}
      </p>

      <div className="mt-3">
        {step === 1 ? (
          <div className="space-y-2">
            <PlacePicker
              label="Starting point"
              value={origin}
              knownPlaces={NO_PLACES}
              onChange={chooseOrigin}
            />

            {/*
              Typing is the primary path and this is the shortcut, so
              it reads as a quiet offer rather than the main action —
              which is also the honest shape of it: this button is the
              only thing in the app that can ask for your location, and
              it asks nothing until pressed.
            */}
            {detection.kind === "idle" && (
              <button
                type="button"
                onClick={runDetection}
                className="inline-flex items-center gap-1.5 rounded text-label font-medium text-moss-700 underline decoration-dotted underline-offset-2 transition hover:text-moss-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-moss-500"
              >
                <LocateFixed className="size-3.5 shrink-0" aria-hidden />
                Use my location
              </button>
            )}

            <DetectionNote detection={detection} onRetry={runDetection} />
          </div>
        ) : (
          <DestinationPicker
            onSelect={chooseDestination}
            knownPlaces={origin ? [origin] : NO_PLACES}
            label="Where to next?"
            autoFocus
          />
        )}
      </div>
    </dialog>
  );
}

function DetectionNote({
  detection,
  onRetry,
}: {
  detection: Detection;
  onRetry: () => void;
}) {
  if (detection.kind === "idle" || detection.kind === "found") return null;

  if (detection.kind === "detecting") {
    return (
      <p className="flex items-center gap-1.5 text-caption text-bark-600">
        <Loader2 className="size-3.5 shrink-0 animate-spin" aria-hidden />
        Looking for your city…
      </p>
    );
  }

  return (
    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-caption text-bark-600">
      <span>{messageFor(detection)}</span>
      {RETRYABLE_KINDS.has(detection.kind) && (
        <button
          type="button"
          onClick={onRetry}
          className="inline-flex items-center gap-1 rounded text-label font-medium text-moss-700 hover:text-moss-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-moss-500"
        >
          <RotateCcw className="size-3.5 shrink-0" aria-hidden />
          Try again
        </button>
      )}
    </p>
  );
}

/** The one line explaining why the field is still empty. */
function messageFor(detection: HomeLocationResult): string {
  switch (detection.kind) {
    case "denied":
      return "Location access was declined — search for your city instead.";
    case "unavailable":
      return "Can't detect your location here — search for your city instead.";
    case "no-match":
      return "That location doesn't match a city — search for yours instead.";
    case "no-fix":
      return "Couldn't get a location fix.";
    case "timeout":
      return "That took too long.";
    case "error":
      return detection.message;
    case "found":
      return "";
  }
}

function statusFor(step: 1 | 2, detection: Detection): string {
  if (detection.kind === "detecting") return "Looking for your starting point…";
  if (detection.kind !== "idle" && detection.kind !== "found") {
    return messageFor(detection);
  }
  return step === 1
    ? "Step 1 of 2: where are you starting from?"
    : "Step 2 of 2: where do you want to go?";
}
