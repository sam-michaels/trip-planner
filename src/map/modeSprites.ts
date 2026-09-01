// ============================================================
// Turning the mode icons into map sprites.
//
// The list and the map have to show the *same* plane. If the map's
// plane were hand-drawn it would be a different plane, and the whole
// point — glance at a line, know what it is, find it in the list —
// depends on them being identical.
//
// WHY THE GEOMETRY IS COPIED IN RATHER THAN IMPORTED: lucide-react
// exports icons as React components and does not publicly export the
// underlying path data. Two ways to get at it, both rejected:
//
//   * `react-dom/server` + `renderToStaticMarkup` on the real
//     component. Correct and stable, but pulls the whole server
//     renderer into the browser bundle — measured at +61KB gzipped,
//     which is a preposterous price for six icons.
//   * importing `__iconNode` from `lucide-react/dist/esm/icons/*.mjs`.
//     Free, but that path is package internals with no `exports`
//     entry, so a version bump can move it with no type error to warn
//     us.
//
// So the paths below are vendored: copied verbatim from lucide-react
// v1.34.0 (ISC licensed), which is the same version rendering them in
// the editor. TO REFRESH after a lucide upgrade, read `__iconNode`
// from the icon modules named in the table below and re-copy. If they
// ever drift, the map and the list will visibly disagree, which is a
// loud enough failure not to need a test.
// ============================================================

import type { Map as MapLibreMap } from "maplibre-gl";

import type { TransportMode } from "../model/trip";
import { MODES, MODE_COLORS } from "../itinerary/labels";

// Which lucide icon each mode's geometry came from — keep in step with
// `MODE_ICONS` in `itinerary/labels.ts`, which is what the UI renders:
//
//   flight: plane      train: train-front   bus:  bus
//   car:    car        ferry: ship          walk: footprints
//
// This was a `Record<TransportMode, string>` re-exported under a second
// name purely so nothing would look unused and delete it. A comment is
// what it always was; a constant nothing reads is not more durable than
// one, just harder to see through.

/** Inner SVG elements, on lucide's standard 24x24 viewBox. */
const MODE_GLYPHS: Record<TransportMode, string> = {
  flight:
    '<path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z"/>',
  train:
    '<path d="M8 3.1V7a4 4 0 0 0 8 0V3.1"/><path d="m9 15-1-1"/><path d="m15 15 1-1"/><path d="M9 19c-2.8 0-5-2.2-5-5v-4a8 8 0 0 1 16 0v4c0 2.8-2.2 5-5 5Z"/><path d="m8 19-2 3"/><path d="m16 19 2 3"/>',
  bus: '<path d="M8 6v6"/><path d="M15 6v6"/><path d="M2 12h19.6"/><path d="M18 18h3s.5-1.7.8-2.8c.1-.4.2-.8.2-1.2 0-.4-.1-.8-.2-1.2l-1.4-5C20.1 6.8 19.1 6 18 6H4a2 2 0 0 0-2 2v10h3"/><circle cx="7" cy="18" r="2"/><path d="M9 18h5"/><circle cx="16" cy="18" r="2"/>',
  car: '<path d="M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1.1.4-1.4.9l-1.4 2.9A3.7 3.7 0 0 0 2 12v4c0 .6.4 1 1 1h2"/><circle cx="7" cy="17" r="2"/><path d="M9 17h6"/><circle cx="17" cy="17" r="2"/>',
  ferry:
    '<path d="M12 10.189V14"/><path d="M12 2v3"/><path d="M19 13V7a2 2 0 0 0-2-2H7a2 2 0 0 0-2 2v6"/><path d="M19.38 20A11.6 11.6 0 0 0 21 14l-8.188-3.639a2 2 0 0 0-1.624 0L3 14a11.6 11.6 0 0 0 2.81 7.76"/><path d="M2 21c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1s1.2 1 2.5 1c2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1"/>',
  walk: '<path d="M4 16v-2.38C4 11.5 2.97 10.5 3 8c.03-2.72 1.49-6 4.5-6C9.37 2 10 3.8 10 5.5c0 3.11-2 5.66-2 8.68V16a2 2 0 1 1-4 0Z"/><path d="M20 20v-2.38c0-2.12 1.03-3.12 1-5.62-.03-2.72-1.49-6-4.5-6C14.63 6 14 7.8 14 9.5c0 3.11 2 5.66 2 8.68V20a2 2 0 1 0 4 0Z"/><path d="M16 17h4"/><path d="M4 13h4"/>',
};

/** Sprite box in CSS pixels. */
const SIZE = 22;
/** Rendered at 2x so the glyph stays crisp on retina displays. */
const PIXEL_RATIO = 2;

export const modeImageId = (mode: TransportMode) => `mode-${mode}`;

/**
 * The `icon-image` expression: read each feature's `mode` and look up
 * the matching sprite. Keeps the layer free of any per-mode branching
 * — one layer draws every marker on the map.
 */
export const MODE_ICON_EXPRESSION = ["concat", "mode-", ["get", "mode"]];

function spriteSvg(mode: TransportMode, color: string): string {
  // A filled disc behind the glyph, slightly translucent so the
  // basemap still reads through it — the marker should sit *on* the
  // map rather than punching a hole in it.
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">
  <circle cx="11" cy="11" r="10" fill="${color}" fill-opacity="0.92"/>
  <circle cx="11" cy="11" r="10" fill="none" stroke="#ffffff" stroke-opacity="0.85" stroke-width="1.5"/>
  <g transform="translate(4.5 4.5) scale(0.5417)" fill="none" stroke="#ffffff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">${MODE_GLYPHS[mode]}</g>
</svg>`;
}

function rasterize(svg: string): Promise<HTMLImageElement> {
  // A data URL rather than a blob URL: no object URL to revoke, and
  // these are small enough that the encoding cost is irrelevant.
  const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

  return new Promise((resolve, reject) => {
    // Setting the intrinsic size tells the browser what resolution to
    // rasterize the SVG at; combined with `pixelRatio` below, MapLibre
    // then draws it at SIZE css pixels.
    const image = new Image(SIZE * PIXEL_RATIO, SIZE * PIXEL_RATIO);
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Could not rasterize mode sprite"));
    image.src = url;
  });
}

export async function addModeIcons(map: MapLibreMap): Promise<void> {
  await Promise.all(
    MODES.map(async (mode) => {
      const id = modeImageId(mode);
      if (map.hasImage(id)) return;

      // Disc painted in the mode's own colour, so a marker always
      // matches the line it punctuates.
      const image = await rasterize(spriteSvg(mode, MODE_COLORS[mode]));
      // Between the await and here the style may have been swapped or
      // the image added by a concurrent call; adding twice throws.
      if (map.hasImage(id)) return;

      map.addImage(id, image, { pixelRatio: PIXEL_RATIO });
    }),
  );
}
