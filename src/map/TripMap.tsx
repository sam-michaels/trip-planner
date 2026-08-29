// ============================================================
// MapLibre container. Owns the map instance; geometry.ts and
// style.ts own turning a Trip into what the map actually draws.
// ============================================================

import {
  Map as MapLibreMap,
  GeoJSONSource,
  LngLatBounds,
  NavigationControl,
  type MapMouseEvent,
} from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useRef, useState } from "react";

import type { Destination, Leg } from "../model/trip";
import { destinationsToCollection, legsToCollection } from "./geometry";
import { addModeIcons } from "./modeSprites";
import {
  destinationLayers,
  legLayerIds,
  legLineLayers,
  selectedLegFilter,
} from "./style";

const LEGS_SOURCE_ID = "legs";
const LAYER_IDS = legLayerIds(LEGS_SOURCE_ID);

const DESTINATIONS_SOURCE_ID = "destinations";

// A stable reference for the "caller hasn't wired this prop up yet"
// default. A fresh `[]` literal in the destructured default would
// change identity on every render, and the destinations effect below
// keys off identity — that would re-push an (empty, unchanged) source
// to the map on every re-render instead of once.
const EMPTY_DESTINATIONS: Destination[] = [];

/**
 * WHY A STYLE URL AND NOT RAW TILES: MapLibre renders a full vector
 * style (sources, fonts, sprites), not a bare tile grid, so it needs
 * a style document, not a tile URL template. MapTiler's free tier
 * serves one at this endpoint once you have a key — see README's
 * "External API landscape" section for why MapTiler over Mapbox (no
 * token/usage ceiling) and over Protomaps (no self-hosting needed to
 * get a map on screen today).
 *
 * WHY `landscape` AND NOT `streets-v2`: the map is half the screen,
 * so whatever palette it brings IS the app's palette. streets-v2 is a
 * navigation basemap — saturated blue water, bright green parks,
 * motorways in orange — and it fought both the muted itinerary beside
 * it and the leg colours drawn on top of it, which were the one thing
 * that needed to stand out. `landscape` is MapTiler's natural-colour
 * terrain style: sage greens, sand, pale water, and no road hierarchy
 * shouting for attention. It also happens to be the right map for the
 * job — this is a planning tool for crossing countries, not for
 * finding a turning.
 */
function styleUrl(): string | undefined {
  const key = import.meta.env.VITE_MAPTILER_KEY;
  return key
    ? `https://api.maptiler.com/maps/landscape/style.json?key=${key}`
    : undefined;
}

/**
 * Initial camera box. Destinations are included alongside legs so a
 * trip with one destination and no routed legs yet — a normal early
 * state, not an error — still frames that destination instead of
 * falling through to the whole-world default view.
 */
function boundsForTrip(
  legs: Leg[],
  destinations: Destination[],
): LngLatBounds | undefined {
  const allCoords = [
    ...legs.flatMap((leg) => [leg.from.coords, leg.to.coords]),
    ...destinations.map((d) => d.place.coords),
  ];
  if (allCoords.length === 0) return undefined;

  const bounds = new LngLatBounds(allCoords[0], allCoords[0]);
  for (const c of allCoords) bounds.extend(c);
  return bounds;
}

/** The box a single leg occupies — its two endpoints. Flight arcs bulge
 * slightly outside this, which the fitBounds padding absorbs. */
function legBounds(leg: Leg): LngLatBounds {
  return new LngLatBounds(leg.from.coords, leg.from.coords).extend(
    leg.to.coords,
  );
}

