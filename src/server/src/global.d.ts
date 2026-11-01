/**
 * Type declarations for binary assets imported via wrangler Data rules.
 * wrangler bundles .pdf and .ttf files as ArrayBuffer at build time.
 */
declare module "*.pdf" {
  const data: ArrayBuffer;
  export default data;
}

declare module "*.ttf" {
  const data: ArrayBuffer;
  export default data;
}
