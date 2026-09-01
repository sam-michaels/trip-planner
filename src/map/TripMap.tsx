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
import { useEffect, useMemo, useRef, useState } from "react";

import type { Leg } from "../model/trip";
import { usePrefersReducedMotion } from "../lib/useReducedMotion";
import { legsToCollection } from "./geometry";
import { MotionControl } from "./MotionControl";
import { addModeIcons } from "./modeSprites";
import { legPath } from "./path";
import {
  legLayerIds,
  legLineLayers,
  selectedLegFilter,
  vehicleLayers,
} from "./style";
import type { LegWithPath } from "./vehicles";
import { vehicleCollection } from "./vehicles";

const LEGS_SOURCE_ID = "legs";
const LAYER_IDS = legLayerIds(LEGS_SOURCE_ID);

/** The vehicles get their own source: it is rewritten every frame, and
 * dragging the route geometry through the worker with it would mean
 * re-parsing the whole trip sixty times a second to move six dots. */
const VEHICLES_SOURCE_ID = "vehicles";

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

function boundsForLegs(legs: Leg[]): LngLatBounds | undefined {
  const allCoords = legs.flatMap((leg) => [leg.from.coords, leg.to.coords]);
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
   * needs nothing else off the trip — it draws legs and only legs.
   */
  legs: Leg[];
  selectedLegId?: string;
  /** Called with a leg id when a line is clicked, `undefined` for empty map. */
  onSelectLeg?: (legId: string | undefined) => void;
}

