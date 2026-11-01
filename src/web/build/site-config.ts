/**
 * Build-time site settings for the web app, read from site.config.json (repo root).
 *
 * Vite mode picks the environment:
 *   production  -> environments.prod   (deploy.sh prod; plain `vite build`)
 *   staging     -> environments.stg    (deploy.sh stg;  `vite build --mode staging`)
 *   development -> site URL http://localhost:5173, CDN hosts from environments.stg
 *                  (a local machine has no CDN of its own)
 *   test        -> fixed example.test hosts, so tests do not depend on the shipped config
 * Any other mode is an error: no silent default.
 */
import { readFileSync } from "node:fs";

export interface SiteSettings {
  /** https://host, no trailing slash. */
  siteUrl: string;
  /** CDN origin (portraits live under <cdnUrl>/portraits). */
  cdnUrl: string;
  /** Origin of the public thumbnails host. */
  thumbsUrl: string;
}

interface RawEnv {
  siteUrl?: string;
  cdnUrl?: string;
  publicThumbsUrl?: string;
}

const strip = (u: string): string => u.replace(/\/+$/, "");

function pick(raw: RawEnv | undefined, name: string): SiteSettings {
  const need = (key: keyof RawEnv): string => {
    const v = raw?.[key];
    if (typeof v !== "string" || v.trim() === "" || v.startsWith("REPLACE_WITH")) {
      throw new Error(`site.config.json: environments.${name}.${key} is missing. Set it, then rebuild.`);
    }
    return strip(v.trim());
  };
  const cdnUrl = need("cdnUrl");
  return {
    siteUrl: need("siteUrl"),
    cdnUrl,
    // The thumbs host is optional in site.config.json; the CDN host is the default.
    thumbsUrl: raw?.publicThumbsUrl ? strip(raw.publicThumbsUrl) : cdnUrl,
  };
}

export function loadSiteSettings(mode: string, configPath: string): SiteSettings {
  if (mode === "test") {
    return { siteUrl: "https://app.example.test", cdnUrl: "https://cdn.example.test", thumbsUrl: "https://thumbs.example.test" };
  }
  const config = JSON.parse(readFileSync(configPath, "utf-8")) as { environments?: Record<string, RawEnv> };
  if (mode === "production") return pick(config.environments?.prod, "prod");
  if (mode === "staging") return pick(config.environments?.stg, "stg");
  if (mode === "development") {
    return { ...pick(config.environments?.stg, "stg"), siteUrl: "http://localhost:5173" };
  }
  throw new Error(`Unsupported Vite mode "${mode}". Use production (prod), staging (stg) or development.`);
}

/** Replaces {{SITE_URL}}, {{CDN_URL}}, {{THUMBS_URL}}, {{CDN_HOSTS}} (space-separated, unique origins), {{BUILD_DATE}} (YYYY-MM-DD). */
export function fillTemplate(text: string, s: SiteSettings): string {
  const hosts = [...new Set([s.thumbsUrl, s.cdnUrl])].join(" ");
  return text
    .replaceAll("{{SITE_URL}}", s.siteUrl)
    .replaceAll("{{CDN_URL}}", s.cdnUrl)
    .replaceAll("{{THUMBS_URL}}", s.thumbsUrl)
    .replaceAll("{{CDN_HOSTS}}", hosts)
    .replaceAll("{{BUILD_DATE}}", new Date().toISOString().slice(0, 10));
}
