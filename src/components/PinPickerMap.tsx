import { useEffect, useRef } from "react";
import mapboxgl from "mapbox-gl";
import { getPublicMapboxToken } from "@/lib/mapbox-token";

const TOKEN_CHECK = getPublicMapboxToken();
const PUBLIC_TOKEN = TOKEN_CHECK.ok ? TOKEN_CHECK.token : undefined;

interface Props {
  latitude: number | null;
  longitude: number | null;
  onChange: (lat: number, lng: number) => void;
  className?: string;
}

/**
 * Small interactive map for picking a single pin location.
 * Click anywhere on the map, or drag the marker, to update coordinates.
 */
export function PinPickerMap({ latitude, longitude, onChange, className }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const markerRef = useRef<mapboxgl.Marker | null>(null);
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  // Init map once.
  useEffect(() => {
    if (!containerRef.current || !PUBLIC_TOKEN) return;
    mapboxgl.accessToken = PUBLIC_TOKEN;

    const hasCoord =
      latitude !== null && longitude !== null && Number.isFinite(latitude) && Number.isFinite(longitude);
    const center: [number, number] = hasCoord ? [longitude!, latitude!] : [151.2093, -33.8688];

    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: "mapbox://styles/mapbox/dark-v11",
      center,
      zoom: hasCoord ? 12 : 3,
      attributionControl: true,
    });
    map.addControl(new mapboxgl.NavigationControl({ visualizePitch: false }), "top-right");
    mapRef.current = map;

    map.on("click", (e) => {
      const { lat, lng } = e.lngLat;
      onChangeRef.current(lat, lng);
    });

    return () => {
      map.remove();
      mapRef.current = null;
      markerRef.current = null;
    };
    // Intentionally init-only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync marker with props.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const hasCoord =
      latitude !== null && longitude !== null && Number.isFinite(latitude) && Number.isFinite(longitude);

    if (!hasCoord) {
      markerRef.current?.remove();
      markerRef.current = null;
      return;
    }

    const lngLat: [number, number] = [longitude!, latitude!];
    if (!markerRef.current) {
      const el = document.createElement("div");
      el.className =
        "h-4 w-4 rounded-full border-2 border-background shadow-[0_0_12px_hsl(var(--primary))] bg-primary cursor-grab";
      const marker = new mapboxgl.Marker({ element: el, draggable: true })
        .setLngLat(lngLat)
        .addTo(map);
      marker.on("dragend", () => {
        const { lat, lng } = marker.getLngLat();
        onChangeRef.current(lat, lng);
      });
      markerRef.current = marker;
    } else {
      markerRef.current.setLngLat(lngLat);
    }
  }, [latitude, longitude]);

  if (!PUBLIC_TOKEN) {
    return (
      <div
        className={`flex items-center justify-center rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-xs text-destructive ${className ?? ""}`}
      >
        Map preview unavailable — {TOKEN_CHECK.ok ? "Mapbox token error." : TOKEN_CHECK.error}
      </div>
    );
  }

  const hasCoord =
    latitude !== null && longitude !== null && Number.isFinite(latitude) && Number.isFinite(longitude);

  return (
    <div className={className}>
      <div
        ref={containerRef}
        className="w-full min-h-[400px] rounded-lg overflow-hidden border border-border/60"
      />
      <div className="mt-1.5 flex items-center justify-between text-[11px] text-muted-foreground">
        <span>Click the map or drag the pin to set its location.</span>
        <span className="tabular-nums">
          {hasCoord ? `${latitude!.toFixed(5)}, ${longitude!.toFixed(5)}` : "No location set"}
        </span>
      </div>
    </div>
  );
}
