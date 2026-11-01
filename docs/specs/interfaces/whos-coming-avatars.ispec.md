# Interface Spec: Who's Coming Avatars

## Purpose

Server-side email hash addition to the whos-coming API response, and a client-side hook that matches prediction players to whos-coming attendees for avatar thumbnails. Cross-cutting: used by The Ledger but decoupled from it.

**Functional spec:** `docs/specs/the-ledger.spec.md` (R6)
**Design:** `tasks/2026-07-07-points-ledger/design.md` (Server modification, useWhosComingAvatars)

---

## Scope

**In scope:**

- Server: `emailHash` field added to `/api/public/whos-coming` response
- Client: `useWhosComingAvatars` hook
- Hash computation (shared algorithm, server and client)

**Out of scope:**

- Photo upload/storage (existing, unchanged)
- Photo thumbnail serving at `/api/public/photos/:id.jpg` (existing, unchanged)
- Visual rendering of avatars (see `ledger-page.ispec.md`)

---

## Server: /api/public/whos-coming (modified)

### Current response shape

```json
{
  "people": [
    {
      "id": 42,
      "fullName": "Omar Mock",
      "branch": "ECE",
      "city": "Bangalore",
      "country": "India",
      "hasPhoto": true,
      "createdAt": 1719849600000
    }
  ],
  "count": 70,
  "thumbsBaseUrl": "/api/public/photos"
}
```

### Modified response shape

```json
{
  "people": [
    {
      "id": 42,
      "fullName": "Omar Mock",
      "branch": "ECE",
      "city": "Bangalore",
      "country": "India",
      "hasPhoto": true,
      "createdAt": 1719849600000,
      "emailHash": "a1b2c3d4"
    }
  ],
  "count": 70,
  "thumbsBaseUrl": "/api/public/photos"
}
```

R-IF-A1 — Each attendee object in the `people` array gains an `emailHash` field: the first 8 characters of the hex-encoded SHA-256 hash of `registration.email.trim().toLowerCase()`. Lowercase hex.

R-IF-A2 — The raw email is **never** included in the response. Only the partial hash.

R-IF-A3 — The hash is computed in the route handler after the D1 query. The D1 query must now `SELECT email` in addition to existing columns (email is available on the `registrations` table but not currently selected).

R-IF-A4 — Existing fields (`id`, `fullName`, `branch`, `city`, `country`, `hasPhoto`, `createdAt`) are unchanged. The `count` and `thumbsBaseUrl` fields are unchanged.

R-IF-A5 — The `emailHash` computation uses the same algorithm as the client-side `computeEmailHash` in `ledger-aggregates.ts`: `SHA-256(email.trim().toLowerCase())` → hex → first 8 chars. In Workers, use `crypto.subtle.digest("SHA-256", ...)`.

R-IF-A6 — Attendees with no email (edge case: shouldn't exist in practice) → `emailHash` is an empty string. No error thrown.

---

## Client: useWhosComingAvatars hook

```typescript
function useWhosComingAvatars(): {
  getAvatarUrl: (emailHash: string) => string | null
  loading: boolean
}
```

R-IF-A7 — Fetches `GET /api/public/whos-coming` on mount. Builds an internal `Map<emailHash, avatarUrl>` from the response, keyed by the server-provided `emailHash` field.

R-IF-A8 — `avatarUrl` construction: `"{thumbsBaseUrl}/{attendee.id}.jpg"` — using the `thumbsBaseUrl` from the response. Only attendees where `hasPhoto === true` are included in the map.

R-IF-A9 — `getAvatarUrl(emailHash)` takes a **pre-computed** email hash (the 8-char hex string from `computeEmailHash`), looks up the internal map, and returns the avatar URL or `null`. The function is synchronous — no async hash computation at lookup time. The caller is responsible for computing the hash via `computeEmailHash(playerEmail)` (async) and passing the result.

R-IF-A10 — The map is keyed by the server-provided `emailHash` from the whos-coming response. No client-side hash computation happens inside the hook — it only stores and looks up server-provided hashes. The consumer (page component) computes player email hashes separately using `computeEmailHash` from `ledger-aggregates.ts` and passes the result to `getAvatarUrl`.

R-IF-A11 — `loading` is `true` during the fetch, `false` after (success or failure). No re-fetch on its own — stable after mount.

R-IF-A12 — Fetch failure → `getAvatarUrl` returns `null` for all inputs. No error state exposed to consumers. `loading` becomes `false`.

R-IF-A13 — The hook does NOT depend on the predictions dataset or any player data. It fetches whos-coming independently and exposes a lookup function keyed by email hash.

---

## Hash algorithm (shared contract)

R-IF-A14 — Both server and client produce identical hashes for the same email input. The algorithm:

1. Input: raw email string
2. Normalize: `email.trim().toLowerCase()`
3. Encode to UTF-8 bytes
4. SHA-256 digest
5. Hex-encode the digest (lowercase)
6. Take the first 8 characters

R-IF-A15 — Test vectors: `"test@example.com"` → `"973dfe46"`. The email `"Test@Example.com"` and `" test@example.com "` both produce `"973dfe46"` (trim + lowercase normalization).

R-IF-A16 — 8 hex characters = 32 bits of hash. Collision probability for 70 alumni is negligible (~0.0001%). A collision would cause two players to share an avatar — cosmetic, not security-relevant.

---

## Edge cases

- Attendee has `hasPhoto: false` → not in the avatar map. `getAvatarUrl` returns `null`.
- Player email not in registrations → no hash match. `getAvatarUrl` returns `null`.
- Whos-coming API returns empty `people` array → all lookups return `null`.
- Network failure on whos-coming fetch → all lookups return `null`, no error shown to user.
- Player email matches attendee but attendee has no photo → not in map, returns `null`.
