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

import type { HopId, Place, TransportMode } from "../model/trip";
import type { RouteOption } from "../lib/routing";
import { AccessRow } from "./AccessRow";
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
  /**
   * The engine's proposals for the leg out of `origin`, once it has
   * them. Step 3 only exists when these describe a gateway, and they
   * arrive a moment after step 2 is answered — so the step appears
   * when the answer does, rather than making the traveller wait on a
   * question that may not need asking.
   */
  firstLegOptions?: readonly RouteOption[];
  chosenRouteId?: string;
  accessMode?: TransportMode;
  onPickAccessMode?: (hop: HopId, mode: TransportMode) => void;
  onPickRoute?: (optionId: string) => void;
  /** Injected so tests never touch real geolocation. Defaults to the real one. */
  detectLocation?: () => Promise<HomeLocationResult>;
}

export function Welcome({
  open,
  onOrigin,
  onDestination,
  onDone,
  firstLegOptions,
  chosenRouteId,
  accessMode,
  onPickAccessMode,
  onPickRoute,
  detectLocation = detectHomeLocationReal,
}: WelcomeProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  // Set right before WE call dialog.close(), so the `close` handler
  // below can tell "the caller flipped `open` to false" apart from
  // "the user hit Escape" — only the second one is news to `onDone`.
  const suppressCloseRef = useRef(false);
  const headingId = useId();

  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [origin, setOrigin] = useState<Place>();
  const [detection, setDetection] = useState<Detection>({ kind: "idle" });

  // Step 3 has something to ask exactly when the trip starts with a
  // ground hop to an airport in another city — see `accessPair` in
  // AccessRow for why that shape, and not "is it a gateway route", is
  // the right test. When the airport is in your own city there is no
  // journey to choose a mode for.
  const showsAccess = (firstLegOptions ?? []).some((option) => {
    const first = option.hops[0];
    return (
      first &&
      first.mode !== "flight" &&
      Boolean(first.to.iata) &&
      first.to.city !== first.from.city
    );
  });

  function chooseOrigin(place: Place) {
    setOrigin(place);
    onOrigin(place);
    setStep(2);
  }

  function chooseDestination(place: Place) {
    onDestination(place);
    // Step 3 asks how you reach the gateway — a question that only
    // exists if there IS a gateway, which the engine hasn't answered
    // yet at this instant. So move there and let the step decide
    // whether it has anything to say (see `showsAccess` below); if it
    // turns out there's direct service, it renders the finish button
    // and nothing else rather than a question with no answers.
    setStep(3);
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
      {/*
        Always three, because there are always three screens: the
        third is the one you leave from, and it carries the airport
        question only when there is one to ask. Making the total
        conditional produced "Step 3 of 2" on the direct-service path,
        which is the counter calling itself a liar.
      */}
      <p className="text-micro uppercase text-bark-600">Step {step} of 3</p>
      <h2 id={headingId} className="mt-0.5 text-title font-semibold text-bark-900">
        {HEADINGS[step]}
      </h2>
      <p className="mt-1 text-caption text-bark-600">{BLURBS[step]}</p>

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
        ) : step === 3 ? (
          <div className="space-y-3">
            {showsAccess && origin && (
              <AccessRow
                from={origin}
                options={firstLegOptions ?? []}
                chosenId={chosenRouteId}
                currentMode={accessMode}
                onPickMode={onPickAccessMode ?? (() => {})}
                onPickRoute={onPickRoute ?? (() => {})}
              />
            )}

            {/*
              Always the way out, whether or not there was a third
              question — a dialog you cannot dismiss is a trap, and
              this is the only affordance that closes it deliberately
              rather than by Escape.
            */}
            <button
              type="button"
              onClick={onDone}
              autoFocus
              className="w-full rounded-lg bg-moss-600 px-3 py-2 text-body font-semibold text-parchment transition hover:bg-moss-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-moss-500"
            >
              Start planning
            </button>
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

const HEADINGS: Record<1 | 2 | 3, string> = {
  1: "Where are you starting from?",
  2: "Where do you want to go?",
  3: "Ready when you are",
};

const BLURBS: Record<1 | 2 | 3, string> = {
  1: "We'll use this as the trip's starting point.",
  2: "Pick a city, or browse the list below.",
  3: "You can change any of this later.",
};

function statusFor(step: 1 | 2 | 3, detection: Detection): string {
  if (detection.kind === "detecting") return "Looking for your starting point…";
  if (detection.kind !== "idle" && detection.kind !== "found") {
    return messageFor(detection);
  }
  return `Step ${step}: ${HEADINGS[step]}`;
}
