// ============================================================
// Does this person want less movement?
//
// The map animates a vehicle along every route, on a loop. That is
// exactly the kind of motion `prefers-reduced-motion` exists for —
// it's set by people who get motion sickness or vestibular symptoms
// from it, not by people expressing a taste — so it seeds the map's
// initial state rather than merely being a nice default.
//
// It SEEDS rather than dictates: the map also carries a pause button,
// and someone with the setting on is still allowed to press play and
// watch one plane fly. See MotionControl.ts.
// ============================================================

import { useSyncExternalStore } from "react";

const QUERY = "(prefers-reduced-motion: reduce)";

function subscribe(onChange: () => void): () => void {
  // Guarded because jsdom in the test environment has no matchMedia.
  const media = globalThis.matchMedia?.(QUERY);
  if (!media) return () => {};

  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

function getSnapshot(): boolean {
  return globalThis.matchMedia?.(QUERY).matches ?? false;
}

export function usePrefersReducedMotion(): boolean {
  // The third argument is the server snapshot: without a browser there
  // is no stated preference, and guessing "reduce" would ship a
  // permanently still map to everyone on first paint.
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}
