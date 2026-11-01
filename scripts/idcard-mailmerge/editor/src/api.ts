/**
 * Thin fetch wrappers over the dev middleware's /api routes (R1, R16, R17).
 * No caching, no retries — a failed request just throws, and the caller
 * (App.tsx) is responsible for surfacing that to the operator.
 */

import type { Layout, Manifest, SparseOverride } from "./core/types";

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`${init?.method ?? "GET"} ${url} -> ${res.status}: ${body}`);
  }
  return (await res.json()) as T;
}

export function getLayout(): Promise<Layout> {
  return fetchJson<Layout>("/api/layout");
}

export function getDefaults(): Promise<Layout> {
  return fetchJson<Layout>("/api/defaults");
}

export function putLayout(layout: Layout): Promise<Layout> {
  return fetchJson<Layout>("/api/layout", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(layout),
  });
}

/** Renders against whatever layout/override state is currently saved on
 * disk (not any unsaved edits) — the caller is responsible for only
 * allowing this when the relevant dirty flag is clean. With no `id`,
 * renders the sample manifest (template preview). With an `id`, renders
 * JUST that record with its saved override applied. */
export function renderPreview(id?: string): Promise<void> {
  const init: RequestInit =
    id === undefined
      ? { method: "POST" }
      : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) };
  return fetchJson<{ ok: true }>("/api/preview", init).then(() => undefined);
}

/** R3/R18 — the record picker's source: the local attendee dump if present, else the bundled sample manifest. */
export function getManifest(): Promise<Manifest> {
  return fetchJson<Manifest>("/api/manifest");
}

/** R18/R2 — the record's existing override, if any. The middleware's handleGetOverride
 * returns `{}` (not a 404) when no override file exists yet, so an absent
 * override loads as empty/defaults rather than an error. */
export function getOverride(id: string): Promise<SparseOverride> {
  return fetchJson<SparseOverride>(`/api/override/${encodeURIComponent(id)}`);
}

/** R20 — writes the sparse override for one attendee id, replacing the file. */
export function putOverride(id: string, sparse: SparseOverride): Promise<SparseOverride> {
  return fetchJson<SparseOverride>(`/api/override/${encodeURIComponent(id)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(sparse),
  });
}

/** R21 — deletes the record's override file, if any. The middleware replies
 * 204 with no body (fs.rm with force:true, so a missing file isn't an
 * error), so this doesn't go through fetchJson's res.json() parse. */
export async function deleteOverride(id: string): Promise<void> {
  const url = `/api/override/${encodeURIComponent(id)}`;
  const res = await fetch(url, { method: "DELETE" });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`DELETE ${url} -> ${res.status}: ${body}`);
  }
}
