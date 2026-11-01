# Style Guide for "Smriti"

This guide describes the visual system as it is actually built in the portal,
for a designer building the standalone registration-desk mockup. Source code is
authoritative: theme tokens live in `src/web/src/index.css` (Tailwind v4
`@theme` block), fonts in `src/web/src/fonts.generated.css` (generated, do not
edit). Key reference components: `pages/RegistrationDeskPage.tsx`,
`components/registration-desk/` (DeskLookupPanel, DeskOverviewCard,
DeskSpotRegistrationPanel, DeskPaymentReview), `components/staff/StaffLayout.tsx`,
`components/SiteNav.tsx`, and the primitives in `components/ui/`.

The registration-desk UI runs inside the staff shell, so the guide covers the
staff shell first, then the desk-specific surfaces.

## Typography

Three families, self-hosted as woff2 under `/fonts/`, loaded with
`font-display: swap`. Available weights: Caveat 400/600/700, DM Sans
400/500/600/700, Playfair Display 400/600/700 (plus 400 italic).

| Token | Family | Stack | Where it is used |
|-------|--------|-------|------------------|
| `font-heading` | Playfair Display | `"Playfair Display", Georgia, serif` | Page titles (desk `h1` at `text-4xl sm:text-5xl`), section headings (`h2` at `text-2xl` to `text-3xl`), card headers, the desk hero heading, the photo-missing initial placeholder |
| `font-body` | DM Sans | `"DM Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif` | Everything else: body text, labels, form fields, buttons, table cells. Also the `body` element default |
| `font-accent` | Caveat | `"Caveat", cursive` | Short decorative eyebrows above headings: desk page "Smriti - Reunion day" (`text-xl text-terracotta`), dark panel "Welcome them in" (`text-xl text-soft-aqua`), modal "A new arrival" (`text-lg text-terracotta`). Never used for body copy |
| `font-sport` | Oswald | `"Oswald", "DM Sans", sans-serif` | Leaderboard/sport pages only, not the desk |
| `font-flag` | Twemoji Country Flags | `"Twemoji Country Flags", "Apple Color Emoji", ...` | Country-flag emoji codepoints only (unicode-range scoped) |

Type hierarchy in the desk page:

- Eyebrow: Caveat, 18-20px, terracotta on light surfaces, soft-aqua on the dark
  charcoal surface.
- Page title: Playfair, bold, 36px (48px from `sm:` up), charcoal.
- Section heading: Playfair, bold, 20-30px, charcoal.
- Card header: Playfair, bold, 16px, charcoal.
- Body/description: DM Sans 14px, muted.
- Small-caps labels: DM Sans 12px, semibold, uppercase, `tracking-wider`,
  muted (staff dashboard stat titles, table headers).
- Form labels: DM Sans 14px, semibold, charcoal, `mb-1.5`.
- Inline field error: DM Sans 14px, terracotta.
- Helper/hint text: DM Sans 12px, muted.

## Colors

Tokens defined in `src/web/src/index.css`. Hexes below are canonical.

### Brand and text

| Token | Hex | Usage |
|-------|-----|-------|
| `terracotta` | `#D76B51` | Primary action accent. Primary buttons, active nav links, unresolved/pending payment state, "Not present" state, inline errors. Gradients to `#C45A40` on primary buttons |
| `terracotta-light` | `#FDF3EF` | Tint background for terracotta: error badges, pending-payment warning boxes, ghost-button hover, non-veg toggle |
| `soft-aqua` | `#B9DFE2` | Support/state color: arrival and confirmed states, input focus border, complete step circles, the dark panel's ring decoration |
| `soft-aqua-light` | `#E4F3F4` | Tint background: "Venue team" chip, info badges, toggle active default, photo placeholder, payment-review info note |
| `soft-aqua-deep` | `#2A7A80` | Readable aqua text on light: "Payment confirmed", "Present since ...", info badge text, venue chip text |
| `charcoal` | `#1F2A33` | Primary text and the dark arrival surface (`bg-charcoal`) |
| `muted` | `#6B7280` | Secondary text, descriptions |
| `subtle` | `#9CA3AF` | Tertiary text, placeholders |
| `success` | `#2D9B67` | Success (status badges) |
| `warning` | `#F59E0B` | Warning (status badges) |

### Surfaces, borders

