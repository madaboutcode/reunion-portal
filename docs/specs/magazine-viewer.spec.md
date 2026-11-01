# Specification: Magazine Viewer

## Purpose

The magazine viewer lets a visitor discover, read, navigate, resume, share,
and download one or more image-based magazine issues on desktop and mobile.

## Contents

- [Purpose](#purpose)
- [Scope](#scope)
- [Terms](#terms)
- [Requirements](#requirements)
  - [R1 - Issue discovery and landing](#r1---issue-discovery-and-landing)
  - [R2 - Manifest contract](#r2---manifest-contract)
  - [R3 - Canonical navigation and deep links](#r3---canonical-navigation-and-deep-links)
  - [R4 - Reader controls and reading flow](#r4---reader-controls-and-reading-flow)
  - [R5 - Loading and performance](#r5---loading-and-performance)
  - [R6 - CDN asset contract](#r6---cdn-asset-contract)
  - [R7 - Reading progress](#r7---reading-progress)
  - [R8 - Visual and responsive behavior](#r8---visual-and-responsive-behavior)
  - [R9 - Accessibility and content alternatives](#r9---accessibility-and-content-alternatives)
- [States](#states)
- [Data Flow](#data-flow)
- [Edge Cases](#edge-cases)
- [Dependencies](#dependencies)
- [Acceptance Criteria](#acceptance-criteria)

## Scope

### In scope

- Public issue landing pages and a page reader.
- A configurable JSON manifest for each issue.
- CDN-hosted issue metadata, cover images, page images, thumbnails, and PDFs.
- Article and page navigation with stable deep links.
- Lazy loading, bounded page mounting, fit-width reading, and zoom/pan.
- Per-issue reading progress stored in the visitor's browser.
- Keyboard, touch, and screen-reader accessible controls.
- Loading, invalid-data, missing-asset, and offline failure states.

### Out of scope

- OCR, selectable text, full-text search, or text-to-speech for scanned pages.
- Editing magazine metadata from the website.
- A server API for page navigation or progress storage.
- Page-turn animations as the primary reading interaction.
- User accounts or cross-device progress synchronisation.
- An upload UI. Issue publication is a one-time release operation.

## Terms

- **Issue:** One published magazine identified by a stable `id` and URL
  `slug`.
- **Page:** One ordered image in an issue. A page has a stable `id` that is
  independent of its display number.
- **Contents entry:** An article, chapter, note, or other navigable section
  that points to one or more pages.
- **Manifest:** JSON metadata that describes an issue and its CDN assets.

## Requirements

### R1 - Issue discovery and landing

R1.1 - The public viewer MUST support the route
`/magazine/:issueSlug`.

R1.2 - The public viewer MUST support `/magazine` as a convenience route. It
MUST resolve the issue marked `isDefault` in the issue index. The viewer MUST
NOT choose an issue by array position or by hardcoded issue name.

R1.3 - A valid issue landing page MUST display the issue title, optional
subtitle, optional edition/date, cover image, page count, and a primary `Read
magazine` action using manifest data.

R1.4 - If the visitor has saved progress for the issue, the primary action MUST
change to `Continue reading` and identify the saved page. A separate action
MUST allow starting from the cover.

R1.5 - The landing page MUST display a `Download PDF` action only when the
manifest contains `downloadUrl`.

R1.6 - The landing page MUST display a contents list when the manifest contains
contents entries. A missing contents list MUST NOT create an empty broken panel.

R1.7 - An unknown issue slug MUST render an issue-specific recovery state with
links to the default issue, the magazine index, and the site home.

R1.8 - If the issue index cannot be loaded, the viewer MUST show `Magazine
unavailable` with a `Retry` action and a link to the site home. The viewer MUST
NOT guess a default issue from a local fallback list.

### R2 - Manifest contract

R2.1 - The viewer MUST consume issue details from JSON metadata. Issue titles,
page counts, page URLs, page labels, cover details, contents entries, and
download URLs MUST NOT be hardcoded in viewer component logic.

R2.2 - A manifest MUST contain the following fields:

```json
{
  "schemaVersion": 1,
  "id": "stable-issue-id",
  "slug": "issue-url-slug",
  "title": "Magazine title",
  "pageCount": 1,
  "pages": [
    {
      "id": "page-001",
      "number": 1,
      "src": "https://cdn.example.org/magazines/issue-url-slug/pages/page-001.webp",
      "width": 1191,
      "height": 1684,
      "alt": "Magazine cover"
    }
  ],
  "cover": {
    "pageId": "page-001",
    "src": "https://cdn.example.org/magazines/issue-url-slug/cover.webp",
    "width": 1191,
    "height": 1684,
    "alt": "Magazine cover"
  }
}
```

R2.3 - A manifest MAY contain `subtitle`, `edition`, `publishedAt`, `locale`,
`contents`, and `downloadUrl`.

R2.4 - Each page MUST contain a unique `id`, a unique positive `number`, an
absolute `src`, intrinsic `width` and `height`, and an `alt` value. `label` and
`thumbnailSrc` are optional.

R2.5 - `pageCount` MUST equal `pages.length`. Pages MUST be ordered by
`number`. Page IDs MUST be unique and MUST NOT be generated from array position
inside the viewer.

R2.6 - The cover MUST reference an existing page through `pageId` and MUST
contain an absolute image URL, intrinsic dimensions, and alternative text.

R2.7 - Each contents entry MUST contain a unique `id`, a display `title`, and
an existing `startPageId`. It MAY contain `endPageId`, `kicker`, `author`, and
`type`. `endPageId`, when present, MUST reference an existing page that is not
before `startPageId`.

R2.8 - The issue index MUST be available at
`https://cdn.example.org/magazines/index.json` and MUST contain
`schemaVersion` and an `issues` array. Each issue entry MUST identify the issue
by `id`, `slug`, title, cover URL, and manifest URL. At most one issue MAY be
marked `isDefault`.

R2.9 - The viewer MUST validate manifest references before rendering a reader.
Invalid manifests MUST render a useful issue-unavailable state and MUST NOT
partially render pages with guessed values.

R2.10 - Unknown optional fields and unknown contents `type` values MUST NOT
make an otherwise valid manifest unavailable.

R2.11 - Contents entries MUST be ordered by `startPageId` page order. Their
configured ranges MUST NOT overlap unless the manifest explicitly declares an
entry as a nested `type`.

R2.12 - If an issue manifest or the issue index has a `schemaVersion` newer
than the highest version supported by the viewer, the viewer MUST show `This
magazine version is not supported.` with a `Retry` action and MUST NOT render
issue pages.

R2.13 - A manifest MAY contain an `intro` object for a scroll-controlled
magazine opening. When present, `intro` MUST contain `frameRate`, `duration`,
`frameCount`, intrinsic `width` and `height`, an ordered `frames` array, and
absolute CDN `src` and alternative text for every frame. It MAY contain a
`mobile` variant with the same playback and frame fields and an optional `quote`
string. When present, a responsive viewer MUST use `mobile.quote` for the
mobile pull quote; otherwise it MUST use the parent `intro.quote`. Other
editorial copy stays on the parent `intro` object. A viewer that supports
responsive intro sequences MUST select `mobile` once at startup when the
initial viewport is at or below 800px, when present, before preloading and
MUST preload only the selected sequence. It MUST NOT switch sequences after
startup. When valid intro metadata exists, the viewer MUST preload and run the
intro regardless of `prefers-reduced-motion`, Save-Data, effective connection
type, or device-memory hints. Those hints MUST NOT automatically skip the
intro. A viewer that does not implement the intro MUST ignore this object and
continue to the cover.

### R3 - Canonical navigation and deep links

R3.1 - The viewer MUST support the canonical page route
`/magazine/:issueSlug/page/:pageId`.

R3.2 - The viewer MUST support the canonical contents route
`/magazine/:issueSlug/article/:entryId`.

R3.3 - Opening an article URL MUST select the contents entry and open its
configured `startPageId`.

R3.4 - Opening a page URL MUST select that page without requiring the visitor to
start at the cover.

R3.5 - Previous and next page controls MUST follow manifest page order. They
MUST use page IDs, not filename sorting or arithmetic on display labels.

R3.6 - Selecting a contents entry MUST open its start page and highlight the
active contents entry.

R3.7 - When the active page falls within an entry's configured range, that entry
MUST remain highlighted. If no range is configured, the entry MUST end before
the next entry's start page.

R3.8 - Page navigation MUST update the canonical URL. Browser Back and Forward
MUST move between visited page locations rather than returning to an unrelated
site location.

R3.9 - Invalid page and article IDs MUST render an issue-specific recovery state
with links to the issue cover and contents.

### R4 - Reader controls and reading flow

R4.1 - The reader MUST show the active page, the current display label or number,
and total page count.

R4.2 - The reader MUST provide visible Previous, Next, Contents, and page
selection controls on desktop and mobile.

R4.3 - The reader MUST provide a visible Share action that copies or exposes the
canonical current page or article URL.

R4.4 - The reader MUST show the current article title when the active page is in
a contents entry.

R4.5 - Desktop MUST provide a collapsible contents rail or equivalent persistent
contents control. The contents control MUST NOT obscure the active page.

R4.6 - Mobile MUST provide a contents drawer or bottom sheet and a compact
sticky reader control bar. Mobile MUST keep Previous, page position, and Next
available without requiring a return to the landing page.

R4.7 - Keyboard users MUST be able to use Left/Right Arrow for page navigation,
Home/End for first/last page when the reader has focus, and Escape to close
contents or zoom layers.

R4.8 - The reader MUST provide fit-width and fit-page modes. It MUST provide a
controlled zoom and pan interaction for reading small page text on mobile.
Browser pinch zoom alone is not sufficient.

R4.9 - Horizontal swipe MAY supplement page controls on touch devices but MUST
NOT be the only page navigation method.

R4.10 - All interactive controls MUST have accessible names, visible focus
styles, and a minimum touch target of 44 by 44 CSS pixels.

### R5 - Loading and performance

R5.1 - The viewer MUST load issue metadata and cover information before loading
the full reader page stream.

R5.2 - The active full-size page MUST be requested before adjacent pages and
MUST be given the browser's highest available image-loading priority.

R5.3 - The reader view MUST render no more than three full-size page images at
once: the active page, at most one previous page, and at most one next page.
The implementation MUST NOT render all issue pages as full-size images at
once.

R5.4 - Requests for adjacent pages and contents thumbnails MUST be deferred
until the resource is near the viewport or the visitor requests it. The
implementation MUST use native browser lazy loading or an equivalent mechanism
and asynchronous decoding.

R5.5 - The viewer MUST reserve a page box whose height is calculated from the
manifest `width` and `height` before the image loads. When the image succeeds,
the page box height MUST NOT change because of image intrinsic dimensions.

R5.6 - After the active page loads, the viewer MAY prefetch the next page when
the browser does not signal Save-Data or an equivalent constrained connection.

R5.7 - If responsive CDN variants are available, the viewer SHOULD use
`srcset`/`sizes` or an equivalent mechanism to avoid sending desktop-sized
images to narrow devices.

R5.8 - A page-shaped loading skeleton MUST be shown while the active page is
loading.

R5.9 - A failed page image MUST show an inline `Retry page` action and the text
`This page could not be loaded.` Page failure MUST NOT disable navigation to
other pages.

R5.10 - When metadata or a page request fails while the browser reports no
network connection, the viewer MUST show `You appear to be offline` and a
`Retry` action. Already loaded pages and navigation controls MUST remain
available.

### R6 - CDN asset contract

R6.1 - Every issue-index, manifest, cover, page, thumbnail, and download URL
used in a published issue MUST be hosted at `https://cdn.example.org`. The host is the
`cdnUrl` value in `site.config.json` for the environment; `cdn.example.org` is a placeholder.

R6.2 - The recommended issue object layout is:

```text
magazines/<issueSlug>/manifest.json
magazines/<issueSlug>/cover.webp
magazines/<issueSlug>/pages/<pageId>.webp
magazines/<issueSlug>/thumbnails/<pageId>.webp
magazines/<issueSlug>/magazine.pdf
magazines/index.json
```

R6.3 - The viewer MUST use URLs from the manifest. It MUST NOT construct
issue-specific CDN paths from a current issue name or from a fixed page count.

R6.4 - Manifest responses MUST use `Content-Type: application/json` and MUST
allow browser reads from the deployed site origins.

R6.5 - Image responses MUST use the correct image MIME type and
`Cache-Control: public, max-age=31536000, immutable` for immutable issue
assets. Manifest and issue-index responses MUST use
`Cache-Control: public, max-age=300, must-revalidate` or a stricter
revalidation policy that permits metadata updates without a new app deployment.

R6.6 - PDF responses MUST use `Content-Type: application/pdf` and
`Content-Disposition: attachment` with the configured download filename.

R6.7 - The issue MUST NOT be linked from the public site until its manifest,
cover, referenced pages, and optional download URL have passed a public CDN
availability check.

R6.8 - CDN publication is a one-time release operation. Before the issue is
linked publicly, a release record MUST be written to
`docs/releases/magazines/<issueSlug>.md` with the issue slug, object keys, byte
sizes, checksums, response status, MIME types, cache headers, and download
disposition.

### R7 - Reading progress

R7.1 - The viewer MUST save the latest valid page ID per issue in browser-local
storage.

R7.2 - Progress for one issue MUST NOT overwrite progress for another issue.

R7.3 - The viewer MUST discard a saved page ID that is absent from the current
manifest and MUST follow R7.6 rather than silently falling back.

R7.4 - The viewer MUST offer a visible way to clear or restart saved progress
for the current issue.

R7.5 - Progress MUST NOT be sent to the server or included in public URLs unless
the visitor explicitly shares the current canonical page URL.

R7.6 - If saved progress references a page absent from the current manifest,
the viewer MUST show `Saved progress is no longer available. Starting from the
cover.` and continue from the cover.

### R8 - Visual and responsive behavior

R8.1 - The issue landing page MUST reuse the site's light navigation shell,
cream/paper surfaces, existing logo treatment, and established typography.

R8.2 - The landing page MUST make `Read magazine` the primary action. Download
MUST be visually secondary.

R8.3 - The reader MAY use a deep warm reading stage behind the page image, but
the stage MUST use the site's charcoal/warm palette and existing spacing and
control language.

R8.4 - Playfair Display MUST be used for issue and article headings, DM Sans for
controls and metadata, and Caveat only for short editorial accents.

R8.5 - Terracotta MUST be reserved for primary actions, active contents state,
progress, and focus accents. Selection MUST NOT be communicated by color alone.

R8.6 - The viewer MUST have no horizontal interface overflow at 375px, 768px,
and 1280px viewport widths.

R8.7 - Reader transitions MUST honor `prefers-reduced-motion`.

### R9 - Accessibility and content alternatives

R9.1 - Every meaningful cover and page image MUST use configured alternative
text. Decorative images MUST be explicitly marked decorative in metadata.

R9.2 - Loading, page failure, invalid manifest, unavailable issue, and download
unavailability states MUST be announced in accessible text.

R9.3 - The active contents entry, current page, and disabled Previous/Next state
MUST be exposed to assistive technology.

R9.4 - The reader MUST remain usable with keyboard navigation and visible focus
without relying on hover, swipe, or color.

## States

- Issue index loading.
- Issue index unavailable.
- Issue manifest loading.
- Issue unavailable because the slug is unknown.
- Issue unavailable because the manifest is invalid.
- Issue unavailable because the manifest or index version is unsupported.
- Issue landing with cover and contents.
- Issue landing without contents.
- Issue landing with no download URL.
- Reader loading active page.
- Reader ready with a selected page.
- Reader with contents open.
- Reader with page selector open.
- Reader with zoom/pan active.
- Reader at the first page with Previous disabled.
- Reader at the last page with Next disabled.
- Reader with an active article selection.
- Reader with no matching article for the active page.
- Page asset failed with retry available.
- Manifest or CDN request failed with retry available.
- Saved progress available.
- Saved progress invalid or no longer present.
- Offline or constrained connection.
- Reduced-motion preference enabled.

## Data Flow

1. The viewer loads an issue index from a configured JSON URL or receives an
   equivalent static index.
2. The index resolves an issue slug to one issue manifest URL.
3. The viewer validates the manifest and displays the issue landing state.
4. The route identifies an article or page ID. The viewer resolves it against
   manifest data and selects the corresponding page.
5. The viewer loads only the active page and adjacent buffer from absolute CDN
   URLs.
6. Page navigation updates the canonical URL and local progress.
7. Contents selection updates the active article and page URL.
8. Download and share actions use manifest-provided URLs.

The browser stores only the latest page ID per issue. No magazine data is
written to the application API.

## Edge Cases

- `pageCount` does not equal the number of pages: show the invalid-manifest
  state and do not render a partial reader.
- A page ID is duplicated: show the invalid-manifest state.
- A contents reference points to a missing page: show the invalid-manifest
  state and identify the invalid reference.
- A page label is nonnumeric, such as `Cover`, `i`, or `A-12`: display it as a
  label and continue using the stable page ID for navigation.
- A long issue title or article title: truncate only in compact controls and
  preserve the full value in accessible text or a tooltip.
- The issue has no contents entries: keep page navigation available and omit
  contents-specific controls.
- The issue has no `downloadUrl`: do not render a disabled or dead download
  button.
- A page request fails: keep Previous, Next, Contents, and retry available.
- A CDN request returns the wrong MIME type: show the relevant unavailable
  state rather than treating the response as a valid asset.
- A saved page ID is absent from a newer manifest: reset to the cover and show
  that saved progress could not be restored.
- A visitor opens a deep link before metadata loads: preserve the requested
  route and resolve it after validation.
- A visitor opens an invalid deep link: show recovery links without changing
  the browser URL unexpectedly.
- Save-Data or constrained connection is enabled: do not prefetch the next
  page and prefer the smallest configured compatible asset.
- The browser does not support the Web Share API: keep the canonical URL
  visible or copyable through a standard copy-link action.
- The visitor prefers reduced motion: disable page transitions and zoom
  animations while retaining state changes.

## Dependencies

- `docs/specs/theme.spec.md` for shared color, type, spacing, and contrast
  expectations (see `docs/specs/theme.spec.md` R1, R2, R3, R4, and R5).
- Existing public navigation and page-title conventions.
- A CDN origin at `https://cdn.example.org` (the `cdnUrl` in `site.config.json`) with public issue objects.
- Browser support for native lazy loading, local storage, responsive images,
  and accessible focus management.

## Acceptance Criteria

- A second fixture issue with a different title, page count, page labels,
  aspect ratio, cover, contents structure, and download URL renders without
  viewer component changes.
- `/magazine/:issueSlug` works after a direct browser load and refresh.
- `/magazine/:issueSlug/page/:pageId` opens the requested page directly.
- `/magazine/:issueSlug/article/:entryId` opens the configured article start
  page and highlights the article.
- The first page and cover load from the CDN; no published issue image loads
  from a local app asset path.
- Only the active page and a small adjacent buffer of full-size images are
  mounted.
- Non-active page images and contents thumbnails use native lazy loading.
- Page controls, contents navigation, page labels, zoom/pan, and progress work
  at 375px and 1280px widths.
- Browser Back and Forward follow visited page locations.
- Invalid manifests, unavailable issues, failed pages, and absent downloads
  produce actionable accessible states.
- The public PDF responds with `200`, `application/pdf`, attachment
  disposition, and the configured filename.
- Keyboard and screen-reader checks find named controls, visible focus, current
  page state, active contents state, and retry actions.
- The viewer matches the existing site's light editorial shell on the landing
  page and does not introduce a separate navigation aesthetic.
