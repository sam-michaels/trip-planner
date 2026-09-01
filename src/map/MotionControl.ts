// ============================================================
// Stopping the map.
//
// WCAG 2.2 SC 2.2.2 (Pause, Stop, Hide) applies to motion that starts
// on its own, runs for more than five seconds, and sits alongside
// other content. The vehicles on the routes are all three, and
// PRODUCT.md commits this project to AA — so honouring
// `prefers-reduced-motion` is necessary but not sufficient. The
// success criterion asks for a mechanism IN the content, reachable by
// someone who has never opened their OS accessibility settings.
//
// WHY AN IControl AND NOT A REACT BUTTON: it has to sit under the zoom
// and compass buttons, and MapLibre stacks its own controls. A React
// button positioned absolutely would be pinned to a guessed offset
// that breaks the first time NavigationControl changes height.
//
// It takes `maplibregl-ctrl` for that stacking but NOT
// `maplibregl-ctrl-group`, whose hard white background and drop shadow
// are exactly the two things DESIGN.md rules out — pure white is
// reserved for the casing under a route, and shadow marks selection or
// an overlay, never a resting control. The button is dressed in the
// app's own tokens instead.
// ============================================================

import type { IControl } from "maplibre-gl";

/**
 * Vendored from lucide-react v1.34.0 (ISC), `pause` and `play`, for the
 * same reason modeSprites.ts vendors its six: the package exports React
 * components, and this control builds a DOM node by hand. Refresh from
 * `__iconNode` in those modules after a lucide upgrade.
 */
const PAUSE_GLYPH =
  '<rect x="14" y="3" width="5" height="18" rx="1"/><rect x="5" y="3" width="5" height="18" rx="1"/>';
const PLAY_GLYPH =
  '<path d="M5 5a2 2 0 0 1 3.008-1.728l11.997 6.998a2 2 0 0 1 .003 3.458l-12 7A2 2 0 0 1 5 19z"/>';

function icon(glyph: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${glyph}</svg>`;
}

export class MotionControl implements IControl {
  private container?: HTMLDivElement;
  private button?: HTMLButtonElement;
  private paused: boolean;
  private readonly onToggle: (paused: boolean) => void;

  constructor(paused: boolean, onToggle: (paused: boolean) => void) {
    this.paused = paused;
    this.onToggle = onToggle;
  }

  onAdd(): HTMLElement {
    const container = document.createElement("div");
    container.className = "maplibregl-ctrl";

    const button = document.createElement("button");
    button.type = "button";
    button.className =
      "flex size-[29px] items-center justify-center rounded-md border border-bark-200 bg-parchment text-bark-700 shadow-none transition hover:bg-bark-50 hover:text-bark-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-moss-500";
    button.addEventListener("click", () => this.setPaused(!this.paused));

    container.appendChild(button);
    this.container = container;
    this.button = button;
    this.render();

    return container;
  }

  onRemove(): void {
    this.container?.remove();
    this.container = undefined;
    this.button = undefined;
  }

  /** Called from React when the state changed somewhere other than this button. */
  sync(paused: boolean): void {
    if (paused === this.paused) return;
    this.paused = paused;
    this.render();
  }

  private setPaused(paused: boolean): void {
    this.paused = paused;
    this.render();
    this.onToggle(paused);
  }

  private render(): void {
    const button = this.button;
    if (!button) return;

    // The label says what pressing it DOES, not what the map is
    // currently doing — "Pause map motion" while it is running. A
    // control labelled with its own state is the classic toggle trap.
    const label = this.paused ? "Resume map motion" : "Pause map motion";
    button.innerHTML = icon(this.paused ? PLAY_GLYPH : PAUSE_GLYPH);
    button.setAttribute("aria-label", label);
    button.setAttribute("title", label);
    // `aria-pressed` carries the state the label deliberately doesn't:
    // pressed means the motion is being held off.
    button.setAttribute("aria-pressed", String(this.paused));
  }
}