| Token | Hex | Usage |
|-------|-----|-------|
| `page` | `#F5F0E8` | Page background, mobile modal sheet background |
| `surface` | `#FDFBF7` | Warm white card/panel background (`Card`, `DataTable`, desk overview card, spot-registration panel) |
| `border` | `#E5E7EB` | Default input/select borders, table row dividers |
| `border-warm` | `rgba(200, 180, 150, 0.22)` | Card and panel edges, modal header dividers. Site nav and footer use the same family at `rgba(200, 180, 150, 0.2)` / `0.18` |
| `#f0ede8` | warm gray | Desk detail chips (meal, accommodation) and the check-in row top divider |
| `#FAFAF8` | near-white | Table header row background |
| `#F8F9FB` | cool gray | Disabled/read-only input background |

### Status and meal colors

| Token | Hex | Usage |
|-------|-----|-------|
| `veg-bg` / `veg-border` / `veg-text` | `#EBF7F0` / `#2D9B67` / `#1E7A4A` | Veg toggle active state, success badges |
| `nonveg-bg` / `nonveg-border` / `nonveg-text` | `#FDF3EF` / `#D76B51` / `#C4512F` | Non-veg toggle active state |
| amber (Tailwind) | `amber-100`/`amber-800`, `amber-100`/`amber-700` | Warning badges and stale-pending age chips |
| gray (Tailwind) | `gray-100`/`gray-600` | Default badge, fresh pending-age chip |
| `#FFCE7A` | credits-orange | Credits reel only, not the desk |

## Page, surface, and background treatment

- Body: `font-body`, color charcoal, background is `#f5f0e8` with two soft
  radial washes: soft-aqua (alpha 0.22) at top-left, terracotta (alpha 0.1) at
  bottom-right. `-webkit-font-smoothing: antialiased`.
- Staff shell (`StaffLayout`): `min-h-screen bg-page`, a sticky `SiteNav`
  (52px tall, `bg-surface`, warm 1px bottom border, soft shadow
  `0 2px 10px rgba(80,60,40,0.05)`), main content capped at
  `max-w-[1320px] mx-auto px-5 py-6`, and a minimal footer (10px text
  `#c8b8a8`, warm top border). Staff pages do not use the marketing footer.
- The desk page is `max-w-6xl mx-auto space-y-7 sm:space-y-10 pb-10`.

### The dark arrival surface (desk lookup)

`bg-charcoal`, `rounded-[2rem]`, `px-5 py-6 sm:px-8 sm:py-9`, white text, shadow
`0 20px 60px rgba(31,42,51,0.18)`. Decorative: a large soft-aqua ring
(`rounded-full border-[20px] border-soft-aqua/20`) peeking from the top-right.
Interior text scales: white at 70-55% opacity for descriptions and secondary
metadata, full white for the heading, soft-aqua for the eyebrow and "Present"
labels, terracotta for "Not present". Result rows sit on `bg-white/[0.06]` with
`divide-white/10`.

### Cards and panels

- Standard card (`Card`, `DataTable`): `bg-surface border border-border-warm
  rounded-2xl`, shadow `0 2px 10px rgba(80,60,40,0.06)`, padding 20px.
- Desk overview card: `rounded-[2rem] border-border-warm bg-surface p-5 sm:p-8`,
  shadow `0 16px 45px rgba(31,42,51,0.07)`, entry animation
  `fadeSlideIn 0.35s ease-out`.
- Spot-registration form panel: `rounded-[1.75rem]`, surface bg, warm border,
  `p-5 sm:p-6`.
- Payment review card: `rounded-[1.75rem] bg-white p-5 sm:p-8`, `shadow-sm`,
  entry `slideIn 0.3s ease-out`.
- Photo: 112-128px square, `rounded-[1.5rem]`, 1px `border` border. Missing
  photo = `bg-soft-aqua-light` square with the name's first letter in Playfair,
  36px, `text-soft-aqua-deep`.
- Info chips: `rounded-full text-xs font-semibold`, participation chip is
  `bg-soft-aqua/40 text-charcoal`, meal/accommodation chips are
  `bg-[#f0ede8] text-charcoal`.
- Pending-payment warning box: `rounded-2xl border border-terracotta/40
  bg-terracotta-light p-4 sm:p-5`; bold terracotta title, muted 12px note.

### Modals and sheets

The spot-registration flow is one dialog with two stages (form, then payment
review) that share the same slide transition:

- Mobile (< 768px): full-screen push sheet - `fixed inset-0 z-40 bg-page`,
  header with warm bottom border, content scrolls, close control is
  "Back". Entry `slideIn 0.25s ease-out`.
- Desktop (>= 768px): centered modal - backdrop `bg-charcoal/40
  backdrop-blur-[2px]`, panel `max-w-3xl max-h-[92vh] rounded-[2rem] bg-page
  shadow-2xl`, header `px-5 py-4 sm:px-7`, body `p-6 sm:p-8`, close control is
  a ghost button labelled "Close".
