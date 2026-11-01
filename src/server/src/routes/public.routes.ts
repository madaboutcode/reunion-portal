import { Hono } from "hono";
import type { AppEnv } from "../env.js";
import { rateLimitByCategory } from "../middleware/rate-limit.js";

interface WhosComingRow {
  id: number;
  full_name: string;
  branch: string;
  city: string;
  country: string;
  email: string | null;
  has_photo: number;
  created_at: number;
  updated_at: number;
}

interface PhotoThumbRow {
  photo_thumb_key: string | null;
}

interface DeskRosterCursorRow {
  seq: number;
}

interface DeskRosterFullRow {
  id: number;
  full_name: string;
  branch: string;
  checked_in_at: number;
  photo_thumb_key: string | null;
}

interface DeskRosterDeltaRow {
  seq: number;
  action: string;
  checked_in_at: number | null;
  id: number;
  full_name: string;
  branch: string;
  photo_thumb_key: string | null;
}

export const publicRoutes = new Hono<AppEnv>();

const ELIGIBLE_WHERE = `
  participation_type IN ('full_celebration', 'campus_only')
`;

const THUMB_CACHE_CONTROL =
  "public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400, immutable";

async function hashEmail(email: string | null | undefined): Promise<string> {
  if (!email) return "";
  const normalized = email.trim().toLowerCase();
  if (!normalized) return "";
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(normalized),
  );
  const hex = Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return hex.slice(0, 8);
}

publicRoutes.get("/whos-coming", rateLimitByCategory("query"), async (c) => {
  const result = await c.env.DB.prepare(
    `SELECT id, full_name, branch, city, country, email, created_at, updated_at,
                CASE WHEN photo_thumb_key IS NOT NULL THEN 1 ELSE 0 END AS has_photo
         FROM registrations
         WHERE ${ELIGIBLE_WHERE}
         ORDER BY branch, full_name`,
  ).all<WhosComingRow>();

  const people = await Promise.all(
    (result.results ?? []).map(async (row) => ({
      id: row.id,
      fullName: row.full_name,
      branch: row.branch,
      city: row.city,
      country: row.country,
      emailHash: await hashEmail(row.email),
      hasPhoto: row.has_photo === 1,
      createdAt: row.created_at,
    })),
  );

  const thumbsBaseUrl = c.env.PUBLIC_THUMBS_URL ?? "/api/public/photos";
  const photosVersion = (result.results ?? []).reduce(
    (max, row) => Math.max(max, Number(row.updated_at) || 0),
    0,
  );

  return c.json({ people, count: people.length, thumbsBaseUrl, photosVersion });
});

/** `photo_thumb_key ? {PUBLIC_PORTRAITS_URL}/{id}.webp : null` — no `?v=`
 *  version param (see plan Pre-Decisions "Portrait versioning": a version tied
 *  to updated_at would re-download every portrait on the wall on every
 *  check-in, since markPresent bumps updated_at). */
function portraitUrl(
  base: string | undefined,
  id: number,
  photoThumbKey: string | null,
): string | null {
  if (!photoThumbKey) return null;
  return `${base}/${id}.webp`;
}

/** Tier-2 fallback for the wall's transparent-cutout -> thumbnail -> initials
 *  chain. `photo_thumb_key ? {PUBLIC_THUMBS_URL}/{id}.jpg : null` — a
 *  DIFFERENT base than portraitUrl (PUBLIC_THUMBS_URL is a bare host, no
 *  `/portraits` suffix) and a different extension (`.jpg`, matching the
 *  existing /photos/:filename route's thumb format), so this is a separate
 *  function rather than a shared-suffix helper with portraitUrl. Same no-`?v=`
 *  reasoning as portraitUrl: a missing image negative-caches for 4h so a
 *  version bump can't recover it, and a shared version would re-download
 *  every thumbnail on the wall on every check-in. */
function thumbnailUrl(
  base: string | undefined,
  id: number,
  photoThumbKey: string | null,
): string | null {
  if (!photoThumbKey) return null;
  return `${base}/${id}.jpg`;
}

