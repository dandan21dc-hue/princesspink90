import { useEffect, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { getPublicMapboxToken } from "@/lib/mapbox-token";

const TOKEN_CHECK = getPublicMapboxToken();
const PUBLIC_TOKEN = TOKEN_CHECK.ok ? TOKEN_CHECK.token : undefined;

interface MapboxMapProps {
  /** Latitude of the map center. */
  latitude: number;
  /** Longitude of the map center. */
  longitude: number;
  /** Initial zoom level (default 12). */
  zoom?: number;
  /** When true, drops a marker at [longitude, latitude]. */
  showMarker?: boolean;
  /** Optional popup text shown when the marker is clicked. */
  markerLabel?: string;
  /** Extra classes for the container (control height/width here). */
  className?: string;
}

/**
 * Dark-mode Mapbox map centered on configurable lat/lng, with an optional
 * marker at the same coordinates. Uses the mapbox/dark-v11 style.
 */
export function MapboxMap({
  latitude,
  longitude,
  zoom = 12,
  showMarker = false,
  markerLabel,
  className = "h-[420px] w-full",
}: MapboxMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const markerRef = useRef<mapboxgl.Marker | null>(null);
  const [styleFallback, setStyleFallback] = useState<"none" | "dark" | "canvas">("none");

  // Init the map once.
  useEffect(() => {
    if (!containerRef.current || !PUBLIC_TOKEN) return;
    mapboxgl.accessToken = PUBLIC_TOKEN;

    const PRIMARY_STYLE = "mapbox://styles/mapbox/dark-v11";
    // Ordered fallbacks: another hosted dark style, then a tile-only dark canvas
    // that doesn't need a style JSON at all (works even if styles API is blocked).
    const FALLBACK_STYLE = "mapbox://styles/mapbox/navigation-night-v1";
    const CANVAS_STYLE: mapboxgl.StyleSpecification = {
      version: 8,
      name: "dark-canvas-fallback",
      sources: {
        "carto-dark": {
          type: "raster",
          tiles: [
            "https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png",
            "https://b.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png",
            "https://c.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png",
          ],
          tileSize: 256,
          attribution: "© OpenStreetMap contributors © CARTO",
        },
      },
      layers: [
        { id: "bg", type: "background", paint: { "background-color": "#0b0b12" } },
        { id: "carto-dark", type: "raster", source: "carto-dark" },
      ],
    };

    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: PRIMARY_STYLE,
      center: [longitude, latitude],
      zoom,
      attributionControl: true,
    });
    map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), "top-right");
    mapRef.current = map;

    // If the primary style fails to load (network error, blocked host, invalid
    // token scope), swap to a hosted dark style; if that also fails, drop to
    // the raster canvas fallback. Keeps the UI dark and consistent either way.
    let stage: "primary" | "dark" | "canvas" = "primary";
    const handleError = (e: { error?: Error }) => {
      const msg = e?.error?.message ?? "";
      const isStyleFailure = /style|tile|sprite|glyph|Failed to fetch|NetworkError/i.test(msg);
      if (!isStyleFailure) return;
      if (stage === "primary") {
        stage = "dark";
        setStyleFallback("dark");
        try { map.setStyle(FALLBACK_STYLE); } catch { /* handled by next error */ }
      } else if (stage === "dark") {
        stage = "canvas";
        setStyleFallback("canvas");
        try { map.setStyle(CANVAS_STYLE); } catch { /* give up silently */ }
      }
    };
    map.on("error", handleError);

    return () => {
      map.off("error", handleError);
      markerRef.current?.remove();
      markerRef.current = null;
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);


  // Re-center on prop changes.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    map.easeTo({ center: [longitude, latitude], zoom, duration: 600 });
  }, [latitude, longitude, zoom]);

  // Sync optional marker.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (!showMarker) {
      markerRef.current?.remove();
      markerRef.current = null;
      return;
    }

    if (!markerRef.current) {
      const marker = new mapboxgl.Marker({ color: "#ff2a90" }).setLngLat([longitude, latitude]);
      if (markerLabel) {
        marker.setPopup(new mapboxgl.Popup({ offset: 24 }).setText(markerLabel));
      }
      marker.addTo(map);
      markerRef.current = marker;
    } else {
      markerRef.current.setLngLat([longitude, latitude]);
      if (markerLabel) {
        markerRef.current.setPopup(new mapboxgl.Popup({ offset: 24 }).setText(markerLabel));
      }
    }
  }, [showMarker, latitude, longitude, markerLabel]);

  if (!PUBLIC_TOKEN) {
    return (
      <div className={`${className} grid place-items-center rounded-2xl border border-dashed border-border/60 bg-card/40 text-sm text-muted-foreground`}>
        Mapbox token not configured.
      </div>
    );
  }

  return (
    <div className="relative">
      <div ref={containerRef} className={`${className} overflow-hidden rounded-2xl border border-border/60`} />
      {styleFallback !== "none" && (
        <div className="pointer-events-none absolute left-3 top-3 rounded-md border border-border/60 bg-background/70 px-2 py-1 text-[10px] uppercase tracking-[0.25em] text-muted-foreground backdrop-blur">
          {styleFallback === "dark" ? "Fallback style" : "Offline tiles"}
        </div>
      )}
    </div>
  );
}