- Header pattern inside the dialog: Caveat eyebrow in terracotta + Playfair
  bold heading in charcoal.

## Controls

### Buttons (`components/ui/Button.tsx`)

- Geometry: `rounded-xl`, font-semibold, heights - sm 36px (`px-3 text-sm
  rounded-lg`), md 44px (`px-5 text-base`), lg 54px (`px-7`). Full-width when
  the desk layout needs it.
- Primary: `bg-linear-to-br from-terracotta to-[#C45A40]`, white text,
  `shadow-md`, hover `brightness-90`, active `brightness-85`.
- Secondary: white bg, `border-[1.5px] border-border`, charcoal text, hover
  terracotta border + text, active `bg-terracotta-light`.
- Ghost: transparent, charcoal text, hover `bg-terracotta-light
  hover:text-terracotta`.
- Disabled (not loading): `bg-[#D1D5DB] text-muted cursor-not-allowed`, no
  shadow, transparent border.
- Loading: label becomes invisible (width is preserved), a spinner
  (`animate-spin border-current border-t-transparent`) centers over the label.
- Focus: `focus-visible:ring-2 ring-terracotta ring-offset-2`.

### Inputs, selects, search (`Input.tsx`, `Select.tsx`, `SearchInput.tsx`)

- Geometry: `h-11` (44px), `rounded-[10px]`, `border-[1.5px]`, 14px body font,
  `px-[14px]`, `outline-none` (no ring on inputs).
- Border color states: default `border`, focused `soft-aqua`, error
  `terracotta` (plus `aria-invalid`). Disabled/read-only background
  `#F8F9FB`. Placeholder `text-subtle`.
- Select: same geometry, `appearance-none`, trailing chevron is a small "v"
  glyph at `text-[10px] text-subtle`; placeholder option renders
  `text-subtle`.
- Search input: same geometry with a 16px inline SVG magnifier at
  `left-3 text-muted`.
- Focus transition: `transition-[border-color] duration-150` (0.15s).

### Toggle (`Toggle.tsx`) and meal toggle (`form/MealToggle.tsx`)

- Segmented control, `role="radiogroup"`, `h-10`, `rounded-[9px]`,
  `border-[1.5px]`, `text-xs font-bold`, gap 8px, `flex-1` segments.
- Active default: `bg-soft-aqua-light border-soft-aqua text-charcoal`.
- Inactive: white, `border-border`, `text-subtle`.
- Meal toggle active overrides: veg = `bg-veg-bg border-veg-border
  text-veg-text`, non-veg = `bg-nonveg-bg border-nonveg-border
  text-nonveg-text`. Each segment shows a small emoji (leaf / drumstick)
  before the label.
- Focus: `focus-visible:ring-2 ring-terracotta ring-offset-2` on the group;
  arrow keys change selection.

### File upload (`FileUpload.tsx`)

- Dropzone: `rounded-[10px]`, `border-[1.5px]` dashed by default (solid on
  drag-over or error), `min-h-[120px] p-6`, white bg. Focus
  `ring-2 ring-soft-aqua/40`. 16-32px inline SVG icons.
- Constraint text under the dropzone: `text-sm text-subtle`; live errors
  `text-terracotta`.

### Links and nav

- Staff nav links: `text-sm font-semibold`, charcoal, hover terracotta; active
  link is terracotta with `underline underline-offset-4`.
- Mobile hamburger: 40x40 touch target, three 2px charcoal bars.

## Icons

No icon library. Two conventions, used consistently:

1. Inline stroke SVGs: 24x24 `viewBox`, `fill="none" stroke="currentColor"`,
   `strokeWidth` 1.5-2, `strokeLinecap="round"` `strokeLinejoin="round"`,
   sized 16-24px, colored with `text-*` tokens (`text-muted`, `text-terracotta`,
   `text-soft-aqua`). Examples: search magnifier, file, checkmark, PDF, close.
   Spinners are the same style rotated with `animate-spin`.
2. Emoji and typographic glyphs: meal icons (leaf, drumstick), the desk search
   magnifier is a text glyph, select chevron is a text glyph, mobile close is
   the text "Back", primary CTAs use "+" text prefixes (for example
   "+ Add child").

Logo: raster `public/assets/smriti-logo.png` in a circular crop; if it fails,
a Playfair "S" on the brand colors.

## Status treatments

Semantic mapping used across the staff pages:

| State | Treatment |
|-------|-----------|
| Payment confirmed / Present / arrival | soft-aqua family: `text-soft-aqua-deep` on light, `text-soft-aqua` on the dark surface |
| Payment pending / Not present / next action | terracotta: text or `border-terracotta/40 bg-terracotta-light` warning box with amount due; no payment mutation is offered |
| Registration status badges | `Badge` variants: `success` (confirmed, `bg-veg-bg text-veg-text`), `info` (pending verification, `bg-soft-aqua-light text-[#2A7A80]`), `warning` (pending, `bg-amber-100 text-amber-800`), `error` (`bg-terracotta-light text-terracotta`) |
| Pending-age chip | amber-100/amber-700 when stale, gray-100/gray-500 when fresh |
| Check-in confirm | after marking present, the state line animates in with `confetti-chk 0.65s ease-out` |
| Role badge (nav) | admin = `error`, staff = `info` |

Badge geometry: `inline-block px-2 py-px rounded-[10px] text-xs font-medium`.

## Focus, accessibility, and motion

- Every interactive element has a visible focus treatment: buttons and toggles
  use `ring-2 ring-terracotta ring-offset-2`; inputs/selects change their
  border to soft-aqua; list rows use `ring-2 ring-inset ring-soft-aqua`.
- Text contrast targets: charcoal on page/surface for primary text, muted for
  secondary, terracotta/soft-aqua-deep for emphasized status text (WCAG AA
  intent).
- All form errors are announced: inline terracotta text plus `role="alert"`
  where a field group fails.
- `prefers-reduced-motion: reduce` disables entrance/confetti animations
  (handled centrally in `index.css`).
- 44px minimum touch target for every interactive control at viewport widths
  up to 768px (buttons `h-11` minimum, inputs `h-11`, remove buttons 44x44).
- The dark panel's search triggers automatically 450ms after typing stops (a
  desk operator may paste a scanned pass link as text); the mockup must keep
  this field a plain text input. The app has no camera scanner UI - do not
  invent one.

## Layout and responsive behavior

- Breakpoints: Tailwind defaults; `sm` 640px, `md` 768px, `lg` 1024px. The
  `useIsMobile` hook treats < 768px as mobile.
- Staff content: `max-w-[1320px]`, horizontal padding `px-5` (mobile),
  `md:px-14`. The desk page is narrower: `max-w-6xl`.
- Nav is `h-[52px]` and sticky at `z-[300]`; the staff mobile menu drops below
  it (`bg-surface/95 backdrop-blur-md`) with `fadeIn 0.15s`.
- Desk layout: vertical stack, `space-y-7 sm:space-y-10`; the "Venue team"
  chip is hidden below `sm`.
- Forms: single column on mobile, two columns from `sm:` (`grid-cols-1
  sm:grid-cols-2 gap-4`); optional spouse/children/guests blocks are
  `rounded-xl border border-[#f0ede8] p-4`.
- Full-width primary buttons on mobile (`w-full sm:w-auto` for secondary
  actions, `w-full` for submit).

## Registration Desk Pattern

- Use the dark charcoal arrival surface for the single combined name/code lookup.
- Use one reusable spot-registration flow: full-screen push sheet below 768px and
  centered modal above it. The form and server-returned payment review share the
  same slide transition.
- Reserve terracotta for the next action or an unresolved payment state; use soft
  aqua for arrival and confirmed states.

## What to avoid

- Do not invent a new brand system or new color names. All colors above are the
  only ones in use; prefer the token hexes over new shades.
- Do not add a camera/scan overlay for the name/code lookup. The desk reads a
  scanned pass as pasted text in the search input. The only camera affordance
  in the app is the spot-registration photo upload, which hints the file picker
  to offer the rear camera (`capture="environment"`); it is an upload, not a
  scanner.
- Do not introduce icon sets. Keep inline stroke SVGs and the existing emoji
  glyphs.
- Do not add the marketing footer or marketing-style hero content to the staff
  shell.
- Some spec documents describe tokens that do not exist in code (for example
  `shadow-card`, `rounded-input`, `gradient-primary` in `docs/specs/theme.spec.md`).
  The code applies these as Tailwind arbitrary values; follow the geometry and
  values in this guide, not the spec token names.
- `docs/specs/theme.spec.md` claims component files never hardcode hex values;
  in practice a few do (participation pills, `#f0ede8` chips, `#2A7A80` text).
  This guide records the effective values, so the mockup should match the
  rendered result, not the claim.

## Logo Files

- English: `public/assets/logo-en.jpeg`
- Malayalam: `public/assets/logo-ml.jpeg`