/**
 * Live registration-desk roster for venue display screens (the LED wall).
 *
 * "Present" = registrations.checked_in_at IS NOT NULL, set only by the desk's
 * markPresent action (walk-in or pre-registered arrive the same way). No
 * auth: public, low-stakes, best-effort, retired after the event.
 *
 * Two modes on one endpoint:
 *   - Full  (no `since`, or an unparseable one): everyone currently present.
 *     Bootstrap + periodic resync.
 *   - Delta (`?since=<seq>`): every check-in/undo audited after that cursor,
 *     oldest first.
 *
 * The cursor is `system_audit_log.id`, not a timestamp — D1 serializes
 * writes, so audit-id order is commit order and there is no same-millisecond
 * tie that could let a check-in slip past a `> :since` boundary (the old
 * checked_in_at-ms cursor had exactly that gap). It also carries removals: an
 * undo writes its own `attendee_check_in_undone` row, so a departure is a
 * delta event instead of "silently missing from the next full roster."
 *
 * Full mode reads the cursor (MAX(system_audit_log.id)) and the roster as two
 * separate statements, cursor first, rather than one db.batch(). Real D1 does
 * return each statement's own rows from a batch — the constraint is this
 * repo's SQLite test double (__tests__/helpers/sqlite-d1.ts), which only
 * returns meta.changes/meta.last_row_id per statement and drops SELECT
 * results. Every existing db.batch() call in this codebase (desk.repo.ts
 * markPresent/markAbsent) only ever reads meta.changes from a mutation, so a
 * batched SELECT has never been exercised against that double, and shipping
 * one unverified wasn't worth it here. Reading cursor-before-roster is the
 * documented safe order instead (plan Pre-Decisions "Cursor/roster
 * consistency in full mode", choice A): a check-in landing in the gap is
 * delivered once now and, redundantly, again on the next delta —
 * wallCore.ts already no-ops an exact repeat, so no duplicate spotlight. The
 * unsafe order (roster before cursor) would instead lose that arrival until
 * the next full resync.
 *
 * Delta mode reads the SAME cursor query first, for the same reason: an
 * unrelated audit row (a spot registration, say) has `id > since` but never
 * matches the event WHERE clause below, so if `seq` were derived only from
 * matching rows it would stall on every such row and the client would rescan
 * a widening `since` window until the next full resync re-anchored it.
 * Reading the cursor first, bounding the event query to `id <= ` that
 * cursor, and returning the cursor itself as `seq` makes full and delta agree
 * on exactly what "seq" means: MAX(system_audit_log.id) at read time. `seq`
 * only falls back to the caller's own `since` when `since` is already ahead
 * of that cursor (a client holding newer state than the log currently shows)
 * — it never returns anything below what the caller already has.
 *
 * Delta mode's `checkedInAt` comes from the audit row's own
 * `details.checkedInAt`, not `registrations.checked_in_at` — an undo clears
 * that column, so an arrival followed later by an undo (in different polls)
 * would otherwise report a null timestamp for the arrival. Only
 * `$.checkedInAt` is read; `$.checkedInBy` (a staff user id) and
 * `system_audit_log.actor` (a staff email) are never selected — this is a
 * public, unauthenticated endpoint. `details.checkedInAt` is asserted to be a
 * number before it's emitted: the write path (desk.repo.ts markPresent)
 * guarantees it, but the wall dedups a full-mode arrival against a
 * delta-mode arrival for the same person with `===`, and a silently coerced
 * or NaN value there would make that comparison never match — the same
 * person would re-spotlight on every poll.
 *
 * Cache-Control: no-store — the poll URL is otherwise constant/repeated and a
 * cached empty response would freeze a screen's cursor.
 */
publicRoutes.get("/desk-roster", async (c) => {
  const sinceRaw = c.req.query("since");
  // A missing, empty, or unparseable cursor falls back to full mode — the
  // safe resync path. (Number("") is 0, not NaN — reject it explicitly so an
  // empty `?since=` doesn't silently become "delta from the beginning".)
  const sinceNum = sinceRaw === undefined || sinceRaw === "" ? NaN : Number(sinceRaw);
  const since = Number.isFinite(sinceNum) && sinceNum >= 0 ? sinceNum : null;

  const now = Date.now();
  c.header("Cache-Control", "no-store");

  // Cursor before roster/events in both modes — see docstring for why this
  // order and not db.batch().
  const cursorRow = await c.env.DB.prepare(
    "SELECT COALESCE(MAX(id), 0) AS seq FROM system_audit_log",
  ).first<DeskRosterCursorRow>();
  // COALESCE(MAX(...), 0) over no WHERE clause always yields exactly one row.
  if (!cursorRow) throw new Error("desk-roster: cursor query returned no row");

  if (since === null) {
    const roster = await c.env.DB.prepare(
      `SELECT id, full_name, branch, checked_in_at, photo_thumb_key
         FROM registrations
         WHERE checked_in_at IS NOT NULL
           AND ${ELIGIBLE_WHERE}
         ORDER BY checked_in_at`,
    ).all<DeskRosterFullRow>();

    const entries = (roster.results ?? []).map((row) => ({
      registrationId: row.id,
      name: row.full_name,
      branch: row.branch,
      checkedInAt: row.checked_in_at,
      portraitUrl: portraitUrl(c.env.PUBLIC_PORTRAITS_URL, row.id, row.photo_thumb_key),
      thumbnailUrl: thumbnailUrl(c.env.PUBLIC_THUMBS_URL, row.id, row.photo_thumb_key),
    }));

    return c.json({ now, seq: cursorRow.seq, count: entries.length, entries });
  }

  const delta = await c.env.DB.prepare(
    `SELECT a.id AS seq, a.action,
            json_extract(a.details, '$.checkedInAt') AS checked_in_at,
            r.id, r.full_name, r.branch, r.photo_thumb_key
       FROM system_audit_log a
       JOIN registrations r ON r.id = a.target_id
       WHERE a.id > ? AND a.id <= ?
         AND a.target_type = 'registration'
         AND a.action IN ('attendee_checked_in', 'attendee_check_in_undone')
         AND ${ELIGIBLE_WHERE}
       ORDER BY a.id`,
  )
    .bind(since, cursorRow.seq)
    .all<DeskRosterDeltaRow>();

  const rows = delta.results ?? [];
  const events = rows.map((row) => {
    if (row.action === "attendee_checked_in") {
      if (typeof row.checked_in_at !== "number") {
        throw new Error(`desk-roster: non-numeric checkedInAt for arrival ${row.id}`);
      }
      return {
        seq: row.seq,
        type: "arrival" as const,
        registrationId: row.id,
        name: row.full_name,
        branch: row.branch,
        checkedInAt: row.checked_in_at,
        portraitUrl: portraitUrl(c.env.PUBLIC_PORTRAITS_URL, row.id, row.photo_thumb_key),
        thumbnailUrl: thumbnailUrl(c.env.PUBLIC_THUMBS_URL, row.id, row.photo_thumb_key),
      };
    }
    if (row.action === "attendee_check_in_undone") {
      return { seq: row.seq, type: "departure" as const, registrationId: row.id };
    }
    // The WHERE clause only admits these two actions — anything else is a bug.
    throw new Error(`desk-roster: unexpected audit action "${row.action}"`);
  });

  // seq is the global cursor read above, never below what the caller already
  // holds (guards a `since` that somehow arrived ahead of the log's current
  // max) — see docstring.
  const seq = Math.max(cursorRow.seq, since);

  return c.json({ now, seq, events });
});

