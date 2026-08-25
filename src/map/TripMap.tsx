// ============================================================
// MapLibre container. Owns the map instance; geometry.ts and
// style.ts own turning a Trip into what the map actually draws.
// ============================================================

import {
  Map as MapLibreMap,
  GeoJSONSource,
  LngLatBounds,
  NavigationControl,
} from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useRef } from "react";

import type { Trip } from "../model/trip";
import { tripToLegCollection } from "./geometry";
import { legLineLayers } from "./style";

const LEGS_SOURCE_ID = "legs";

/**
 * WHY A STYLE URL AND NOT RAW TILES: MapLibre renders a full vector
 * style (sources, fonts, sprites), not a bare tile grid, so it needs
 * a style document, not a tile URL template. MapTiler's free tier
 * serves one at this endpoint once you have a key — see README's
 * "External API landscape" section for why MapTiler over Mapbox (no
 * token/usage ceiling) and over Protomaps (no self-hosting needed to
 * get a map on screen today).
 */
function styleUrl(): string | undefined {
  const key = import.meta.env.VITE_MAPTILER_KEY;
  return key
    ? `https://api.maptiler.com/maps/streets-v2/style.json?key=${key}`
    : undefined;
}

function boundsForTrip(trip: Trip): LngLatBounds | undefined {
  const allCoords = trip.legs.flatMap((leg) => [leg.from.coords, leg.to.coords]);
  if (allCoords.length === 0) return undefined;

  const bounds = new LngLatBounds(allCoords[0], allCoords[0]);
  for (const c of allCoords) bounds.extend(c);
  return bounds;
}

export function TripMap({ trip }: { trip: Trip }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const url = styleUrl();

  // Map is created once and kept for the component's lifetime — see
  // the effect below for how trip edits reach an already-live map.
  // Recreating the map on every trip change would replay the load
  // animation and flash the tiles on every keystroke of an editor.
  useEffect(() => {
    if (!containerRef.current || !url) return;

    const map = new MapLibreMap({
      container: containerRef.current,
      style: url,
      bounds: boundsForTrip(trip),
      fitBoundsOptions: { padding: 48 },
    });
    map.addControl(new NavigationControl(), "top-right");
    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
    };
    // Intentionally only depends on `url`: initial camera uses whatever
    // `trip` is at mount time, and later trip changes are pushed via
    // the effect below rather than by rebuilding the map.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);

  // Push trip changes (including the first one, after the style
  // finishes loading) into the map created above.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const legs = tripToLegCollection(trip);

    const applyLegs = () => {
      const source = map.getSource(LEGS_SOURCE_ID) as GeoJSONSource | undefined;
      if (source) {
        source.setData(legs);
        return;
      }
      map.addSource(LEGS_SOURCE_ID, { type: "geojson", data: legs });
      for (const layer of legLineLayers(LEGS_SOURCE_ID)) {
        map.addLayer(layer);
      }
    };

    if (map.isStyleLoaded()) applyLegs();
    else map.once("load", applyLegs);
  }, [trip]);

  if (!url) {
    return (
      <div className="flex h-full items-center justify-center bg-gray-50 p-8 text-center text-gray-600">
        <p className="max-w-sm">
          Set{" "}
          <code className="rounded bg-gray-200 px-1 py-0.5 text-sm">
            VITE_MAPTILER_KEY
          </code>{" "}
          in{" "}
          <code className="rounded bg-gray-200 px-1 py-0.5 text-sm">
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
