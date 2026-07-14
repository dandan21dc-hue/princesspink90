import { useEffect, useRef } from "react";
import mapboxgl from "mapbox-gl";
import type { MapPin } from "@/lib/map-pins.functions";

const PUBLIC_TOKEN = import.meta.env.VITE_LOVABLE_CONNECTOR_MAPBOX_PUBLIC_TOKEN as string | undefined;

interface Props {
  pins: MapPin[];
  className?: string;
}

export function MapPinsMap({ pins, className }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);

  useEffect(() => {
    if (!containerRef.current || !PUBLIC_TOKEN) return;
    mapboxgl.accessToken = PUBLIC_TOKEN;

    const initialCenter: [number, number] = pins.length
      ? [pins[0].longitude, pins[0].latitude]
      : [151.2093, -33.8688]; // Sydney fallback

    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: "mapbox://styles/mapbox/dark-v11",
      center: initialCenter,
      zoom: pins.length > 1 ? 3 : 11,
      attributionControl: true,
    });
    map.addControl(new mapboxgl.NavigationControl({ visualizePitch: false }), "top-right");
    mapRef.current = map;

    map.on("load", () => {
      if (pins.length === 0) return;
      const bounds = new mapboxgl.LngLatBounds();
      for (const pin of pins) {
        const el = document.createElement("div");
        el.className =
          "h-4 w-4 rounded-full border-2 border-background shadow-[0_0_12px_hsl(var(--primary))] bg-primary cursor-pointer";
        new mapboxgl.Marker({ element: el })
          .setLngLat([pin.longitude, pin.latitude])
          .setPopup(
            new mapboxgl.Popup({ offset: 16, closeButton: false }).setHTML(
              `<div style="font-family:inherit"><div style="font-weight:600;color:#111">${escapeHtml(pin.title)}</div>${
                pin.description ? `<div style="margin-top:2px;color:#333;font-size:12px">${escapeHtml(pin.description)}</div>` : ""
              }</div>`,
            ),
          )
          .addTo(map);
        bounds.extend([pin.longitude, pin.latitude]);
      }
      if (pins.length > 1) {
        map.fitBounds(bounds, { padding: 60, maxZoom: 12, duration: 0 });
      }
    });

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, [pins]);

  if (!PUBLIC_TOKEN) {
    return (
      <div className={`flex items-center justify-center rounded-xl border border-border bg-card/40 p-8 text-sm text-muted-foreground ${className ?? ""}`}>
        Map unavailable — Mapbox public token is not configured.
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className={`rounded-xl overflow-hidden border border-border/60 shadow-[0_0_40px_-10px_hsl(var(--primary)/0.35)] ${className ?? ""}`}
      style={{ minHeight: 420 }}
    />
  );
}

function escapeHtml(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