/**
 * Image manifest for pre-caching the LED wall's photos on the display device.
 *
 * The wall (`/led-wall`) fetches each attendee's transparent portrait and
 * thumbnail from the CDN lazily, as they check in. `/led-wall/precache` uses
 * this manifest to pull every eligible attendee's images into a durable
 * service-worker cache ahead of the event, so the wall renders instantly and
 * survives a flaky venue network.
 *
 * URL-IDENTITY IS THE CONTRACT: portraitUrl/thumbnailUrl here are built by the
 * SAME `portraitUrl()`/`thumbnailUrl()` helpers, from the SAME env bases, with
 * the SAME no-`?v=` format as the desk-roster route. A pre-cached response is
 * keyed by exact URL — if these drifted from what the wall requests (e.g. by
 * borrowing whos-coming's `?v=photosVersion` thumbnail convention), every
 * pre-cache would be a wall cache MISS. That is why this lives next to
 * desk-roster and reuses its helpers rather than extending whos-coming.
 *
 * The roster query (eligible + has-photo, not check-in filtered) lives in
 * deskRepo.listWallImageRows — the route only maps rows to CDN URLs.
 *
 * Cache-Control: no-store — a small, on-demand JSON whose freshness matters
 * (a photo added an hour before the event should appear on the next run).
 *
 * Rate-limited under "query", matching /whos-coming (the other full-roster
 * endpoint here). It exposes nothing whos-coming doesn't already publish, but
 * a full-roster read deserves the same throttle rather than desk-roster's
 * unthrottled per-second-poll posture.
 */
publicRoutes.get("/wall-image-manifest", rateLimitByCategory("query"), async (c) => {
  c.header("Cache-Control", "no-store");

  const rows = await c.var.deskRepo.listWallImageRows();
  const images = rows.map((row) => ({
    id: row.id,
    portraitUrl: portraitUrl(c.env.PUBLIC_PORTRAITS_URL, row.id, row.photo_thumb_key),
    thumbnailUrl: thumbnailUrl(c.env.PUBLIC_THUMBS_URL, row.id, row.photo_thumb_key),
  }));

  return c.json({ count: images.length, images });
});

publicRoutes.get(
  "/photos/:filename",
  rateLimitByCategory("photo"),
  async (c) => {
    const filename = c.req.param("filename");
    const match = filename?.match(/^(\d+)\.jpg$/);
    if (!match) {
      return c.json({ error: "Not found" }, 404);
    }
    const id = Number(match[1]);

    const row = await c.env.DB.prepare(
      `SELECT photo_thumb_key
         FROM registrations
         WHERE id = ?
           AND ${ELIGIBLE_WHERE}`,
    )
      .bind(id)
      .first<PhotoThumbRow>();

    const key = row?.photo_thumb_key;
    if (!key) {
      return c.json({ error: "Not found" }, 404);
    }

    const file = await c.var.fileStorage.get(key);
    if (!file) {
      return c.json({ error: "Not found" }, 404);
    }

    return new Response(file.body, {
      status: 200,
      headers: {
        "Content-Type": file.contentType,
        "Content-Length": String(file.size),
        "Cache-Control": THUMB_CACHE_CONTROL,
      },
    });
  },
);
