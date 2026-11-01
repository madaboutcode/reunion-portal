/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

declare const __GIT_HASH__: string;
declare const __BUILD_ID__: string;

/** Injected from site.config.json at build time (vite.config.ts, vitest.config.ts). */
declare const __CDN_URL__: string;
