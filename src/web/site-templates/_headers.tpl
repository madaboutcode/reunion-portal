# TEMPLATE: build/site-config.ts fills {{...}} and the web build writes dist/_headers.
# Do not copy this file into public/. Cloudflare Pages reads dist/_headers.
/*
  X-Frame-Options: DENY
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  Permissions-Policy: camera=(), microphone=(), geolocation=()
  Strict-Transport-Security: max-age=63072000; includeSubDomains; preload
  Content-Security-Policy: default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; connect-src 'self' {{CDN_HOSTS}}; img-src 'self' data: blob: {{CDN_HOSTS}}; frame-src 'none'; object-src 'none'

/assets/*
  Cache-Control: public, max-age=31536000, immutable

/fonts/*
  Cache-Control: public, max-age=31536000, immutable

/index.html
  Cache-Control: no-cache

/sponsor.html
  Cache-Control: no-cache
