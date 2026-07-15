import { createFileRoute } from "@tanstack/react-router";
import type {} from "@tanstack/react-start";
import { listPublicEvents } from "@/lib/events.functions";
import { listStoreItems } from "@/lib/store.functions";

const BASE_URL = "https://princesspink90.com";

interface SitemapEntry {
  path: string;
  lastmod?: string;
  changefreq?: "always" | "hourly" | "daily" | "weekly" | "monthly" | "yearly" | "never";
  priority?: string;
}

export const Route = createFileRoute("/sitemap.xml")({
  server: {
    handlers: {
      GET: async () => {
        const entries: SitemapEntry[] = [
          { path: "/", changefreq: "weekly", priority: "1.0" },
          { path: "/store", changefreq: "weekly", priority: "0.8" },
          { path: "/all-access-pass", changefreq: "weekly", priority: "0.8" },
          { path: "/glory-holes", changefreq: "weekly", priority: "0.7" },
          { path: "/private-room", changefreq: "weekly", priority: "0.7" },
          { path: "/panty-drawer", changefreq: "weekly", priority: "0.7" },
          { path: "/partnerships", changefreq: "monthly", priority: "0.6" },
          { path: "/conduct", changefreq: "monthly", priority: "0.4" },
          { path: "/compliance", changefreq: "monthly", priority: "0.4" },
          { path: "/privacy", changefreq: "yearly", priority: "0.3" },
          { path: "/terms", changefreq: "yearly", priority: "0.3" },
          { path: "/legal", changefreq: "yearly", priority: "0.3" },
          { path: "/guide/etiquette", changefreq: "monthly", priority: "0.6" },
        ];
        // Intentionally omitted from the sitemap AND disallowed in
        // public/robots.txt: /auth, /forgot-password, /reset-password,
        // /age-gate, /unsubscribe, /checkout/*, /security-report, /mcp —
        // these are auth flows, transactional utility pages, an MCP API
        // endpoint, or protected content that should not be indexed.

        try {
          const events = await listPublicEvents();
          for (const e of events) {
            entries.push({ path: `/events/${e.id}`, changefreq: "daily", priority: "0.7" });
          }
        } catch {
          // ignore
        }
        try {
          const items = await listStoreItems();
          for (const it of items) {
            entries.push({ path: `/store/${it.id}`, changefreq: "weekly", priority: "0.6" });
          }
        } catch {
          // ignore
        }

        const urls = entries.map((e) =>
          [
            `  <url>`,
            `    <loc>${BASE_URL}${e.path}</loc>`,
            e.lastmod ? `    <lastmod>${e.lastmod}</lastmod>` : null,
            e.changefreq ? `    <changefreq>${e.changefreq}</changefreq>` : null,
            e.priority ? `    <priority>${e.priority}</priority>` : null,
            `  </url>`,
          ]
            .filter(Boolean)
            .join("\n"),
        );

        const xml = [
          `<?xml version="1.0" encoding="UTF-8"?>`,
          `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">`,
          ...urls,
          `</urlset>`,
        ].join("\n");

        return new Response(xml, {
          headers: {
            "Content-Type": "application/xml",
            "Cache-Control": "public, max-age=3600",
          },
        });
      },
    },
  },
});