export function TripMap({ legs, selectedLegId, onSelectLeg }: TripMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const url = styleUrl();

  // The selection and interaction effects below can't touch layers
  // that don't exist yet, and layers are only added once the style has
  // loaded. This flag is what lets them wait for that moment instead
  // of guessing at it with a timeout.
  const [layersReady, setLayersReady] = useState(false);

  // Someone who has asked their OS for less movement gets a still map
  // on arrival. It SEEDS the button rather than overriding it — see
  // MotionControl.ts for why that distinction matters.
  const prefersReducedMotion = usePrefersReducedMotion();
  const [paused, setPaused] = useState(prefersReducedMotion);
  useEffect(() => {
    setPaused(prefersReducedMotion);
  }, [prefersReducedMotion]);

  // The route features, computed once and shared: the source needs
  // them and so does the vehicle sampler, and recomputing the great
  // circles for the second reader would double the only genuinely
  // expensive part of drawing a trip.
  const legCollection = useMemo(() => legsToCollection(legs), [legs]);
  const legPaths = useMemo<LegWithPath[]>(
    () =>
      legs.map((leg, index) => ({
        leg,
        path: legPath(legCollection.features[index]),
      })),
    [legs, legCollection],
  );

  // Held in a ref so the click handler is registered once, at layer
  // setup, rather than being torn down and re-added every time the
  // parent re-renders with a new callback identity.
  const selectRef = useRef(onSelectLeg);
  useEffect(() => {
    selectRef.current = onSelectLeg;
  }, [onSelectLeg]);

  // The pause button is a plain DOM control, so React can't re-render
  // it. It's pushed the new state instead, which also covers the case
  // where the state changed from the media query rather than a click.
  const motionRef = useRef<MotionControl | null>(null);
  const pausedRef = useRef(paused);
  useEffect(() => {
    pausedRef.current = paused;
    motionRef.current?.sync(paused);
  }, [paused]);

  // Map is created once and kept for the component's lifetime — see
  // the effect below for how leg edits reach an already-live map.
  // Recreating the map on every trip change would replay the load
  // animation and flash the tiles on every keystroke of an editor.
  useEffect(() => {
    if (!containerRef.current || !url) return;

    const map = new MapLibreMap({
      container: containerRef.current,
      style: url,
      bounds: boundsForLegs(legs),
      fitBoundsOptions: { padding: 48 },
    });
    map.addControl(new NavigationControl(), "top-right");

    // Read through a ref, not the `paused` binding: this effect runs
    // once per map and would otherwise capture whatever the state was
    // at mount forever.
    const motion = new MotionControl(pausedRef.current, setPaused);
    map.addControl(motion, "top-right");
    motionRef.current = motion;

    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
      motionRef.current = null;
      setLayersReady(false);
    };
    // Intentionally only depends on `url`: initial camera uses whatever
    // `legs` are at mount time, and later changes are pushed via the
    // effect below rather than by rebuilding the map.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);

  // Push leg changes (including the first one, after the style
  // finishes loading) into the map created above.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    let cancelled = false;

    const applyLegs = async () => {
      const source = map.getSource(LEGS_SOURCE_ID) as GeoJSONSource | undefined;
      if (source) {
        source.setData(legCollection);
        return;
      }

      // Sprites must exist before the symbol layer that names them,
      // or MapLibre logs a missing-image warning per feature per frame.
      await addModeIcons(map);
      // The component can unmount, or the style reload, while those
      // images are rasterizing.
      if (cancelled || mapRef.current !== map) return;

      map.addSource(LEGS_SOURCE_ID, { type: "geojson", data: legCollection });
      for (const layer of legLineLayers(LEGS_SOURCE_ID)) {
        map.addLayer(layer);
      }

      // Added after the line layers, and therefore drawn above them:
      // a vehicle behind its own route would be a very quiet bug.
      map.addSource(VEHICLES_SOURCE_ID, {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
      for (const layer of vehicleLayers(VEHICLES_SOURCE_ID)) {
        map.addLayer(layer);
      }

      setLayersReady(true);
    };

    if (map.isStyleLoaded()) void applyLegs();
    else map.once("load", applyLegs);

    return () => {
      cancelled = true;
    };
  }, [legCollection]);

  // The vehicles. One frame's work is: sample every path at the
  // current time, and hand MapLibre a new point per leg.
  //
  // The epoch is set once and never reset, so selecting a leg or
  // editing an unrelated one doesn't make every vehicle on the map
  // jump to a new position mid-flight.
  const epochRef = useRef(0);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !layersReady) return;

    const source = map.getSource(VEHICLES_SOURCE_ID) as
      | GeoJSONSource
      | undefined;
    if (!source) return;

    if (epochRef.current === 0) epochRef.current = performance.now();

    if (paused) {
      // Parked at the midpoint of each line, at full presence. A
      // resting map still shows one icon per route rather than none.
      source.setData(vehicleCollection(legPaths, 0, selectedLegId, true));
      return;
    }

    let frame = 0;
    const tick = (now: number) => {
      source.setData(
        vehicleCollection(legPaths, now - epochRef.current, selectedLegId, false),
      );
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);

    // No visibilitychange handling: requestAnimationFrame is already
    // suspended in a background tab, so a hidden map costs nothing.
    return () => cancelAnimationFrame(frame);
  }, [legPaths, selectedLegId, layersReady, paused]);

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
      <div className="flex h-full items-center justify-center bg-bark-50 p-8 text-center">
        {/*
          The third and last home of the display face. This is the
          first thing a new contributor sees, and it was a wall of
          undifferentiated prose with no entry point — so it now leads
          with the problem named, and the two literals you have to
          type exactly are set in mono, which is what mono is for.
        */}
        <div className="max-w-[46ch]">
          <p className="font-display text-display text-bark-900">
            The map needs a key
          </p>
          <p className="mt-2 text-body text-bark-700">
            Set{" "}
            <code className="rounded bg-bark-200 px-1 py-0.5 font-mono text-caption text-bark-900">
              VITE_MAPTILER_KEY
            </code>{" "}
            in{" "}
            <code className="rounded bg-bark-200 px-1 py-0.5 font-mono text-caption text-bark-900">
              .env.local
            </code>{" "}
            to render the map. A free key is available at{" "}
            <a
              className="underline decoration-bark-400 hover:decoration-bark-700"
              href="https://cloud.maptiler.com/account/keys/"
              target="_blank"
              rel="noreferrer"
            >
              cloud.maptiler.com
            </a>
            .
          </p>
        </div>
      </div>
    );
  }

  return <div ref={containerRef} className="h-full w-full" />;
}
