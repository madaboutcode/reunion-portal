import { defineConfig, type Plugin } from "vite";
import { fillTemplate, loadSiteSettings, type SiteSettings } from "./build/site-config.ts";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";
import { execSync } from "child_process";
import { readFileSync, writeFileSync, existsSync, readdirSync } from "fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, "../..");

const gitHash = execSync("git rev-parse --short HEAD").toString().trim();
const buildId = process.env.BUILD_ID || `${gitHash}-${Date.now()}`;

function ogVariants(site: SiteSettings): Record<string, Record<string, string>> {
  return {
    sponsor: {
      "og:title": "Support Smriti 2026 — Still Part of Smriti",
      "og:description":
        "Support the reunion, campus solar project, and student scholarships. TKMCE Batch of 2006.",
      "og:image": `${site.siteUrl}/assets/og-sponsor.jpg`,
      "og:url": `${site.siteUrl}/sponsor`,
      "twitter:title": "Support Smriti 2026 — Still Part of Smriti",
      "twitter:description":
        "Support the reunion, campus solar project, and student scholarships.",
      "twitter:image": `${site.siteUrl}/assets/og-sponsor.jpg`,
    },
  };
}

/**
 * Fills {{SITE_URL}} etc. in index.html, and writes the generated _headers, robots.txt and
 * sitemap.xml (from site-templates/) into dist only. Generated files are never committed.
 */
function siteConfigPlugin(site: SiteSettings): Plugin {
  const templates: Record<string, string> = {
    "_headers.tpl": "_headers",
    "robots.txt.tpl": "robots.txt",
    "sitemap.xml.tpl": "sitemap.xml",
  };
  return {
    name: "site-config",
    transformIndexHtml: { order: "pre", handler: (html) => fillTemplate(html, site) },
    generateBundle() {
      const dir = resolve(__dirname, "site-templates");
      for (const file of readdirSync(dir)) {
        const out = templates[file];
        if (!out) continue;
        this.emitFile({ type: "asset", fileName: out, source: fillTemplate(readFileSync(resolve(dir, file), "utf-8"), site) });
      }
    },
  };
}

function ogVariantsPlugin(site: SiteSettings): Plugin {
  return {
    name: "og-variants",
    apply: "build",
    closeBundle() {
      const indexPath = resolve(__dirname, "dist/index.html");
      if (!existsSync(indexPath)) return;
      const indexHtml = readFileSync(indexPath, "utf-8");

      for (const [route, tags] of Object.entries(ogVariants(site))) {
        let html = indexHtml;
        for (const [property, value] of Object.entries(tags)) {
          const isOg = property.startsWith("og:");
          const attr = isOg ? "property" : "name";
          html = html.replace(
            new RegExp(
              `(<meta ${attr}="${property}" content=")([^"]*)(")`,
            ),
            `$1${value}$3`,
          );
        }
        html = html.replace(
          /<link rel="canonical" href="[^"]*"/,
          `<link rel="canonical" href="${site.siteUrl}/${route}"`,
        );
        writeFileSync(resolve(__dirname, `dist/${route}.html`), html);
      }
    },
  };
}

export default defineConfig(({ mode }) => {
  const site = loadSiteSettings(mode, resolve(projectRoot, "site.config.json"));
  const origins = [...new Set([site.cdnUrl, site.thumbsUrl])]
    .map((o) => new URL(o).origin.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("|");
  const ledWallPhotoPattern = new RegExp(
    `^(?:${origins})(?:/portraits/\\d+\\.webp(?:\\?.*)?|/\\d+\\.jpg)$`,
  );
  return {
  define: {
    __CDN_URL__: JSON.stringify(site.cdnUrl),
    __GIT_HASH__: JSON.stringify(gitHash),
    __BUILD_ID__: JSON.stringify(buildId),
  },
  plugins: [
    react(),
    tailwindcss(),
    siteConfigPlugin(site),
    ogVariantsPlugin(site),
    VitePWA({
      registerType: "autoUpdate",
      // We register the SW ourselves in main.tsx so we can force an update
      // check on foreground/resume (iOS PWAs only auto-check on cold launch).
      injectRegister: false,
      // Icons live in public/assets/pwa — copied as-is, not fingerprinted.
      includeAssets: ["assets/pwa/apple-touch-180.png"],
      // Installed app opens straight to the committee todo (the only install nudge).
      manifest: {
        name: "Smriti Committee Todo",
        short_name: "Committee",
        description: "Committee task list for Smriti 2026.",
        start_url: "/committee/todos?source=pwa",
        scope: "/",
        display: "standalone",
        orientation: "portrait",
        theme_color: "#1F2A33",
        background_color: "#F5F0E8",
        icons: [
          { src: "/assets/pwa/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
          { src: "/assets/pwa/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
          { src: "/assets/pwa/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        // SPA shell fallback, but never shadow the API — those must hit the network.
        navigateFallback: "/index.html",
        navigateFallbackDenylist: [/^\/api\//],
        // Precache the app shell + fonts + PWA icons ONLY. The many marketing
        // images in public/ (OG cards, polaroids, hero JPGs — tens of MB) must
        // NOT be precached; committee photos load from the CDN at runtime.
        globPatterns: ["**/*.{js,css,html,woff2}", "assets/pwa/*.png"],
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
        cleanupOutdatedCaches: true,
        // LED-wall attendee photos: served from the CDN, cached at RUNTIME
        // (not precached — they aren't build assets). CacheFirst so once
        // `/led-wall/precache` has warmed a photo, the wall serves it from
        // Cache Storage without touching the network — the point being a
        // flaky venue link can't stall the wall. The wall's <img> requests
        // are cross-origin no-cors (opaque, status 0), so status 0 must be
        // cacheable; that also means opaque-response storage padding applies,
        // hence the entry cap.
        //
        // Scoped to EXACTLY the two URL shapes the wall requests (desk-roster's
        // portraitUrl/thumbnailUrl), NOT "any image on this host". That is what
        // keeps WhosComingView OUT of this bucket: it hits the same CDN host for
        // `<id>.jpg?v=<version>`, and its `?v=` query is excluded here (the wall
        // never uses one). Without that exclusion, WhosComing thumbnail traffic
        // would share this bucket's `maxEntries` budget and could evict the very
        // photos the pre-cache warmed — defeating the durability guarantee.
        //   portrait:   /portraits/<id>.webp
        //   thumbnail:  /<id>.jpg   (no query string)
        runtimeCaching: [
          {
            // A RegExp, not a function: the service worker is a separate script, so a function
            // here could not see build-time values such as the CDN hosts.
            urlPattern: ledWallPhotoPattern,
            handler: "CacheFirst",
            options: {
              cacheName: "led-wall-photos",
              expiration: {
                maxEntries: 2000,
                maxAgeSeconds: 60 * 60 * 24 * 30,
              },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
  resolve: {
    alias: {
      "@": resolve(__dirname, "./src"),
      "@smriti/shared": resolve(projectRoot, "src/shared/src"),
    },
  },
  server: {
    proxy: {
      "/api": {
        target: `http://localhost:${process.env.API_PORT || "8787"}`,
        changeOrigin: true,
      },
    },
  },
};
});