interface TripMapProps {
  /**
   * The trip's derived legs. TODO(wave-2): the shell computes these
   * with `deriveLegs()` and hands them down, since the route engine
   * that supplies the `RouteMap` doesn't exist yet. The map itself
   * needs nothing else off the trip to draw the *routes* — it draws
   * legs and only legs.
   *
   * An empty array is a normal state (a trip with one destination and
   * no routes yet), not an error — it renders as a bare basemap plus
   * whatever `destinations` below draws.
   */
  legs: Leg[];
  /**
   * The trip's destinations, so the map can mark them as a distinct
   * kind of thing from an ordinary leg endpoint (an airport, a
   * transfer station) — see the banner in style.ts. Optional and
   * defaulted to `[]` so a caller that hasn't wired this prop through
   * yet still renders exactly as before, just without destination
   * markers.
   */
  destinations?: Destination[];
  selectedLegId?: string;
  /** Called with a leg id when a line is clicked, `undefined` for empty map. */
  onSelectLeg?: (legId: string | undefined) => void;
}

export function TripMap({
  legs,
  destinations = EMPTY_DESTINATIONS,
  selectedLegId,
  onSelectLeg,
}: TripMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const url = styleUrl();

  // The selection and interaction effects below can't touch layers
  // that don't exist yet, and layers are only added once the style has
  // loaded. This flag is what lets them wait for that moment instead
  // of guessing at it with a timeout.
  const [layersReady, setLayersReady] = useState(false);

  // Held in a ref so the click handler is registered once, at layer
  // setup, rather than being torn down and re-added every time the
  // parent re-renders with a new callback identity.
  const selectRef = useRef(onSelectLeg);
  useEffect(() => {
    selectRef.current = onSelectLeg;
  }, [onSelectLeg]);

  // Map is created once and kept for the component's lifetime — see
  // the effect below for how leg edits reach an already-live map.
  // Recreating the map on every trip change would replay the load
  // animation and flash the tiles on every keystroke of an editor.
  useEffect(() => {
    if (!containerRef.current || !url) return;

    const map = new MapLibreMap({
      container: containerRef.current,
      style: url,
      bounds: boundsForTrip(legs, destinations),
      fitBoundsOptions: { padding: 48 },
    });
    map.addControl(new NavigationControl(), "top-right");
    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
      setLayersReady(false);
    };
    // Intentionally only depends on `url`: initial camera uses whatever
    // `legs`/`destinations` are at mount time, and later changes are
    // pushed via the effects below rather than by rebuilding the map.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);

  // Push leg changes (including the first one, after the style
  // finishes loading) into the map created above.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const collection = legsToCollection(legs);
    let cancelled = false;

    const applyLegs = async () => {
      const source = map.getSource(LEGS_SOURCE_ID) as GeoJSONSource | undefined;
      if (source) {
        source.setData(collection);
        return;
      }

      // Sprites must exist before the symbol layer that names them,
      // or MapLibre logs a missing-image warning per feature per frame.
      await addModeIcons(map);
      // The component can unmount, or the style reload, while those
      // images are rasterizing.
      if (cancelled || mapRef.current !== map) return;

      map.addSource(LEGS_SOURCE_ID, { type: "geojson", data: collection });
      for (const layer of legLineLayers(LEGS_SOURCE_ID)) {
        map.addLayer(layer);
      }
      setLayersReady(true);
    };

    if (map.isStyleLoaded()) void applyLegs();
    else map.once("load", applyLegs);

    return () => {
      cancelled = true;
    };
  }, [legs]);

  // Push destination changes into the map. Gated on `layersReady`
  // (flipped by the leg effect above, once ITS layers are actually in
  // the style) rather than on its own independent `load` listener.
  //
  // WHY NOT A SECOND `load` LISTENER, which is what this used to be:
  // `applyLegs` above is async — it awaits sprite rasterization before
  // calling `addLayer` — so it suspends mid-callback on first load and
  // yields control back to the event dispatcher. A same-tick `load`
  // listener registered here would then run to completion and add the
  // destination layers BEFORE the (still-suspended) leg layers exist.
  // `map.addLayer` with no `beforeId` appends at the top of the stack,
  // so that race put destination markers UNDER the routes on ordinary
  // first load — the opposite of the intent below. Waiting for
  // `layersReady` instead guarantees the leg layers are already in
  // place, so these are always added after and paint on top.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !layersReady) return;

    const collection = destinationsToCollection(destinations);
    const source = map.getSource(DESTINATIONS_SOURCE_ID) as
      | GeoJSONSource
      | undefined;
    if (source) {
      source.setData(collection);
      return;
    }

    map.addSource(DESTINATIONS_SOURCE_ID, {
      type: "geojson",
      data: collection,
    });
    for (const layer of destinationLayers(DESTINATIONS_SOURCE_ID)) {
      map.addLayer(layer);
    }
  }, [destinations, layersReady]);

  // Selection -> the highlight layer's filter. Repainting a filter is
  // far cheaper than rebuilding the source, and it keeps "which leg is
  // selected" out of the GeoJSON entirely — the features describe the
  // trip, not the UI's current state.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !layersReady) return;

    map.setFilter(LAYER_IDS.highlight, selectedLegFilter(selectedLegId));
  }, [selectedLegId, layersReady]);

  // Bring an off-screen selection into view, and only then. Selecting a
  // leg you can already see and having the camera lurch anyway is
  // disorienting — especially when the selection came from clicking
  // that very line.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !layersReady || !selectedLegId) return;

    const leg = legs.find((candidate) => candidate.id === selectedLegId);
    if (!leg) return;

    const bounds = legBounds(leg);
    const view = map.getBounds();
    const visible =
      view.contains(bounds.getNorthEast()) &&
      view.contains(bounds.getSouthWest());

    if (!visible) {
      // maxZoom stops a short leg (a metro hop between two Lisbon
      // stations) from slamming the camera down to street level.
      map.fitBounds(bounds, { padding: 80, maxZoom: 8, duration: 600 });
    }
    // `legs` is deliberately absent: this should fire when the
    // selection changes, not every time any leg is edited.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedLegId, layersReady]);

  // Click and hover behaviour. Registered once per layer lifetime.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !layersReady) return;

    const clickable = [LAYER_IDS.hit, LAYER_IDS.dashed, LAYER_IDS.solid];

    // One map-wide handler rather than per-layer ones, so that clicking
    // empty ocean clears the selection through the same path that
    // clicking a line sets it.
    const handleClick = (event: MapMouseEvent) => {
      const [hit] = map.queryRenderedFeatures(event.point, {
        layers: clickable,
      });
      selectRef.current?.(hit?.properties?.legId as string | undefined);
    };

    const showPointer = () => {
      map.getCanvas().style.cursor = "pointer";
    };
    const clearPointer = () => {
      map.getCanvas().style.cursor = "";
    };

    map.on("click", handleClick);
    map.on("mouseenter", LAYER_IDS.hit, showPointer);
    map.on("mouseleave", LAYER_IDS.hit, clearPointer);

    return () => {
      map.off("click", handleClick);
      map.off("mouseenter", LAYER_IDS.hit, showPointer);
      map.off("mouseleave", LAYER_IDS.hit, clearPointer);
    };
  }, [layersReady]);

  if (!url) {
    return (
      <div className="flex h-full items-center justify-center bg-bark-50 p-8 text-center text-bark-600">
        <p className="max-w-sm">
          Set{" "}
          <code className="rounded bg-bark-200 px-1 py-0.5 text-sm">
            VITE_MAPTILER_KEY
          </code>{" "}
          in{" "}
          <code className="rounded bg-bark-200 px-1 py-0.5 text-sm">
            .env.local
          </code>{" "}
          to render the map. A free key is available at{" "}
          <a
            className="underline"
            href="https://cloud.maptiler.com/account/keys/"
            target="_blank"
            rel="noreferrer"
          >
            cloud.maptiler.com
          </a>
          .
        </p>
      </div>
    );
  }

  return <div ref={containerRef} className="h-full w-full" />;
}
