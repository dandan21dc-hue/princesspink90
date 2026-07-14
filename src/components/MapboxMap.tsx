import { useEffect, useRef } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";

const PUBLIC_TOKEN = import.meta.env.VITE_LOVABLE_CONNECTOR_MAPBOX_PUBLIC_TOKEN as string | undefined;

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

  // Init the map once.
  useEffect(() => {
    if (!containerRef.current || !PUBLIC_TOKEN) return;
    mapboxgl.accessToken = PUBLIC_TOKEN;

    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: "mapbox://styles/mapbox/dark-v11",
      center: [longitude, latitude],
      zoom,
      attributionControl: true,
    });
    map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), "top-right");
    mapRef.current = map;

    return () => {
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

  return <div ref={containerRef} className={`${className} overflow-hidden rounded-2xl border border-border/60`} />;
}
